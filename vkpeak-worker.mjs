// Copyright 2026 Tencent
// SPDX-License-Identifier: BSD-3-Clause

const parameters = new URL(self.location.href).searchParams;
const gpuIndex = Number.parseInt(parameters.get("gpuIndex") || "0", 10);
const assetVersion = parameters.get("v") || "";

function assetUrl(path) {
    const url = new URL(path, self.location.href);
    if (assetVersion) url.searchParams.set("v", assetVersion);
    return url;
}

async function createRuntime() {
    const factory = (await import(assetUrl("./assets/vkpeak-webgpu.mjs"))).default;
    return factory({
        locateFile(path) {
            return assetUrl(`./assets/${path}`).href;
        },
        print(text) {
            console.log(`[vkpeak:${gpuIndex}] ${text}`);
        },
        printErr(text) {
            console.warn(`[vkpeak:${gpuIndex}] ${text}`);
        },
    });
}

async function listEnvironment() {
    const module = await createRuntime();
    const capacity = 256;
    const pointer = module._malloc(capacity);
    try {
        const count = await module.ccall("ncnn_vkpeak_gpu_count", "number", [], [], { async: true });
        if (count < 0) throw new Error("WebGPU 设备枚举失败");

        const devices = [];
        for (let index = 0; index < count; index++) {
            const name = readString(module, "ncnn_vkpeak_gpu_name", index, pointer, capacity);
            devices.push({ index, name });
        }

        const scenarioCount = module.ccall("ncnn_vkpeak_scenario_count", "number", [], []);
        const scenarios = [];
        for (let index = 0; index < scenarioCount; index++) {
            const name = readString(module, "ncnn_vkpeak_scenario_name", index, pointer, capacity);
            const unit = readString(module, "ncnn_vkpeak_scenario_unit", index, pointer, capacity);
            scenarios.push({ name, unit });
        }
        return { devices, scenarios };
    } finally {
        module._free(pointer);
        await module.ccall("ncnn_vkpeak_destroy", null, [], [], { async: true });
    }
}

function readString(module, functionName, index, pointer, capacity) {
    const length = module.ccall(
        functionName,
        "number",
        ["number", "number", "number"],
        [index, pointer, capacity],
    );
    if (length < 0) throw new Error(`${functionName}(${index}) failed`);
    const size = Math.min(length, capacity - 1);
    return new TextDecoder().decode(module.HEAPU8.subarray(pointer, pointer + size));
}

async function runBenchmark(requestId) {
    const module = await createRuntime();
    const capacity = 64;
    const pointer = module._malloc(capacity);
    const results = [];

    try {
        const scenarioCount = module.ccall("ncnn_vkpeak_scenario_count", "number", [], []);
        for (let index = 0; index < scenarioCount; index++) {
            const name = readString(module, "ncnn_vkpeak_scenario_name", index, pointer, capacity);
            const unit = readString(module, "ncnn_vkpeak_scenario_unit", index, pointer, capacity);
            const supported = await module.ccall(
                "ncnn_vkpeak_scenario_supported",
                "number",
                ["number", "number"],
                [gpuIndex, index],
                { async: true },
            );

            if (supported < 0) throw new Error(`设备 ${gpuIndex} 能力查询失败`);
            if (!supported) {
                results.push({ name, score: null, status: "unsupported", unit });
                self.postMessage({ id: requestId, index, name, status: "progress", supported: false });
                continue;
            }

            self.postMessage({ id: requestId, index, name, status: "progress", supported: true });
            const score = await module.ccall(
                "ncnn_vkpeak_run",
                "number",
                ["number", "number"],
                [gpuIndex, index],
                { async: true },
            );
            results.push({
                name,
                score: Number.isFinite(score) && score > 0 ? score : null,
                status: Number.isFinite(score) && score > 0 ? "pass" : "fail",
                unit,
            });
        }

        return results;
    } finally {
        module._free(pointer);
        await module.ccall("ncnn_vkpeak_destroy", null, [], [], { async: true });
    }
}

self.addEventListener("message", async (event) => {
    if (event.data?.type !== "run" && event.data?.type !== "list-devices") return;

    try {
        if (event.data.type === "list-devices") {
            const environment = await listEnvironment();
            self.postMessage({ ...environment, id: event.data.id, status: "pass" });
            return;
        }

        const results = await runBenchmark(event.data.id);
        self.postMessage({ gpuIndex, id: event.data.id, results, status: "pass" });
    } catch (error) {
        self.postMessage({
            error: error?.stack || error?.message || String(error),
            gpuIndex,
            id: event.data.id,
            status: "fail",
        });
    }
});
