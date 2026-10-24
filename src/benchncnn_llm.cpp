// Copyright 2026 Tencent
// SPDX-License-Identifier: BSD-3-Clause

// This is the pinned upstream source with patches/ncnn-benchmarks.patch.
// Keep the benchmark, options and model catalogue in ncnn, not in this demo.
#define main ncnn_upstream_benchmark_main
#include "benchmark/benchncnn_llm.cpp"
#undef main

#include "benchmark_common.h"

int main(int argc, char** argv)
{
    return run_web_benchmark(argc, argv, ncnn_upstream_benchmark_main);
}
