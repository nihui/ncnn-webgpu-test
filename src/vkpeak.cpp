// Copyright 2026 Tencent
// SPDX-License-Identifier: BSD-3-Clause

#include "benchmark.h"
#include "command.h"
#include "gpu.h"
#include "mat.h"
#include "pipeline.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <vector>

#include "vkpeak_shaders.h"

namespace {

bool gpu_instance_created = false;

struct Scenario
{
    const char* name;
    const char* unit;
    int arithmetic;
    int packing;
    int copy;
};

// Keep the order and units used by the committed worker/module, including GBPS.
const Scenario scenarios[] = {
    {"fp32-scalar", "GFLOPS", 0, 1, 0},
    {"fp32-vec4", "GFLOPS", 0, 4, 0},
    {"fp16-scalar", "GFLOPS", 1, 1, 0},
    {"fp16-vec4", "GFLOPS", 1, 4, 0},
    {"fp16-matrix", "GFLOPS", 4, 256, 0},
    {"int32-scalar", "GIOPS", 2, 1, 0},
    {"int32-vec4", "GIOPS", 2, 4, 0},
    {"int8-dotprod", "GIOPS", 3, 4, 0},
    {"int8-matrix", "GIOPS", 5, 256, 0},
    {"copy-h2d", "GBPS", 0, 0, 1},
    {"copy-d2h", "GBPS", 0, 0, 2},
    {"copy-d2d", "GBPS", 0, 0, 3},
};

int scenario_count()
{
    return sizeof(scenarios) / sizeof(scenarios[0]);
}

int ensure_gpu_instance()
{
    if (!gpu_instance_created)
    {
        if (ncnn::create_gpu_instance() != 0)
            return -1;
        gpu_instance_created = true;
    }
    return ncnn::get_gpu_count();
}

int copy_string(const char* source, char* destination, int capacity)
{
    if (!destination || capacity <= 0)
        return -1;
    const size_t length = std::strlen(source);
    const size_t copied = std::min(length, static_cast<size_t>(capacity - 1));
    std::memcpy(destination, source, copied);
    destination[copied] = '\0';
    return static_cast<int>(length);
}

struct MatrixShape
{
    int m = 0;
    int n = 0;
    int k = 0;
    int scope = VK_SCOPE_SUBGROUP_KHR;
    int element_size = 4;
    bool fp32_accumulator = false;
};

bool find_matrix_shape(const ncnn::GpuInfo& info, int arithmetic, MatrixShape& shape)
{
    if (!info.support_cooperative_matrix() || !info.support_VK_KHR_cooperative_matrix())
        return false;
    if (arithmetic == 4 && !info.support_fp16_arithmetic())
        return false;

    const std::vector<VkCooperativeMatrixPropertiesKHR>& properties = info.queryCooperativeMatrixSubProperties();
    // The browser baseline prefers fp16 accumulation, with fp32 as a fallback.
    for (int pass = 0; pass < (arithmetic == 4 ? 2 : 1); pass++)
    {
        if (arithmetic == 4 && pass == 0 && !info.support_fp16_storage())
            continue;
        const VkComponentTypeKHR input = arithmetic == 4 ? VK_COMPONENT_TYPE_FLOAT16_KHR : VK_COMPONENT_TYPE_SINT8_KHR;
        const VkComponentTypeKHR accumulator = arithmetic == 4
            ? (pass == 0 ? VK_COMPONENT_TYPE_FLOAT16_KHR : VK_COMPONENT_TYPE_FLOAT32_KHR)
            : VK_COMPONENT_TYPE_SINT32_KHR;
        for (size_t i = 0; i < properties.size(); i++)
        {
            const VkCooperativeMatrixPropertiesKHR& property = properties[i];
            if (property.AType != input || property.BType != input ||
                property.CType != accumulator || property.ResultType != accumulator ||
                property.scope != VK_SCOPE_SUBGROUP_KHR)
                continue;
            shape.m = property.MSize;
            shape.n = property.NSize;
            shape.k = property.KSize;
            shape.element_size = accumulator == VK_COMPONENT_TYPE_FLOAT16_KHR ? 2 : 4;
            shape.fp32_accumulator = arithmetic == 4 && pass == 1;
            return shape.m > 0 && shape.n > 0 && shape.k > 0;
        }
    }
    return false;
}

bool supported(const ncnn::GpuInfo& info, const Scenario& scenario)
{
    if (scenario.arithmetic == 1)
        return info.support_fp16_arithmetic();
    if (scenario.arithmetic == 3)
        return info.queryShaderIntegerDotProductFeatures().shaderIntegerDotProduct &&
               info.queryShaderIntegerDotProductProperties().integerDotProduct4x8BitPackedSignedAccelerated;
    if (scenario.packing == 256)
    {
        MatrixShape shape;
        return find_matrix_shape(info, scenario.arithmetic, shape);
    }
    return true;
}

// Declare this before matrices/commands so they release their allocations first.
struct Allocators
{
    explicit Allocators(ncnn::VulkanDevice* device, bool use_staging = false)
        : device(device), blob(device->acquire_blob_allocator()),
          staging(use_staging ? device->acquire_staging_allocator() : 0)
    {
    }
    ~Allocators()
    {
        if (staging)
            device->reclaim_staging_allocator(staging);
        if (blob)
            device->reclaim_blob_allocator(blob);
    }
    ncnn::VulkanDevice* device;
    ncnn::VkAllocator* blob;
    ncnn::VkAllocator* staging;
};

double run_compute(ncnn::VulkanDevice* device, int gpu_index, const Scenario& scenario)
{
    const bool matrix = scenario.packing == 256;
    MatrixShape shape;
    if (matrix && !find_matrix_shape(device->info, scenario.arithmetic, shape))
        return 0;

    ncnn::Option option;
    option.use_vulkan_compute = true;
    option.vulkan_device_index = gpu_index;
    option.use_fp16_storage = scenario.arithmetic == 4 && !shape.fp32_accumulator;
    option.use_fp16_arithmetic = scenario.arithmetic == 1 || scenario.arithmetic == 4;
    option.use_cooperative_matrix = matrix;

    const char* shader = 0;
    if (scenario.arithmetic == 4)
        shader = shape.fp32_accumulator ? glsl_fp16_fp32_matrix : glsl_fp16_matrix;
    else if (scenario.arithmetic == 5)
        shader = glsl_int8_matrix;
    else if (scenario.arithmetic == 3)
        shader = glsl_int8_dotprod;
    else if (scenario.arithmetic == 2)
        shader = scenario.packing == 1 ? glsl_int_scalar : glsl_int_vec4;
    else
        shader = scenario.packing == 1 ? glsl_fp_scalar : glsl_fp_vec4;

    std::vector<uint32_t> spirv;
    if (ncnn::compile_spirv_module(shader, std::strlen(shader), option, spirv) != 0 || spirv.empty())
        return 0;

    const int local_size = std::min(128, std::max(1, static_cast<int>(device->info.subgroup_size())));
    ncnn::Pipeline pipeline(device);
    pipeline.set_local_size_xyz(local_size, 1, 1);
    std::vector<ncnn::vk_specialization_type> specializations(matrix ? 5 : 1);
    specializations[0].i = 64;
    if (matrix)
    {
        specializations[1].i = shape.m;
        specializations[2].i = shape.n;
        specializations[3].i = shape.k;
        specializations[4].i = shape.scope;
    }
    if (pipeline.create(spirv.data(), spirv.size() * sizeof(uint32_t), specializations) != 0)
        return 0;

    // Recovered browser limits: at most 1M invocations, 16 MiB matrix output,
    // 64 shader iterations, and no more than 64 dispatches in one submission.
    size_t maximum = std::min<size_t>(1024 * 1024,
        static_cast<size_t>(local_size) * device->info.physicalDeviceProperties().limits.maxComputeWorkGroupCount[0]);
    const size_t matrix_bytes = static_cast<size_t>(shape.m) * shape.n * shape.element_size;
    if (matrix)
        maximum = std::min(maximum, std::max<size_t>(1, 16 * 1024 * 1024 / matrix_bytes) * local_size);
    maximum = std::max<size_t>(local_size, maximum - maximum % local_size);
    const size_t buffer_bytes = matrix ? maximum / local_size * matrix_bytes : maximum * 4;
    Allocators allocators(device);
    if (!allocators.blob)
        return 0;
    ncnn::VkMat output(static_cast<int>(buffer_bytes), static_cast<size_t>(1), 1, allocators.blob);
    if (output.empty())
        return 0;

    int invocations = static_cast<int>(std::min<size_t>(local_size * 64, maximum));
    int dispatches = 1;
    // Calibrate toward 120 ms, bounded to sixteen submissions, then keep the
    // best of five timed submissions. Only submit_and_wait is timed.
    for (int attempt = 0; attempt < 16; attempt++)
    {
        ncnn::VkCompute command(device);
        std::vector<ncnn::VkMat> bindings(1, output);
        std::vector<ncnn::vk_constant_type> constants;
        ncnn::VkMat dispatcher;
        dispatcher.w = invocations;
        dispatcher.h = dispatcher.c = 1;
        for (int i = 0; i < dispatches; i++)
            command.record_pipeline(&pipeline, bindings, constants, dispatcher);
        const double start = ncnn::get_current_time();
        if (command.submit_and_wait() != 0)
            return 0;
        if (ncnn::get_current_time() - start >= 120)
            break;
        if (static_cast<size_t>(invocations) < maximum)
            invocations = static_cast<int>(std::min<size_t>(invocations * 2, maximum));
        else if (dispatches < 64)
            dispatches *= 2;
        else
            break;
    }

    double operations = static_cast<double>(invocations) * dispatches * 64 * 16 * 2;
    operations *= matrix ? static_cast<double>(shape.m) * shape.n * shape.k / local_size : scenario.packing;
    double best = 0;
    for (int trial = 0; trial < 5; trial++)
    {
        ncnn::VkCompute command(device);
        std::vector<ncnn::VkMat> bindings(1, output);
        std::vector<ncnn::vk_constant_type> constants;
        ncnn::VkMat dispatcher;
        dispatcher.w = invocations;
        dispatcher.h = dispatcher.c = 1;
        for (int i = 0; i < dispatches; i++)
            command.record_pipeline(&pipeline, bindings, constants, dispatcher);
        const double start = ncnn::get_current_time();
        if (command.submit_and_wait() != 0)
            return 0;
        const double elapsed = ncnn::get_current_time() - start;
        if (elapsed > 0)
            best = std::max(best, operations / elapsed / 1000000);
    }
    return best;
}

double run_copy(ncnn::VulkanDevice* device, int gpu_index, int mode)
{
    const int bytes = 32 * 1024 * 1024;
    Allocators allocators(device, true);
    if (!allocators.blob || !allocators.staging)
        return 0;
    ncnn::Option option;
    option.use_vulkan_compute = true;
    option.vulkan_device_index = gpu_index;
    option.blob_vkallocator = option.workspace_vkallocator = allocators.blob;
    option.staging_vkallocator = allocators.staging;
    double best = 0;
    if (mode == 3)
    {
        ncnn::VkMat source(bytes, static_cast<size_t>(1), 1, allocators.blob);
        ncnn::VkMat destination(bytes, static_cast<size_t>(1), 1, allocators.blob);
        if (source.empty() || destination.empty())
            return 0;
        for (int trial = 0; trial < 8; trial++)
        {
            ncnn::VkCompute command(device);
            command.record_clone(source, destination, option);
            const double start = ncnn::get_current_time();
            if (command.submit_and_wait() != 0)
                return 0;
            const double elapsed = ncnn::get_current_time() - start;
            if (elapsed > 0)
                best = std::max(best, bytes / elapsed / 1000000);
        }
    }
    else
    {
        // Preserve the browser baseline's host-copy metric: mapped staging
        // memory plus flush/invalidate, not a submitted device transfer.
        ncnn::VkMat buffer(bytes, static_cast<size_t>(1), 1, allocators.staging);
        ncnn::Mat host(bytes, static_cast<size_t>(1), 1);
        if (buffer.empty() || host.empty())
            return 0;
        void* mapped = buffer.mapped_ptr();
        if (!mapped)
            return 0;
        std::memset(host.data, 0, bytes);
        for (int trial = 0; trial < 8; trial++)
        {
            const double start = ncnn::get_current_time();
            if (mode == 1)
            {
                std::memcpy(mapped, host.data, bytes);
                if (allocators.staging->flush(buffer.data) != 0)
                    return 0;
            }
            else
            {
                if (allocators.staging->invalidate(buffer.data) != 0)
                    return 0;
                std::memcpy(host.data, mapped, bytes);
            }
            const double elapsed = ncnn::get_current_time() - start;
            if (elapsed > 0)
                best = std::max(best, bytes / elapsed / 1000000);
        }
    }
    return best;
}

} // namespace

