// Copyright 2026 Tencent
// SPDX-License-Identifier: BSD-3-Clause

#include "benchmark.h"
#include "net.h"
#if NCNN_VULKAN
#include "gpu.h"
#endif

#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>
#include <memory>
#include <utility>
#include <vector>

namespace {
std::unique_ptr<ncnn::Net> network;
#if NCNN_VULKAN
bool gpu_instance_created = false;

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
#endif
} // namespace

extern "C" {

int ncnn_squeezenet_gpu_count()
{
#if NCNN_VULKAN
    return ensure_gpu_instance();
#else
    return 0;
#endif
}

int ncnn_squeezenet_gpu_name(int index, char* name, int capacity)
{
#if NCNN_VULKAN
    if (!gpu_instance_created || index < 0 || index >= ncnn::get_gpu_count() || !name || capacity <= 0)
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

int ncnn_squeezenet_init(int gpu_index)
{
    if (network)
        return 0;
#if NCNN_VULKAN
    const int count = ensure_gpu_instance();
    if (count <= 0 || gpu_index < 0 || gpu_index >= count)
        return -1;
#else
    (void)gpu_index;
#endif

    std::unique_ptr<ncnn::Net> candidate(new ncnn::Net);
    candidate->opt.num_threads = 1;
#if NCNN_VULKAN
    candidate->opt.use_vulkan_compute = true;
    candidate->set_vulkan_device(gpu_index);
#endif
    if (candidate->load_param("/models/squeezenet_v1.1.param") != 0 ||
        candidate->load_model("/models/squeezenet_v1.1.bin") != 0)
        return -1;
    network = std::move(candidate);
    return 0;
}

// Existing worker ABI: output[0..5] = top-3 (class, probability) pairs,
// output[6..15] = ten inference times in ms, output[16] = their minimum.
int ncnn_squeezenet_infer(const unsigned char* rgba, int width, int height, float* output)
{
    if (!network || !rgba || !output || width <= 0 || height <= 0 ||
        width > std::numeric_limits<int>::max() / 4)
        return -1;

    // Recovered from the committed CPU WASM: direct resize, no center crop,
    // RGBA -> BGR, then these means. Alpha does not affect the network input.
    ncnn::Mat input = ncnn::Mat::from_pixels_resize(rgba, ncnn::Mat::PIXEL_RGBA2BGR,
                                                  width, height, 227, 227);
    if (input.empty())
        return -1;
    const float means[3] = {104.f, 117.f, 123.f};
    input.substract_mean_normalize(means, 0);

    float values[17] = {};
    double fastest = std::numeric_limits<double>::max();
    ncnn::Mat probabilities;
    for (int run = 0; run < 10; run++)
    {
        const double start = ncnn::get_current_time();
        ncnn::Extractor extractor = network->create_extractor();
        if (extractor.input("data", input) != 0 || extractor.extract("prob", probabilities) != 0)
            return -1;
        const double elapsed = ncnn::get_current_time() - start;
        values[6 + run] = static_cast<float>(elapsed);
        fastest = std::min(fastest, elapsed);
    }
    if (probabilities.total() != 1000 || probabilities.elempack != 1)
        return -1;

    std::vector<std::pair<float, int> > ranked;
    ranked.reserve(1000);
    for (int index = 0; index < 1000; index++)
    {
        if (!std::isfinite(probabilities[index]))
            return -1;
        ranked.push_back(std::make_pair(probabilities[index], index));
    }
    std::partial_sort(ranked.begin(), ranked.begin() + 3, ranked.end(),
                     std::greater<std::pair<float, int> >());
    for (int rank = 0; rank < 3; rank++)
    {
        values[rank * 2] = static_cast<float>(ranked[rank].second);
        values[rank * 2 + 1] = ranked[rank].first;
    }
    values[16] = static_cast<float>(fastest);
    std::copy(values, values + 17, output);
    return 0;
}

void ncnn_squeezenet_destroy()
{
    network.reset();
#if NCNN_VULKAN
    if (gpu_instance_created)
    {
        ncnn::destroy_gpu_instance();
        gpu_instance_created = false;
    }
#endif
}

} // extern "C"
