#!/usr/bin/env bash
# Copyright 2026 Tencent
# SPDX-License-Identifier: BSD-3-Clause
set -euo pipefail
# Keep the original minimal build entry point; all demos share SDK validation.
export NCNN_WEBGPU_EXTRA_DEMOS=OFF
exec "$(dirname "${BASH_SOURCE[0]}")/build-webgpu.sh" squeezenet-webgpu
