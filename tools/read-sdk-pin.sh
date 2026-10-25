#!/usr/bin/env bash
# Copyright 2026 Tencent
# SPDX-License-Identifier: BSD-3-Clause
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# No environment or manual-run override: deployment uses the reviewed repo pin.
NIKKI_VERSION=
NIKKI_REVISION=
source "$ROOT/config/nikki-sdk.env"
if [[ ! "$NIKKI_VERSION" =~ ^[0-9]{8}$ || ! "$NIKKI_REVISION" =~ ^[0-9a-f]{40}$ ]]; then
    echo '::error::Configure config/nikki-sdk.env with a published YYYYMMDD SDK release and its full source SHA. No SDK release is selected; build and deployment are blocked.' >&2
    exit 1
fi
printf 'NIKKI_VERSION=%s\nNIKKI_REVISION=%s\n' "$NIKKI_VERSION" "$NIKKI_REVISION"
