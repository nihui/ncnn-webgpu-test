// Copyright 2026 Tencent
// SPDX-License-Identifier: BSD-3-Clause
// run the production workers with a mock runtime, without an SDK or GPU
import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const directory = await mkdtemp(join(tmpdir(), "webgpu-worker-diagnostics-"));
const originalConsole = globalThis.console;
const originalSelf = globalThis.self;
const observations = [];
try {
    await writeFile(join(directory, "webgpu-runtime.mjs"), `
        export async function createDemoRuntime(stem, backend, assetUrl, options) {
            const fixture = globalThis.workerFixture;
            (options.printErr || console.error)("nikki device information");
            (options.print || console.log)("runtime ready");
            if (!options.noInitialRun) {
                options.printErr(stem === "benchncnn" ? "blazeface min = 1.00 max = 3.00 avg = 2.00" : "test_llm 12.00 34.00");
                options.onExit(0);
            }
            const HEAPU8 = new Uint8Array(1024);
            return {
                wasmArchitecture: "wasm64", HEAPU8,
                ccall(name) {
                    if (name === "ncnn_benchmark_gpu_count") {
                        if (fixture.fail) throw new Error("actual device enumeration failure");
                        return 1;
                    }
                    if (name === "ncnn_benchmark_gpu_name") {
                        HEAPU8.set(new TextEncoder().encode("mock GPU"), 16);
                        return 8;
                    }
                    if (name === "ncnn_benchmark_destroy_gpu_instance") fixture.destroyed++;
                },
            };
        }
        export function allocate() { return 16; }
        export function release() { globalThis.workerFixture.released++; }
    `);
    for (const stem of ["benchncnn", "benchncnn-llm"]) {
        const path = join(directory, `${stem}-worker.mjs`);
        await copyFile(new URL(`../${stem}-worker.mjs`, import.meta.url), path);
        for (const mode of ["list", "failure", "benchmark"]) {
            const logs = { log: [], warn: [], error: [] };
            globalThis.console = Object.fromEntries(Object.keys(logs).map(level => [level, text => logs[level].push(String(text))]));
            globalThis.workerFixture = { fail: mode === "failure", released: 0, destroyed: 0 };
            let listener;
            const messages = [];
            globalThis.self = {
                location: { href: `https://example.test/project/${stem}-worker.mjs?backend=webgpu&gpuIndex=0` },
                addEventListener(type, callback) { assert.equal(type, "message"); listener = callback; },
                postMessage(message) { messages.push(message); },
            };
            await import(`${pathToFileURL(path).href}?case=${mode}`);
            await listener({ data: { id: 1, type: mode === "benchmark" ? "run" : "list-devices", model: "fixture", loopCount: 1 } });
            assert.equal(logs.error.length, 0, `${stem}/${mode}: ordinary stderr must not be console.error`);
            assert.ok(logs.warn.includes(`[${stem}:webgpu] nikki device information`));
            const result = messages.at(-1);
            if (mode === "failure") {
                assert.equal(result.status, "fail");
                assert.match(result.error, /actual device enumeration failure/);
            } else {
                assert.equal(result.status, "pass", JSON.stringify(result));
                assert.equal(result.architecture, "wasm64");
                if (mode === "list") assert.deepEqual(result.devices, [{ index: 0, name: "mock GPU" }]);
                else {
                    assert.equal(result.results.length, 1, "benchmark-specific print handlers must override defaults");
                    assert.ok(messages.some(message => message.status === "progress"));
                }
            }
            if (mode !== "benchmark") {
                assert.equal(globalThis.workerFixture.released, 1);
                assert.equal(globalThis.workerFixture.destroyed, 1);
            }
            observations.push({ stem, mode, status: "pass" });
        }
    }
} finally {
    globalThis.console = originalConsole;
    if (originalSelf === undefined) delete globalThis.self;
    else globalThis.self = originalSelf;
    delete globalThis.workerFixture;
    await rm(directory, { recursive: true, force: true });
}
console.log(JSON.stringify({ status: "pass", mockRuntime: true, gpuInferenceExecuted: false, observations }));
