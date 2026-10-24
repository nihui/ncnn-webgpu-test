// Copyright 2018 Tencent
// SPDX-License-Identifier: BSD-3-Clause

#include <float.h>
#include <stdio.h>
#include <string.h>
#include <cmath>
#include <cstdio>

#include "benchmark.h"
#include "cpu.h"
#include "datareader.h"
#include "net.h"
#include "gpu.h"

#include "benchncnn_param_data.h"

#ifndef NCNN_SIMPLESTL
#include <vector>
#endif

class DataReaderFromEmpty : public ncnn::DataReader
{
public:
    virtual int scan(const char* format, void* p) const
    {
        return 0;
    }
    virtual size_t read(void* buf, size_t size) const
    {
        memset(buf, 0, size);
        return size;
    }
};

static int g_warmup_loop_count = 8;
static int g_loop_count = 4;
static bool g_enable_cooling_down = true;

static ncnn::UnlockedPoolAllocator g_blob_pool_allocator;
static ncnn::PoolAllocator g_workspace_pool_allocator;

#if NCNN_VULKAN
static ncnn::VulkanDevice* g_vkdev = 0;
static ncnn::VkAllocator* g_blob_vkallocator = 0;
static ncnn::VkAllocator* g_staging_vkallocator = 0;
#endif // NCNN_VULKAN

#include "benchmark_common.h"

// Adapted from the pinned ncnn benchmark, retaining its timings and workload.
// Unlike the command-line original, failed loads/extracts never print a result.
static int benchmark_checked(const char* comment, const std::vector<ncnn::Mat>& _in, const ncnn::Option& opt, const char* model_param_data = NULL)
{
    g_blob_pool_allocator.clear();
    g_workspace_pool_allocator.clear();

#if NCNN_VULKAN
    if (opt.use_vulkan_compute)
    {
        g_blob_vkallocator->clear();
        g_staging_vkallocator->clear();
    }
#endif // NCNN_VULKAN

    ncnn::Net net;

    net.opt = opt;

#if NCNN_VULKAN
    if (net.opt.use_vulkan_compute)
    {
        net.set_vulkan_device(g_vkdev);
    }
#endif // NCNN_VULKAN

    if (net.load_param_mem(model_param_data) != 0)
        return -1;

    DataReaderFromEmpty dr;
    if (net.load_model(dr) != 0)
        return -1;

    const std::vector<const char*>& input_names = net.input_names();
    const std::vector<const char*>& output_names = net.output_names();

    if (g_enable_cooling_down)
    {
        // sleep 10 seconds for cooling down SOC  :(
        ncnn::sleep(10 * 1000);
    }

    if (input_names.empty() || output_names.empty() || input_names.size() != _in.size())
    {
        fprintf(stderr, "input %zu tensors while model has %zu inputs\n", _in.size(), input_names.size());
        return -1;
    }

    // initialize input
    for (size_t j = 0; j < input_names.size(); ++j)
    {
        ncnn::Mat in = _in[j];
        in.fill(0.01f);
    }

    // warm up
    for (int i = 0; i < g_warmup_loop_count; i++)
    {
        ncnn::Extractor ex = net.create_extractor();
        for (size_t j = 0; j < input_names.size(); ++j)
        {
            ncnn::Mat in = _in[j];
            if (ex.input(input_names[j], in) != 0)
                return -1;
        }

        for (size_t j = 0; j < output_names.size(); ++j)
        {
            ncnn::Mat out;
            if (ex.extract(output_names[j], out) != 0)
                return -1;
        }
    }

    double time_min = DBL_MAX;
    double time_max = -DBL_MAX;
    double time_avg = 0;

    for (int i = 0; i < g_loop_count; i++)
    {
        double start = ncnn::get_current_time();
        {
            ncnn::Extractor ex = net.create_extractor();
            for (size_t j = 0; j < input_names.size(); ++j)
            {
                ncnn::Mat in = _in[j];
                if (ex.input(input_names[j], in) != 0)
                    return -1;
            }

            for (size_t j = 0; j < output_names.size(); ++j)
            {
                ncnn::Mat out;
                if (ex.extract(output_names[j], out) != 0)
                    return -1;
            }
        }

        double end = ncnn::get_current_time();

        double time = end - start;

        time_min = std::min(time_min, time);
        time_max = std::max(time_max, time);
        time_avg += time;
    }

    time_avg /= g_loop_count;

    if (!std::isfinite(time_min) || !std::isfinite(time_max) || !std::isfinite(time_avg))
        return -1;

    fprintf(stderr, "%20s  min = %7.2f  max = %7.2f  avg = %7.2f\n", comment, time_min, time_max, time_avg);
    return 0;
}


