#!/usr/bin/env bash
# Copyright 2026 Tencent
# SPDX-License-Identifier: BSD-3-Clause
set -euo pipefail
# Bound final-link optimizer concurrency without changing optimization or Asyncify.
export BINARYEN_CORES="${BINARYEN_CORES:-1}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${NIKKI_PREFIX:?Set NIKKI_PREFIX to the extracted prebuilt nikki SDK}"
: "${NIKKI_REVISION:?Set NIKKI_REVISION to its expected 40-character producer commit}"
[[ "$NIKKI_REVISION" =~ ^[0-9a-f]{40}$ ]] || { echo 'NIKKI_REVISION must be a full commit SHA' >&2; exit 1; }
WASM_ARCH="${WASM_ARCH:-wasm32}"
case "$WASM_ARCH" in
    wasm32) arch_flags=; default_build=build ;;
    wasm64) arch_flags=-m64; default_build=build-wasm64 ;;
    *) echo 'WASM_ARCH must be wasm32 or wasm64' >&2; exit 1 ;;
esac
NIKKI_PREFIX="$(cd "$NIKKI_PREFIX" && pwd)"
[[ "$(tr -d '\r\n' < "$NIKKI_PREFIX/architecture.txt")" == "$WASM_ARCH" ]] || { echo 'nikki architecture mismatch' >&2; exit 1; }
[[ "$(tr -d '\r\n' < "$NIKKI_PREFIX/source-revision.txt")" == "$NIKKI_REVISION" ]] || { echo 'nikki source revision mismatch' >&2; exit 1; }
[[ "$(tr -d '\r\n' < "$NIKKI_PREFIX/emsdk-version.txt")" == "6.0.12" ]] || { echo 'nikki emsdk mismatch' >&2; exit 1; }
[[ -f "$NIKKI_PREFIX/lib/cmake/nikki/nikkiConfig.cmake" ]] || { echo 'Not an installed nikki SDK' >&2; exit 1; }
NCNN_REVISION=cb65ca26ba955bf456f3a26e13e9a644769fc4a4
NCNN_SOURCE_DIR="${NCNN_SOURCE_DIR:-$ROOT/.deps/ncnn}"
BUILD_DIR="${BUILD_DIR:-$ROOT/$default_build}"
VKPEAK_REVISION=f37dab4c421781bf047face221dbaf6ae112a5e7
VKPEAK_SOURCE_DIR="${VKPEAK_SOURCE_DIR:-$ROOT/.deps/vkpeak}"
if [[ ! -e "$NCNN_SOURCE_DIR" ]]; then
    git clone --no-checkout https://github.com/Tencent/ncnn.git "$NCNN_SOURCE_DIR"
    git -C "$NCNN_SOURCE_DIR" checkout --detach "$NCNN_REVISION"
    git -C "$NCNN_SOURCE_DIR" submodule update --init --depth 1 glslang
fi
[[ "$(git -C "$NCNN_SOURCE_DIR" rev-parse HEAD)" == "$NCNN_REVISION" ]] || { echo 'ncnn revision mismatch' >&2; exit 1; }
[[ -z "$(git -C "$NCNN_SOURCE_DIR" status --porcelain --untracked-files=no)" ]] || { echo 'ncnn checkout has local changes' >&2; exit 1; }
if [[ "${NCNN_WEBGPU_EXTRA_DEMOS:-ON}" == ON ]]; then
    if [[ ! -e "$VKPEAK_SOURCE_DIR" ]]; then
        git clone --no-checkout https://github.com/nihui/vkpeak.git "$VKPEAK_SOURCE_DIR"
        git -C "$VKPEAK_SOURCE_DIR" checkout --detach "$VKPEAK_REVISION"
    fi
    [[ "$(git -C "$VKPEAK_SOURCE_DIR" rev-parse HEAD)" == "$VKPEAK_REVISION" ]] || { echo 'vkpeak revision mismatch' >&2; exit 1; }
    [[ -z "$(git -C "$VKPEAK_SOURCE_DIR" status --porcelain --untracked-files=no)" ]] || { echo 'vkpeak checkout has local changes' >&2; exit 1; }
fi
emcmake cmake -S "$ROOT" -B "$BUILD_DIR" -G Ninja \
    -DCMAKE_C_FLAGS="$arch_flags" -DCMAKE_CXX_FLAGS="$arch_flags" -DCMAKE_EXE_LINKER_FLAGS="$arch_flags" \
    -DNCNN_WEBGPU_WASM_ARCH="$WASM_ARCH" \
    -DCMAKE_BUILD_TYPE=Release -Dnikki_DIR="$NIKKI_PREFIX/lib/cmake/nikki" \
    -DNCNN_SOURCE_DIR="$NCNN_SOURCE_DIR" -DVKPEAK_SOURCE_DIR="$VKPEAK_SOURCE_DIR" -DSQUEEZENET_CPU_ORACLE=OFF \
    -DNCNN_WEBGPU_EXTRA_DEMOS="${NCNN_WEBGPU_EXTRA_DEMOS:-ON}"
if [[ $# == 0 ]]; then
    set -- squeezenet-webgpu benchncnn-webgpu benchncnn-llm-webgpu vkpeak-webgpu
fi
for target in "$@"; do
    case "$target" in
        squeezenet-webgpu|benchncnn-webgpu|benchncnn-llm-webgpu|vkpeak-webgpu) ;;
        *) echo "Unknown demo target: $target" >&2; exit 1 ;;
    esac
    # Serialize large final links even when compilation uses several jobs.
    cmake --build "$BUILD_DIR" --target "$target" --parallel "${JOBS:-2}"
    printf 'Built %s/assets/%s.{mjs,wasm}\n' "$BUILD_DIR" "$target"
done
