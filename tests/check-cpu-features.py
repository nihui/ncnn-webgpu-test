#!/usr/bin/env python3
# Copyright 2026 Tencent
# SPDX-License-Identifier: BSD-3-Clause
"""Validate that scalar modules work without SIMD and SIMD modules require it."""
import argparse
import os
from pathlib import Path
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("scalar", type=Path)
parser.add_argument("simd", type=Path)
parser.add_argument("--wasm-opt", default=str(Path(os.environ.get("EMSDK", "")) / "upstream/bin/wasm-opt"))
args = parser.parse_args()
with tempfile.TemporaryDirectory() as temporary:
    output = Path(temporary) / "validated.wasm"
    for backend, directory in (("wasm", args.scalar), ("wasm-simd", args.simd)):
        for stem in ("squeezenet", "benchncnn", "benchncnn-llm"):
            source = directory / f"{stem}-{backend}.wasm"
            # First require a valid module, so the negative SIMD check cannot
            # mistake a missing file or malformed binary for a feature rejection.
            subprocess.run([args.wasm_opt, str(source), "--all-features", "-o", str(output)], check=True)
            with tempfile.TemporaryFile() as log:
                result = subprocess.run([args.wasm_opt, str(source), "--all-features", "--disable-simd", "--disable-relaxed-simd", "-o", str(output)], stdout=log, stderr=log)
                log.seek(0)
                diagnostic = log.read(8192).decode("utf-8", errors="replace")
            if backend == "wasm" and result.returncode:
                raise RuntimeError(f"Scalar module requires unsupported features: {source}\n{diagnostic}")
            if backend == "wasm-simd" and (result.returncode == 0 or "SIMD" not in diagnostic):
                raise RuntimeError(f"SIMD module was not rejected for SIMD instructions: {source}\n{diagnostic}")
            print(f"Validated {source}: {backend}")