struct BenchmarkModel
{
    const char* name;
    const char* param_data;
    int width;
    int height;
    int channels;
};

static const BenchmarkModel models[] = {
    {"squeezenet", squeezenet_param_data, 227, 227, 3},
    {"squeezenet_int8", squeezenet_int8_param_data, 227, 227, 3},
    {"mobilenet", mobilenet_param_data, 224, 224, 3},
    {"mobilenet_int8", mobilenet_int8_param_data, 224, 224, 3},
    {"mobilenet_v2", mobilenet_v2_param_data, 224, 224, 3},
    {"mobilenet_v3", mobilenet_v3_param_data, 224, 224, 3},
    {"shufflenet", shufflenet_param_data, 224, 224, 3},
    {"shufflenet_v2", shufflenet_v2_param_data, 224, 224, 3},
    {"mnasnet", mnasnet_param_data, 224, 224, 3},
    {"proxylessnasnet", proxylessnasnet_param_data, 224, 224, 3},
    {"efficientnet_b0", efficientnet_b0_param_data, 224, 224, 3},
    {"efficientnetv2_b0", efficientnetv2_b0_param_data, 224, 224, 3},
    {"regnety_400m", regnety_400m_param_data, 224, 224, 3},
    {"blazeface", blazeface_param_data, 128, 128, 3},
    {"googlenet", googlenet_param_data, 224, 224, 3},
    {"googlenet_int8", googlenet_int8_param_data, 224, 224, 3},
    {"resnet18", resnet18_param_data, 224, 224, 3},
    {"resnet18_int8", resnet18_int8_param_data, 224, 224, 3},
    {"alexnet", alexnet_param_data, 227, 227, 3},
    {"vgg16", vgg16_param_data, 224, 224, 3},
    {"vgg16_int8", vgg16_int8_param_data, 224, 224, 3},
    {"resnet50", resnet50_param_data, 224, 224, 3},
    {"resnet50_int8", resnet50_int8_param_data, 224, 224, 3},
    {"squeezenet_ssd", squeezenet_ssd_param_data, 300, 300, 3},
    {"squeezenet_ssd_int8", squeezenet_ssd_int8_param_data, 300, 300, 3},
    {"mobilenet_ssd", mobilenet_ssd_param_data, 300, 300, 3},
    {"mobilenet_ssd_int8", mobilenet_ssd_int8_param_data, 300, 300, 3},
    {"mobilenet_yolo", mobilenet_yolo_param_data, 416, 416, 3},
    {"mobilenetv2_yolov3", mobilenetv2_yolov3_param_data, 352, 352, 3},
    {"yolov4-tiny", yolov4_tiny_param_data, 416, 416, 3},
    {"nanodet_m", nanodet_m_param_data, 320, 320, 3},
    {"yolo-fastest-1.1", yolo_fastest_1_1_param_data, 320, 320, 3},
    {"yolo-fastestv2", yolo_fastestv2_param_data, 352, 352, 3},
    {"vision_transformer", vision_transformer_param_data, 384, 384, 3},
    {"FastestDet", FastestDet_param_data, 352, 352, 3},
};

int main(int argc, char** argv)
{
    BenchmarkArguments args;
    if (!parse_benchmark_arguments(argc, argv, args))
        return -1;

    const BenchmarkModel* selected = 0;
    for (size_t i = 0; i < sizeof(models) / sizeof(models[0]); ++i)
        if (std::strcmp(models[i].name, args.model) == 0)
            selected = &models[i];
    if (!selected)
    {
        std::fprintf(stderr, "unknown model %s\n", args.model);
        return -1;
    }

    BenchmarkRuntime runtime;
    ncnn::Option opt;
    if (runtime.initialize(args, false, opt) != 0)
        return -1;
    std::vector<ncnn::Mat> inputs;
    inputs.push_back(ncnn::Mat(selected->width, selected->height, selected->channels));
    if (inputs[0].empty())
        return -1;
    const int ret = benchmark_checked(selected->name, inputs, opt, selected->param_data);
    if (ret != 0)
        std::fprintf(stderr, "benchmark %s failed %d\n", selected->name, ret);
    return ret;
}
