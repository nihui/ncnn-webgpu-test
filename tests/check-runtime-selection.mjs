// Copyright 2026 Tencent
// SPDX-License-Identifier: BSD-3-Clause
import assert from "node:assert/strict";
import { allocate, createDemoRuntime, release, selectArchitecture, supportsMemory64 } from "../webgpu-runtime.mjs";

const memory64 = { validate: () => true };
const memory32 = { validate: () => false };
assert.equal(selectArchitecture("webgpu", { gpu: {} }, memory64), "wasm64");
assert.equal(selectArchitecture("webgpu", { gpu: {} }, memory32), "wasm32");
assert.equal(selectArchitecture("wasm", {}, memory64), "wasm32");
assert.equal(selectArchitecture("wasm-simd", {}, memory64), "wasm32");
assert.throws(() => selectArchitecture("webgpu", {}, memory64), /WebGPU is not available/);
assert.equal(supportsMemory64({ validate() { throw new Error("unsupported"); } }), false);
assert.equal(supportsMemory64(undefined), supportsMemory64());

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const originalValidate = WebAssembly.validate;
const imports = [];
const factorySource = `export default async function(options) {
    return { located: options.locateFile("probe.wasm"), marker: options.marker };
}`;
const moduleUrl = new URL(`data:text/javascript,${encodeURIComponent(factorySource)}`);
try {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { gpu: {} } });
    for (const supported of [true, false]) {
        WebAssembly.validate = () => supported;
        for (const stem of ["squeezenet", "benchncnn", "benchncnn-llm", "vkpeak"]) {
            const paths = [];
            const assetUrl = (path) => {
                paths.push(path);
                return path.endsWith(".mjs") ? moduleUrl : new URL(path, "https://example.test/project/");
            };
            const module = await createDemoRuntime(stem, "webgpu", assetUrl, { marker: stem });
            const prefix = supported ? "./assets/wasm64/" : "./assets/";
            assert.deepEqual(paths, [`${prefix}${stem}-webgpu.mjs`, `${prefix}probe.wasm`]);
            assert.equal(module.wasmArchitecture, supported ? "wasm64" : "wasm32");
            assert.equal(module.marker, stem);
            assert.ok(module.located.startsWith("https://example.test/project/assets/"));
            imports.push(paths[0]);
        }
    }
    WebAssembly.validate = () => true;
    const failedImports = [];
    await assert.rejects(createDemoRuntime("squeezenet", "webgpu", (path) => {
        failedImports.push(path);
        return new URL(`data:text/javascript,${encodeURIComponent('export default async () => { throw new Error("module init failed"); }')}`);
    }), /module init failed/);
    assert.deepEqual(failedImports, ["./assets/wasm64/squeezenet-webgpu.mjs"], "initialization errors must not silently select wasm32");
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
    let touched = false;
    await assert.rejects(createDemoRuntime("squeezenet", "webgpu", () => { touched = true; return moduleUrl; }), /WebGPU is not available/);
    assert.equal(touched, false);
} finally {
    WebAssembly.validate = originalValidate;
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete globalThis.navigator;
}

// exercise the pointer contract without allocating a multi-gigabyte test heap
const pointer = 2 ** 32 + 64;
const calls = [];
const module = { ccall(...args) { calls.push(args); return args[0] === "malloc" ? pointer : undefined; } };
assert.equal(allocate(module, 68), pointer);
release(module, pointer);
assert.deepEqual(calls, [["malloc", "pointer", ["pointer"], [68]], ["free", null, ["pointer"], [pointer]]]);
assert.throws(() => allocate({ ccall: () => 0 }, 68), /allocation failed/);
console.log(JSON.stringify({ status: "pass", imports, memory64Supported: supportsMemory64(), pointer }));
