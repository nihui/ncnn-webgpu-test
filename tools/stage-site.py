#!/usr/bin/env python3
# Copyright 2026 Tencent
# SPDX-License-Identifier: BSD-3-Clause
"""Stage only runtime files, replacing all four WebGPU pairs with this build."""
import argparse
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
STATIC_FILES = (
    "index.html", "app.js", "styles.css", "backend-worker.mjs",
    "benchncnn.html", "benchncnn.js", "benchmark.css", "benchncnn-worker.mjs",
    "benchncnn_llm.html", "benchncnn_llm.js", "benchncnn-llm-worker.mjs",
    "vkpeak.html", "vkpeak.js", "vkpeak.css", "vkpeak-worker.mjs",
    "models/squeezenet_v1.1.param", "models/squeezenet_v1.1.bin", "models/synset_words.txt",
)
CPU_MODULES = ("squeezenet", "benchncnn", "benchncnn-llm")
GPU_MODULES = (*CPU_MODULES, "vkpeak")


def stage(module_dir, destination):
    files = [(ROOT / name, Path(name)) for name in STATIC_FILES]
    for module in CPU_MODULES:
        for backend in ("wasm", "wasm-simd"):
            for suffix in ("mjs", "wasm"):
                name = Path("assets") / f"{module}-{backend}.{suffix}"
                files.append((ROOT / name, name))
    for module in GPU_MODULES:
        for suffix in ("mjs", "wasm"):
            name = f"{module}-webgpu.{suffix}"
            files.append((module_dir / name, Path("assets") / name))

    # Validate the complete input set before creating any output. Never fall back
    # to a committed WebGPU asset or leave stale output from a previous build.
    if destination.exists() or destination.is_symlink():
        raise ValueError(f"Destination already exists: {destination}")
    if module_dir.resolve() == (ROOT / "assets").resolve():
        raise ValueError("Use newly built modules, not the committed assets directory")
    for source, _ in files:
        if any(path.is_symlink() for path in (source, *source.parents)) or not source.is_file() or source.stat().st_size == 0:
            raise ValueError(f"Missing, empty or linked runtime file: {source}")
    destination.mkdir(parents=True)
    for source, relative in files:
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    print(f"Staged {len(files)} runtime files in {destination}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--module-dir", type=Path, default=Path("build/assets"))
    parser.add_argument("--output", type=Path, default=Path("_site"))
    args = parser.parse_args()
    try:
        stage(args.module_dir, args.output)
    except (OSError, ValueError) as error:
        parser.exit(1, f"{error}\n")
