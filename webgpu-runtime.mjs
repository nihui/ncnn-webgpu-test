// Copyright 2026 Tencent
// SPDX-License-Identifier: BSD-3-Clause

export function supportsMemory64(wasm = globalThis.WebAssembly) {
    try {
        // memory64, minimum one page and the same 8 GiB maximum as the modules
        return wasm.validate(new Uint8Array([
            0, 97, 115, 109, 1, 0, 0, 0,
            5, 6, 1, 5, 1, 128, 128, 8,
        ]));
    } catch {
        return false;
    }
}

export function selectArchitecture(backend, navigator_ = globalThis.navigator, wasm = globalThis.WebAssembly) {
    if (backend !== "webgpu") return "wasm32";
    if (!navigator_?.gpu) throw new Error("WebGPU is not available in this browser");
    return supportsMemory64(wasm) ? "wasm64" : "wasm32";
}

export async function createDemoRuntime(stem, backend, assetUrl, options = {}) {
    const architecture = selectArchitecture(backend);
    const directory = architecture === "wasm64" ? "./assets/wasm64/" : "./assets/";
    const factory = (await import(assetUrl(`${directory}${stem}-${backend}.mjs`))).default;
    const module = await factory({
        ...options,
        locateFile(path) {
            return assetUrl(`${directory}${path}`).href;
        },
    });
    module.wasmArchitecture = architecture;
    return module;
}

// ccall converts pointer arguments/results for both memory32 and memory64;
// typed-array offsets stay Numbers without truncating addresses above 4 GiB
export function allocate(module, size) {
    const pointer = module.ccall("malloc", "pointer", ["pointer"], [size]);
    if (!pointer) throw new Error(`allocation failed: ${size} bytes`);
    return pointer;
}

export function release(module, pointer) {
    module.ccall("free", null, ["pointer"], [pointer]);
}
