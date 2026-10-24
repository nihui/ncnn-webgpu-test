#!/usr/bin/env bash
# Copyright 2026 Tencent
# SPDX-License-Identifier: BSD-3-Clause
set -euo pipefail
: "${NIKKI_VERSION:?Set NIKKI_VERSION to a published YYYYMMDD nikki SDK release}"
: "${NIKKI_REVISION:?Set NIKKI_REVISION to the full release source commit}"
[[ "$NIKKI_VERSION" =~ ^[0-9]{8}$ ]] || { echo 'Invalid YYYYMMDD release version' >&2; exit 1; }
[[ "$NIKKI_REVISION" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid source revision' >&2; exit 1; }
DESTINATION="${1:-.deps/nikki}"
[[ ! -e "$DESTINATION" ]] || { echo "Destination already exists: $DESTINATION" >&2; exit 1; }
PARENT="$(dirname "$DESTINATION")"
mkdir -p "$PARENT"
TEMP="$(mktemp -d "$PARENT/.nikki-download.XXXXXX")"
trap 'rm -rf "$TEMP"' EXIT
ARCHIVE="nikki-${NIKKI_VERSION}-wasm32-emscripten.tar.gz"
URL="https://github.com/nihui/nikki/releases/download/${NIKKI_VERSION}/${ARCHIVE}"
# A missing or unpublished release fails here. No source build or floating latest.
curl --fail --location --retry 3 --output "$TEMP/$ARCHIVE" "$URL"
python3 - "$TEMP/$ARCHIVE" "$DESTINATION" <<'PY'
import os, pathlib, shutil, sys, tarfile

def require(condition, message):
    if not condition:
        raise SystemExit(message)

archive_path, destination = map(pathlib.Path, sys.argv[1:])
unpacked = archive_path.parent / 'unpacked'
with tarfile.open(archive_path) as archive:
    archive.extractall(unpacked, filter='data')
roots = list(unpacked.iterdir())
require(len(roots) == 1 and roots[0].is_dir(), 'Expected one package root')
package = roots[0]
require(package.name == f'nikki-{os.environ["NIKKI_VERSION"]}-wasm32-emscripten', 'Unexpected package root')
require((package / 'release-version.txt').read_text().strip() == os.environ['NIKKI_VERSION'], 'Package version mismatch')
require((package / 'source-revision.txt').read_text().strip() == os.environ['NIKKI_REVISION'], 'Package source SHA mismatch')
require((package / 'emsdk-version.txt').read_text().strip() == '5.0.6', 'Package emsdk mismatch')
require((package / 'lib/cmake/nikki/nikkiConfig.cmake').is_file(), 'Missing installed CMake package')
shutil.move(str(package), destination)
PY
printf 'Downloaded nikki %s at source %s to %s\n' "$NIKKI_VERSION" "$NIKKI_REVISION" "$DESTINATION"
