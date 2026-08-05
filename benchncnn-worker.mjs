// Copyright 2026 Tencent
// SPDX-License-Identifier: BSD-3-Clause

const parameters = new URL(self.location.href).searchParams;
const backend = parameters.get("backend");
const gpuIndex = Number.parseInt(parameters.get("gpuIndex") || "0", 10);
const assetVersion = parameters.get("v") || "";
const validBackends = new Set(["wasm", "wasm-simd", "webgpu"]);

if (!validBackends.has(backend)) throw new Error(`unknown backend: ${backend}`);

function assetUrl(path) {
    const url = new URL(path, self.location.href);
    if (assetVersion) url.searchParams.set("v", assetVersion);
    return url;
}

async function createRuntime(options = {}) {
    const factory = (await import(assetUrl(`./assets/benchncnn-${backend}.mjs`))).default;
    return factory({
        locateFile(path) {
            return assetUrl(`./assets/${path}`).href;
        },
        ...options,
    });
}

function parseResult(line) {
    const match = line.match(/^\s*(\S+)\s+min\s*=\s*([0-9.]+)\s+max\s*=\s*([0-9.]+)\s+avg\s*=\s*([0-9.]+)/);
    if (!match) return null;

    return {
        avg: Number.parseFloat(match[4]),
        max: Number.parseFloat(match[3]),
        min: Number.parseFloat(match[2]),
        name: match[1],
    };
}

async function listDevices() {
    if (backend !== "webgpu") return [];

    const module = await createRuntime({ noInitialRun: true });
    const capacity = 512;
    const pointer = module._malloc(capacity);
    try {
        const count = await module.ccall("ncnn_benchmark_gpu_count", "number", [], [], { async: true });
        if (count < 0) throw new Error(`WebGPU device enumeration failed: ${count}`);

        const decoder = new TextDecoder();
        const devices = [];
        for (let index = 0; index < count; index++) {
            const length = module.ccall(
                "ncnn_benchmark_gpu_name",
                "number",
                ["number", "number", "number"],
                [index, pointer, capacity],
            );
            if (length < 0) throw new Error(`WebGPU device ${index} name query failed`);

            const size = Math.min(length, capacity - 1);
            const name = decoder.decode(module.HEAPU8.subarray(pointer, pointer + size));
            devices.push({ index, name: name || `WebGPU device ${index}` });
        }
        return devices;
    } finally {
        module._free(pointer);
        await module.ccall("ncnn_benchmark_destroy_gpu_instance", null, [], [], { async: true });
    }
}

async function runBenchmark(message) {
    const results = [];
    let resolveExit;
    let rejectExit;
    const exitPromise = new Promise((resolve, reject) => {
        resolveExit = resolve;
        rejectExit = reject;
    });
    const arguments_ = [
        String(message.loopCount),
        "1",
        "2",
        backend === "webgpu" ? String(gpuIndex) : "-1",
        "0",
        `model=${message.model}`,
    ];

    const handleLine = (text, isError) => {
        const line = String(text);
        if (isError) console.warn(`[benchncnn:${backend}] ${line}`);
        else console.log(`[benchncnn:${backend}] ${line}`);

        const result = parseResult(line);
        if (!result) return;

        results.push(result);
        self.postMessage({ id: message.id, result, status: "progress" });
    };

    await createRuntime({
        arguments: arguments_,
        onAbort(reason) {
            rejectExit(new Error(`benchncnn aborted: ${reason}`));
        },
        onExit(status) {
            if (status === 0) resolveExit();
            else rejectExit(new Error(`benchncnn exited with status ${status}`));
        },
        print(text) {
            handleLine(text, false);
        },
        printErr(text) {
            handleLine(text, true);
        },
    });
    await exitPromise;

    if (results.length !== 1) throw new Error(`benchncnn produced ${results.length} of 1 benchmark results`);
    return results;
}

self.addEventListener("message", async (event) => {
    if (event.data?.type !== "run" && event.data?.type !== "list-devices") return;

    try {
        if (event.data.type === "list-devices") {
            const devices = await listDevices();
            self.postMessage({ devices, id: event.data.id, status: "pass" });
            return;
        }

        const results = await runBenchmark(event.data);
        self.postMessage({ backend, gpuIndex, id: event.data.id, results, status: "pass" });
    } catch (error) {
        self.postMessage({
            backend,
            error: error?.stack || error?.message || String(error),
            gpuIndex,
            id: event.data.id,
            status: "fail",
        });
    }
});
