#!/usr/bin/env python3
# Copyright 2026 Tencent
# SPDX-License-Identifier: BSD-3-Clause
"""Stage only runtime files, using newly built CPU and WebGPU modules."""
import argparse
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
STATIC_FILES = (
    "index.html", "app.js", "i18n.mjs", "styles.css", "backend-worker.mjs", "webgpu-runtime.mjs",
    "benchncnn.html", "benchncnn.js", "benchmark.css", "benchncnn-worker.mjs",
    "benchncnn_llm.html", "benchncnn_llm.js", "benchncnn-llm-worker.mjs",
    "vkpeak.html", "vkpeak.js", "vkpeak.css", "vkpeak-worker.mjs",
    "models/squeezenet_v1.1.param", "models/squeezenet_v1.1.bin", "models/synset_words.txt",
)
CPU_MODULES = ("squeezenet", "benchncnn", "benchncnn-llm")
GPU_MODULES = (*CPU_MODULES, "vkpeak")


def stage(module_dir, wasm64_module_dir, destination, cpu_module_dir=Path("build-cpu-wasm/assets"), simd_module_dir=Path("build-cpu-wasm-simd/assets")):
    files = [(ROOT / name, Path(name)) for name in STATIC_FILES]
    for module in CPU_MODULES:
        for backend, directory in (("wasm", cpu_module_dir), ("wasm-simd", simd_module_dir)):
            for suffix in ("mjs", "wasm"):
                name = Path("assets") / f"{module}-{backend}.{suffix}"
                files.append((directory / name.name, name))
    for directory, relative in ((module_dir, Path("assets")), (wasm64_module_dir, Path("assets/wasm64"))):
        for module in GPU_MODULES:
            for suffix in ("mjs", "wasm"):
                name = f"{module}-webgpu.{suffix}"
                files.append((directory / name, relative / name))

    # Validate the complete input set before creating any output. Never fall back
    # to a committed module or leave stale output from a previous build.
    if destination.exists() or destination.is_symlink():
        raise ValueError(f"Destination already exists: {destination}")
    if module_dir.resolve() == wasm64_module_dir.resolve():
        raise ValueError("Use separate newly built wasm32 and wasm64 module directories")
    for directory in (module_dir, wasm64_module_dir, cpu_module_dir, simd_module_dir):
        if directory.resolve().is_relative_to((ROOT / "assets").resolve()):
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
    parser.add_argument("--wasm64-module-dir", type=Path, default=Path("build-wasm64/assets"))
    parser.add_argument("--cpu-module-dir", type=Path, default=Path("build-cpu-wasm/assets"))
    parser.add_argument("--simd-module-dir", type=Path, default=Path("build-cpu-wasm-simd/assets"))
    parser.add_argument("--output", type=Path, default=Path("_site"))
    args = parser.parse_args()
    try:
        stage(args.module_dir, args.wasm64_module_dir, args.output, args.cpu_module_dir, args.simd_module_dir)
    except (OSError, ValueError) as error:
        parser.exit(1, f"{error}\n")
