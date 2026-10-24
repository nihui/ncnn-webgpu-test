// Copyright 2026 Tencent
// SPDX-License-Identifier: BSD-3-Clause

#include <algorithm>
#include <cmath>
#include <cstring>

// Built from nihui/vkpeak f37dab4c421781bf047face221dbaf6ae112a5e7.
// CMake copies the pinned source and applies patches/vkpeak-webgpu.patch.
// Kernels, calibration, scoring and copies come from upstream, not this ABI shim.
#define VKPEAK_LIBRARY
#include <upstream/vkpeak/vkpeak.cpp>
#undef VKPEAK_LIBRARY

namespace {

bool gpu_instance_created = false;

struct Scenario
{
    const char* name;
    const char* unit;
    int storage;
    int arithmetic;
    int packing;
    bool copy;
};

// The existing worker exposes this subset of upstream's scenario table.
const Scenario scenarios[] = {
    {"fp32-scalar", "GFLOPS", 0, 0, 1, false},
    {"fp32-vec4", "GFLOPS", 0, 0, 4, false},
    {"fp16-scalar", "GFLOPS", 0, 1, 1, false},
    {"fp16-vec4", "GFLOPS", 0, 1, 4, false},
    {"fp16-matrix", "GFLOPS", 1, 1, 256, false},
    {"int32-scalar", "GIOPS", 3, 3, 1, false},
    {"int32-vec4", "GIOPS", 3, 3, 4, false},
    {"int8-dotprod", "GIOPS", 3, 6, 4, false},
    {"int8-matrix", "GIOPS", 3, 6, 256, false},
    {"copy-h2d", "GBPS", 0, 1, 0, true},
    {"copy-d2h", "GBPS", 1, 0, 0, true},
    {"copy-d2d", "GBPS", 1, 1, 0, true},
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

template<typename GpuInfo>
bool matrix_supported(const GpuInfo& info, bool fp16)
{
    // Match the KHR/NV component types and scopes selected by upstream vkpeak().
    const VkComponentTypeKHR input = fp16 ? VK_COMPONENT_TYPE_FLOAT16_KHR : VK_COMPONENT_TYPE_SINT8_KHR;
    if (info.support_VK_KHR_cooperative_matrix())
    {
        for (const VkCooperativeMatrixPropertiesKHR& property : info.queryCooperativeMatrixSubProperties())
        {
            const bool accumulator = fp16 ? property.CType == VK_COMPONENT_TYPE_FLOAT16_KHR || property.CType == VK_COMPONENT_TYPE_FLOAT32_KHR
                                          : property.CType == VK_COMPONENT_TYPE_SINT32_KHR;
            if (property.AType == input && property.BType == input && accumulator && property.CType == property.ResultType &&
                (property.scope == VK_SCOPE_SUBGROUP_KHR || property.scope == VK_SCOPE_WORKGROUP_KHR))
                return true;
        }
    }
    else if (info.support_VK_NV_cooperative_matrix())
    {
        const VkComponentTypeNV nv_input = fp16 ? VK_COMPONENT_TYPE_FLOAT16_NV : VK_COMPONENT_TYPE_SINT8_NV;
        for (const VkCooperativeMatrixPropertiesNV& property : info.queryCooperativeMatrixSubPropertiesNV())
        {
            const bool accumulator = fp16 ? property.CType == VK_COMPONENT_TYPE_FLOAT16_NV || property.CType == VK_COMPONENT_TYPE_FLOAT32_NV
                                          : property.CType == VK_COMPONENT_TYPE_SINT32_NV;
            if (property.AType == nv_input && property.BType == nv_input && accumulator && property.CType == property.DType &&
                (property.scope == VK_SCOPE_SUBGROUP_NV || property.scope == VK_SCOPE_WORKGROUP_NV))
                return true;
        }
    }
    return false;
}

template<typename GpuInfo>
bool supported(const GpuInfo& info, const Scenario& scenario)
{
    if (scenario.copy)
        return true;
    if (scenario.storage == 1 && !info.support_fp16_storage())
        return false;
    if (scenario.arithmetic == 1 && !info.support_fp16_arithmetic())
        return false;
    if (scenario.arithmetic == 6)
    {
        // Upstream's single/dual kernels use OpSDotAccSat. The current nikki
        // translator supports plain packed dot, but rejects saturating dot.
        // Keep the upstream arithmetic intact instead of publishing a different
        // kernel's score under the same scenario name.
        if (scenario.packing == 4)
            return false;
        if (!info.support_int8_arithmetic())
            return false;
    }
    return scenario.packing != 256 || (info.support_cooperative_matrix() && matrix_supported(info, scenario.arithmetic == 1));
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
    const ncnn::VulkanDevice* device = ncnn::get_gpu_device(gpu_index);
    if (!device || !device->is_valid())
        return 0;
    const Scenario& scenario = scenarios[index];
    const double score = scenario.copy ? vkpeak_copy(gpu_index, scenario.storage, scenario.arithmetic)
                                      : vkpeak(gpu_index, scenario.storage, scenario.arithmetic, scenario.packing);
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