extern "C" {

int ncnn_vkpeak_scenario_count()
{
    return scenario_count();
}

int ncnn_vkpeak_gpu_count()
{
    return ensure_gpu_instance();
}

int ncnn_vkpeak_gpu_name(int index, char* name, int capacity)
{
    const int count = ensure_gpu_instance();
    if (index < 0 || index >= count)
        return -1;
    return copy_string(ncnn::get_gpu_info(index).device_name(), name, capacity);
}

int ncnn_vkpeak_scenario_name(int index, char* name, int capacity)
{
    if (index < 0 || index >= scenario_count())
        return -1;
    return copy_string(scenarios[index].name, name, capacity);
}

int ncnn_vkpeak_scenario_unit(int index, char* unit, int capacity)
{
    if (index < 0 || index >= scenario_count())
        return -1;
    return copy_string(scenarios[index].unit, unit, capacity);
}

int ncnn_vkpeak_scenario_supported(int gpu_index, int index)
{
    if (index < 0 || index >= scenario_count())
        return -1;
    const int count = ensure_gpu_instance();
    if (gpu_index < 0 || gpu_index >= count)
        return -1;
    return supported(ncnn::get_gpu_info(gpu_index), scenarios[index]) ? 1 : 0;
}

double ncnn_vkpeak_run(int gpu_index, int index)
{
    if (ncnn_vkpeak_scenario_supported(gpu_index, index) != 1)
        return -1;
    ncnn::VulkanDevice* device = ncnn::get_gpu_device(gpu_index);
    if (!device)
        return 0;
    const Scenario& scenario = scenarios[index];
    const double score = scenario.copy ? run_copy(device, gpu_index, scenario.copy) : run_compute(device, gpu_index, scenario);
    return std::isfinite(score) && score > 0 ? score : 0;
}

void ncnn_vkpeak_destroy()
{
    if (gpu_instance_created)
    {
        ncnn::destroy_gpu_instance();
        gpu_instance_created = false;
    }
}

} // extern "C"
