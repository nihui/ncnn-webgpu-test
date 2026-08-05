// Copyright 2026 Tencent
// SPDX-License-Identifier: BSD-3-Clause

const parameters = new URL(self.location.href).searchParams;
const backend = parameters.get("backend");
const gpuIndex = Number.parseInt(parameters.get("gpuIndex") || "0", 10);
const assetVersion = parameters.get("v") || "";
const validBackends = new Set(["wasm", "wasm-simd", "webgpu"]);
const backendKey = backend === "webgpu" ? `webgpu:${gpuIndex}` : backend;

if (!validBackends.has(backend)) {
    throw new Error(`unknown backend: ${backend}`);
}

let runtimePromise;

function assetUrl(path) {
    const url = new URL(path, self.location.href);
    if (assetVersion) url.searchParams.set("v", assetVersion);
    return url;
}

async function fetchBytes(path) {
    const response = await fetch(assetUrl(path));
    if (!response.ok) throw new Error(`failed to fetch ${path}: HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
}

async function createRuntime() {
    const moduleUrl = assetUrl(`./assets/squeezenet-${backend}.mjs`);
    const factory = (await import(moduleUrl)).default;
    const module = await factory({
        locateFile(path) {
            return assetUrl(`./assets/${path}`).href;
        },
        print(text) {
            console.log(`[${backend}] ${text}`);
        },
        printErr(text) {
            console.warn(`[${backend}] ${text}`);
        },
    });

    return module;
}

async function initializeRuntime() {
    const module = await createRuntime();
    const [param, model] = await Promise.all([
        fetchBytes("./models/squeezenet_v1.1.param"),
        fetchBytes("./models/squeezenet_v1.1.bin"),
    ]);
    module.FS_createPath("/", "models", true, true);
    module.FS_createDataFile("/models", "squeezenet_v1.1.param", param, true, false, true);
    module.FS_createDataFile("/models", "squeezenet_v1.1.bin", model, true, false, true);

    const initStart = performance.now();
    const initResult = await module.ccall(
        "ncnn_squeezenet_init",
        "number",
        ["number"],
        [gpuIndex],
        { async: true },
    );
    const initMs = performance.now() - initStart;
    if (initResult !== 0) throw new Error(`ncnn initialization failed: ${initResult}`);

    return { initMs, module };
}

async function runInference(message) {
    if (!runtimePromise) runtimePromise = initializeRuntime();
    const runtime = await runtimePromise;
    const module = runtime.module;
    const pixels = new Uint8Array(message.pixels);
    const inputPointer = module._malloc(pixels.byteLength);
    const resultPointer = module._malloc(17 * Float32Array.BYTES_PER_ELEMENT);
    let result;

    try {
        module.HEAPU8.set(pixels, inputPointer);
        const returnCode = await module.ccall(
            "ncnn_squeezenet_infer",
            "number",
            ["number", "number", "number", "number"],
            [inputPointer, message.width, message.height, resultPointer],
            { async: true },
        );
        if (returnCode !== 0) throw new Error(`ncnn inference failed: ${returnCode}`);

        const resultOffset = resultPointer / Float32Array.BYTES_PER_ELEMENT;
        const values = Array.from(module.HEAPF32.subarray(resultOffset, resultOffset + 17));
        result = {
            backend,
            backendKey,
            gpuIndex,
            initMs: runtime.initMs,
            fastestMs: values[16],
            results: [0, 1, 2].map((rank) => ({
                index: Math.trunc(values[rank * 2]),
                score: values[rank * 2 + 1],
            })),
            timings: values.slice(6, 16),
        };
    } finally {
        module._free(resultPointer);
        module._free(inputPointer);
    }

    return result;
}

async function listDevices() {
    if (backend !== "webgpu")
        return [];

    const module = await createRuntime();
    try {
        const count = await module.ccall(
            "ncnn_squeezenet_gpu_count",
            "number",
            [],
            [],
            { async: true },
        );
        if (count < 0)
            throw new Error(`WebGPU device enumeration failed: ${count}`);

        const capacity = 512;
        const namePointer = module._malloc(capacity);
        try {
            const decoder = new TextDecoder();
            const devices = [];
            for (let index = 0; index < count; index++) {
                const length = module.ccall(
                    "ncnn_squeezenet_gpu_name",
                    "number",
                    ["number", "number", "number"],
                    [index, namePointer, capacity],
                );
                if (length < 0)
                    throw new Error(`WebGPU device ${index} name query failed`);

                const byteLength = Math.min(length, capacity - 1);
                const name = decoder.decode(module.HEAPU8.subarray(namePointer, namePointer + byteLength));
                devices.push({ index, name: name || `WebGPU device ${index}` });
            }
            return devices;
        } finally {
            module._free(namePointer);
        }
    } finally {
        await module.ccall(
            "ncnn_squeezenet_destroy",
            null,
            [],
            [],
            { async: true },
        );
    }
}

self.addEventListener("message", async (event) => {
    try {
        if (event.data?.type === "list-devices") {
            const devices = await listDevices();
            self.postMessage({ devices, id: event.data.id, status: "pass" });
            return;
        }

        if (event.data?.type !== "run")
            return;

        const result = await runInference(event.data);
        self.postMessage({ id: event.data.id, status: "pass", ...result });
    } catch (error) {
        runtimePromise = undefined;
        self.postMessage({
            backend,
            backendKey,
            error: error?.stack || error?.message || String(error),
            id: event.data.id,
            status: "fail",
        });
    }
});
