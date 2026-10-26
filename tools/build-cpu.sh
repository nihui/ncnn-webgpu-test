#!/usr/bin/env bash
# Copyright 2026 Tencent
# SPDX-License-Identifier: BSD-3-Clause
set -euo pipefail
export BINARYEN_CORES="${BINARYEN_CORES:-1}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CPU_BACKEND="${CPU_BACKEND:-wasm}"
case "$CPU_BACKEND" in
    wasm) flags= ;;
    wasm-simd) flags=-msimd128 ;;
    *) echo 'CPU_BACKEND must be wasm or wasm-simd' >&2; exit 1 ;;
esac
NCNN_REVISION=cb65ca26ba955bf456f3a26e13e9a644769fc4a4
NCNN_SOURCE_DIR="${NCNN_SOURCE_DIR:-$ROOT/.deps/ncnn}"
BUILD_DIR="${BUILD_DIR:-$ROOT/build-cpu-$CPU_BACKEND}"
if [[ ! -e "$NCNN_SOURCE_DIR" ]]; then
    git clone --no-checkout https://github.com/Tencent/ncnn.git "$NCNN_SOURCE_DIR"
    git -C "$NCNN_SOURCE_DIR" checkout --detach "$NCNN_REVISION"
fi
[[ "$(git -C "$NCNN_SOURCE_DIR" rev-parse HEAD)" == "$NCNN_REVISION" ]] || { echo 'ncnn revision mismatch' >&2; exit 1; }
[[ -z "$(git -C "$NCNN_SOURCE_DIR" status --porcelain --untracked-files=no)" ]] || { echo 'ncnn checkout has local changes' >&2; exit 1; }
emcmake cmake -S "$ROOT" -B "$BUILD_DIR" -G Ninja \
    -DCMAKE_C_FLAGS="$flags" -DCMAKE_CXX_FLAGS="$flags" -DCMAKE_EXE_LINKER_FLAGS="$flags" \
    -DCMAKE_BUILD_TYPE=Release -DNCNN_SOURCE_DIR="$NCNN_SOURCE_DIR" \
    -DNCNN_WEBGPU_WASM_ARCH=wasm32 -DNCNN_CPU_BACKEND="$CPU_BACKEND" \
    -DSQUEEZENET_CPU_ORACLE=OFF -DNCNN_WEBGPU_EXTRA_DEMOS=ON
for stem in squeezenet benchncnn benchncnn-llm; do
    cmake --build "$BUILD_DIR" --target "$stem-$CPU_BACKEND" --parallel "${JOBS:-2}"
done
