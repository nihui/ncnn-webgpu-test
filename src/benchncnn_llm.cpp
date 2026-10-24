// Copyright 2026 Tencent
// SPDX-License-Identifier: BSD-3-Clause

// Reuse the pinned ncnn implementation, including its 256-token prefill,
// one-token decode, KV-cache handling, zero weights, and warmup counts. Only
// replace the full-suite CLI with the single-model contract of our worker.
#define main ncnn_upstream_benchmark_main
#include "benchmark/benchncnn_llm.cpp"
#undef main

#include <cstdio>
#include "benchmark_common.h"

int main(int argc, char** argv)
{
    BenchmarkArguments args;
    if (!parse_benchmark_arguments(argc, argv, args))
        return -1;

    const ModelConfig* models[] = {
        &hunyuan::model,
        &minicpm4::model,
        &qwen25::model,
        &qwen3::model,
        &llama32::model,
        &tinyllama::model,
        &youtu_llm::model,
#if NCNN_WEIGHT_QUANT
        &hunyuan::model_int8g32, &hunyuan::model_int8g128,
        &minicpm4::model_int8g32, &minicpm4::model_int8g128,
        &qwen25::model_int8g32, &qwen25::model_int8g128,
        &qwen3::model_int8g32, &qwen3::model_int8g128,
        &llama32::model_int8g32, &llama32::model_int8g128,
        &tinyllama::model_int8g32, &tinyllama::model_int8g128,
        &youtu_llm::model_int8g32, &youtu_llm::model_int8g128,
#endif
    };
    const ModelConfig* selected = 0;
    for (size_t i = 0; i < sizeof(models) / sizeof(models[0]); ++i)
        if (std::strcmp(models[i]->name, args.model) == 0)
            selected = models[i];
    if (!selected)
    {
        std::fprintf(stderr, "unknown model %s\n", args.model);
        return -1;
    }
    // The existing UI runs quantized variants on CPU only. Do not silently
    // benchmark them on CPU under a WebGPU result label if called directly.
    if (args.gpu_device != -1 && selected->quantize_term)
    {
        std::fprintf(stderr, "weight-quantized model %s is not supported by this WebGPU benchmark\n", args.model);
        return -1;
    }

    BenchmarkRuntime runtime;
    ncnn::Option opt;
    if (runtime.initialize(args, true, opt) != 0)
        return -1;
    std::fprintf(stderr, "%30s  %12s  %12s\n", "model", "prefill tps", "decode tps");
    const int ret = benchmark_model(*selected, opt);
    if (ret != 0)
        std::fprintf(stderr, "benchmark %s failed %d\n", selected->name, ret);
    return ret;
}
