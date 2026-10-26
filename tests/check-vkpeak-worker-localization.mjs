// Copyright 2026 Tencent
// SPDX-License-Identifier: BSD-3-Clause
// Execute the production worker and translator in real Node worker threads.
// Only the WebGPU runtime is mocked; no SDK, GPU, or inference is involved.
import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { pathToFileURL } from "node:url";

const directory = await mkdtemp(join(tmpdir(), "vkpeak-worker-localization-"));
const cases = [];
try {
    for (const file of ["vkpeak-worker.mjs", "i18n.mjs"]) {
        await copyFile(new URL(`../${file}`, import.meta.url), join(directory, file));
    }
    await writeFile(join(directory, "webgpu-runtime.mjs"), `
        export async function createDemoRuntime() {
            const heap = new Uint8Array(1024);
            return {
                wasmArchitecture: "wasm64", HEAPU8: heap,
                ccall(name) {
                    const f = globalThis.fixture;
                    if (name === "ncnn_vkpeak_destroy") { f.destroyed++; return; }
                    if (f.mode === "runtime-error") throw new Error("driver diagnostic: DEVICE_LOST 73");
                    if (name === "ncnn_vkpeak_gpu_count") return -1;
                    if (name === "ncnn_vkpeak_scenario_count") return 1;
                    if (name === "ncnn_vkpeak_scenario_supported") return -1;
                    if (name === "ncnn_vkpeak_run") throw new Error("must not execute unsupported benchmark");
                    if (name === "ncnn_vkpeak_scenario_name" || name === "ncnn_vkpeak_scenario_unit") {
                        if (f.mode === "string-error") return -1;
                        heap.set(new TextEncoder().encode("fp32"), 16);
                        return 4;
                    }
                    throw new Error("unexpected call: " + name);
                },
            };
        }
        export function allocate() { globalThis.fixture.allocated++; return 16; }
        export function release(module, pointer) {
            if (pointer !== 16) throw new Error("wrong allocation released");
            globalThis.fixture.released++;
        }
    `);
    await writeFile(join(directory, "entry.mjs"), `
        import { parentPort, workerData } from "node:worker_threads";
        Object.defineProperty(globalThis, "navigator", { value: { languages: [workerData.locale] }, configurable: true });
        globalThis.fixture = { mode: workerData.mode, allocated: 0, released: 0, destroyed: 0 };
        let listener;
        globalThis.self = {
            location: { href: "https://example.test/project/vkpeak-worker.mjs?gpuIndex=7" },
            addEventListener(type, callback) { listener = callback; },
            postMessage(message) { parentPort.postMessage({ message, fixture: globalThis.fixture }); },
        };
        await import("./vkpeak-worker.mjs");
        await listener({ data: { id: 42, type: workerData.mode === "enumeration" || workerData.mode === "runtime-error" ? "list-devices" : "run" } });
    `);
    for (const locale of ["en-US", "zh-TW"]) {
        for (const mode of ["enumeration", "capability", "runtime-error", "string-error"]) {
            const worker = new Worker(pathToFileURL(join(directory, "entry.mjs")), { workerData: { locale, mode } });
            const messages = [];
            try {
                await new Promise((resolve, reject) => {
                    worker.on("message", message => messages.push(message));
                    worker.on("error", reject);
                    worker.on("exit", code => code === 0 ? resolve() : reject(new Error(`Worker exit ${code}`)));
                });
                assert.equal(messages.length, 1, "one failure, no success/progress");
                const { message, fixture } = messages[0];
                assert.equal(message.id, 42);
                assert.equal(message.gpuIndex, 7);
                assert.equal(message.status, "fail");
                assert.equal(fixture.allocated, 1);
                assert.equal(fixture.released, 1);
                assert.equal(fixture.destroyed, 1);
                const expected = mode === "runtime-error" ? "driver diagnostic: DEVICE_LOST 73"
                    : mode === "string-error" ? "ncnn_vkpeak_scenario_name(0) failed"
                    : mode === "enumeration" ? (locale.startsWith("en") ? "WebGPU device enumeration failed" : "WebGPU 设备枚举失败")
                    : (locale.startsWith("en") ? "Device 7 capability query failed" : "设备 7 能力查询失败");
                assert.equal(message.error.split("\n")[0], `Error: ${expected}`);
                if (locale.startsWith("en")) assert.doesNotMatch(message.error, /[\u3400-\u9fff]/);
                cases.push({ locale, mode, status: "pass" });
            } finally {
                await worker.terminate();
            }
        }
    }
} finally {
    await rm(directory, { recursive: true, force: true });
}
console.log(JSON.stringify({ status: "pass", productionWorker: true, mockedRuntime: true, gpuInferenceExecuted: false, cases }));
