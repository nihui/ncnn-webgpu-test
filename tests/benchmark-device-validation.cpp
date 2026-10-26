// Copyright 2026 Tencent
// SPDX-License-Identifier: BSD-3-Clause
// Unit-test the browser guard with an enumerated but unusable device. These
// stubs do not test Vulkan/WebGPU; they ensure the upstream CPU fallback cannot
// run when device creation failed. No benchmark workload is executed here.
#include <cassert>

#define NCNN_VULKAN 1
namespace ncnn {
struct VulkanDevice
{
    bool valid;
    bool is_valid() const { return valid; }
};
struct GpuInfo
{
    const char* device_name() const { return "test device"; }
};
static VulkanDevice device = {false};
static bool missing_device = false;
static int destroy_count = 0;
int create_gpu_instance() { return 0; }
void destroy_gpu_instance() { ++destroy_count; }
int get_gpu_count() { return 1; }
VulkanDevice* get_gpu_device(int) { return missing_device ? 0 : &device; }
GpuInfo get_gpu_info(int) { return GpuInfo(); }
} // namespace ncnn

struct TestAllocator {};
static TestAllocator* g_blob_vkallocator = 0;
static TestAllocator* g_staging_vkallocator = 0;
static ncnn::VulkanDevice* g_vkdev = 0;
static const char* g_benchmark_model_filter = 0;
static bool g_benchmark_model_matched = false;
static int g_benchmark_result = 0;
#include "../src/benchmark_common.h"

static int calls = 0;
static int upstream_main(int argc, char**)
{
    assert(argc == 6);
    assert(std::strcmp(g_benchmark_model_filter, "test") == 0);
    ++calls;
    g_benchmark_model_matched = true;
    return 0;
}

int main()
{
    char program[] = "benchmark", one[] = "1", two[] = "2";
    char zero[] = "0", model[] = "model=test";
    char* argv[] = {program, one, one, two, zero, zero, model};
    assert(run_web_benchmark(7, argv, upstream_main) != 0);
    assert(calls == 0 && ncnn::destroy_count == 1);
    ncnn::missing_device = true;
    assert(run_web_benchmark(7, argv, upstream_main) != 0);
    assert(calls == 0 && ncnn::destroy_count == 2);
    ncnn::missing_device = false;
    ncnn::device.valid = true;
    assert(run_web_benchmark(7, argv, upstream_main) == 0);
    assert(calls == 1 && ncnn::destroy_count == 3);
}
