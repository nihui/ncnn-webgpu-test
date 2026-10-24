// Copyright 2026 Tencent
// SPDX-License-Identifier: BSD-3-Clause
#pragma once

#include <algorithm>
#include <cerrno>
#include <climits>
#include <cstdlib>
#include <cstdio>
#include <cstring>

// Included after the upstream benchmark globals. Both executables expose the
// same device-discovery ABI used by their existing module workers.
namespace {
#if NCNN_VULKAN
bool benchmark_gpu_instance_created = false;
#endif
}

extern "C" int ncnn_benchmark_gpu_count()
{
#if NCNN_VULKAN
    if (!benchmark_gpu_instance_created)
    {
        if (ncnn::create_gpu_instance() != 0)
            return -1;
        benchmark_gpu_instance_created = true;
    }
    return ncnn::get_gpu_count();
#else
    return 0;
#endif
}

extern "C" int ncnn_benchmark_gpu_name(int index, char* name, int capacity)
{
#if NCNN_VULKAN
    if (!benchmark_gpu_instance_created || index < 0 || index >= ncnn::get_gpu_count() || !name || capacity <= 0)
        return -1;
    const char* source = ncnn::get_gpu_info(index).device_name();
    const size_t length = std::strlen(source);
    const size_t copied = std::min(length, static_cast<size_t>(capacity - 1));
    std::memcpy(name, source, copied);
    name[copied] = '\0';
    return static_cast<int>(length);
#else
    (void)index;
    (void)name;
    (void)capacity;
    return -1;
#endif
}

extern "C" void ncnn_benchmark_destroy_gpu_instance()
{
#if NCNN_VULKAN
    if (benchmark_gpu_instance_created)
    {
        ncnn::destroy_gpu_instance();
        benchmark_gpu_instance_created = false;
    }
#endif
}

namespace {
struct BenchmarkArguments
{
    int loop_count;
    int num_threads;
    int powersave;
    int gpu_device;
    int cooling_down;
    const char* model;
};

bool parse_benchmark_integer(const char* value, int& parsed)
{
    if (!value || !*value)
        return false;
    char* end = 0;
    errno = 0;
    const long result = std::strtol(value, &end, 10);
    if (errno || *end || result < INT_MIN || result > INT_MAX)
        return false;
    parsed = static_cast<int>(result);
    return true;
}

bool parse_benchmark_arguments(int argc, char** argv, BenchmarkArguments& args)
{
    // A worker request must run exactly one model, never the upstream full suite.
    if (argc != 7 || !parse_benchmark_integer(argv[1], args.loop_count) ||
        !parse_benchmark_integer(argv[2], args.num_threads) ||
        !parse_benchmark_integer(argv[3], args.powersave) ||
        !parse_benchmark_integer(argv[4], args.gpu_device) ||
        !parse_benchmark_integer(argv[5], args.cooling_down) ||
        args.loop_count <= 0 || args.num_threads <= 0 || args.gpu_device < -1 ||
        args.powersave < 0 || args.powersave > 2 ||
        (args.cooling_down != 0 && args.cooling_down != 1) ||
        std::strncmp(argv[6], "model=", 6) != 0 || !argv[6][6])
    {
        std::fprintf(stderr, "Expected: [positive loop count] [positive num threads] [powersave 0..2] [gpu device or -1] [cooling down 0..1] model=name\n");
        return false;
    }
    args.model = argv[6] + 6;
    return true;
}

class BenchmarkRuntime
{
public:
    ~BenchmarkRuntime()
    {
#if NCNN_VULKAN
        delete g_blob_vkallocator;
        delete g_staging_vkallocator;
        g_blob_vkallocator = 0;
        g_staging_vkallocator = 0;
        g_vkdev = 0;
#endif
        ncnn_benchmark_destroy_gpu_instance();
    }

};

int run_web_benchmark(int argc, char** argv, int (*upstream_main)(int, char**))
{
    BenchmarkArguments args;
    if (!parse_benchmark_arguments(argc, argv, args))
        return -1;

    BenchmarkRuntime runtime;
    if (args.gpu_device != -1)
    {
#if NCNN_VULKAN
        const int count = ncnn_benchmark_gpu_count();
        if (count <= 0 || args.gpu_device >= count)
        {
            std::fprintf(stderr, "WebGPU device %d unavailable (device count %d)\n", args.gpu_device, count);
            return -1;
        }
        const ncnn::VulkanDevice* device = ncnn::get_gpu_device(args.gpu_device);
        if (!device || !device->is_valid())
        {
            std::fprintf(stderr, "WebGPU device %d initialization failed\n", args.gpu_device);
            return -1;
        }
#else
        std::fprintf(stderr, "This diagnostic build has no WebGPU backend\n");
        return -1;
#endif
    }

    g_benchmark_model_filter = args.model;
    g_benchmark_model_matched = false;
    g_benchmark_result = 0;
    // The first five arguments are the original CLI. The final model= selector
    // is handled by the narrow patch, without replacing upstream option setup.
    const int ret = upstream_main(6, argv);
    if (ret != 0)
        return ret;
    if (!g_benchmark_model_matched)
    {
        std::fprintf(stderr, "unknown model %s\n", args.model);
        return -1;
    }
    if (g_benchmark_result != 0)
        std::fprintf(stderr, "benchmark %s failed %d\n", args.model, g_benchmark_result);
    return g_benchmark_result;
}
} // namespace
