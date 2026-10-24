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
NIKKI_PREFIX="$(cd "$NIKKI_PREFIX" && pwd)"
[[ "$(tr -d '\r\n' < "$NIKKI_PREFIX/source-revision.txt")" == "$NIKKI_REVISION" ]] || { echo 'nikki source revision mismatch' >&2; exit 1; }
[[ "$(tr -d '\r\n' < "$NIKKI_PREFIX/emsdk-version.txt")" == "6.0.12" ]] || { echo 'nikki emsdk mismatch' >&2; exit 1; }
[[ -f "$NIKKI_PREFIX/lib/cmake/nikki/nikkiConfig.cmake" ]] || { echo 'Not an installed nikki SDK' >&2; exit 1; }
NCNN_REVISION=cb65ca26ba955bf456f3a26e13e9a644769fc4a4
NCNN_SOURCE_DIR="${NCNN_SOURCE_DIR:-$ROOT/.deps/ncnn}"
BUILD_DIR="${BUILD_DIR:-$ROOT/build}"
if [[ ! -e "$NCNN_SOURCE_DIR" ]]; then
    git clone --no-checkout https://github.com/Tencent/ncnn.git "$NCNN_SOURCE_DIR"
    git -C "$NCNN_SOURCE_DIR" checkout --detach "$NCNN_REVISION"
    git -C "$NCNN_SOURCE_DIR" submodule update --init --depth 1 glslang
fi
[[ "$(git -C "$NCNN_SOURCE_DIR" rev-parse HEAD)" == "$NCNN_REVISION" ]] || { echo 'ncnn revision mismatch' >&2; exit 1; }
[[ -z "$(git -C "$NCNN_SOURCE_DIR" status --porcelain --untracked-files=no)" ]] || { echo 'ncnn checkout has local changes' >&2; exit 1; }
emcmake cmake -S "$ROOT" -B "$BUILD_DIR" -G Ninja \
    -DCMAKE_BUILD_TYPE=Release -Dnikki_DIR="$NIKKI_PREFIX/lib/cmake/nikki" \
    -DNCNN_SOURCE_DIR="$NCNN_SOURCE_DIR" -DSQUEEZENET_CPU_ORACLE=OFF
cmake --build "$BUILD_DIR" --target squeezenet-webgpu --parallel "${JOBS:-2}"
printf 'Built %s/assets/squeezenet-webgpu.{mjs,wasm}\n' "$BUILD_DIR"
