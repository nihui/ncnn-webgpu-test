// Copyright 2026 Tencent
// SPDX-License-Identifier: BSD-3-Clause

// No adapter is requested and no benchmark runs. This compares worker-facing
// metadata, string-buffer boundaries and invalid-scenario handling with the
// unchanged committed module, not browser/GPU performance or correctness.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

if (!process.argv[2]?.endsWith(".mjs")) throw new Error("Pass the newly linked vkpeak-webgpu.mjs module");

const baselineUrl = new URL("../assets/vkpeak-webgpu.mjs", import.meta.url);
const candidateUrl = pathToFileURL(resolve(process.argv[2]));
const names = ["fp32-scalar", "fp32-vec4", "fp16-scalar", "fp16-vec4", "fp16-matrix",
    "int32-scalar", "int32-vec4", "int8-dotprod", "int8-matrix", "copy-h2d", "copy-d2h", "copy-d2d"];

async function inspect(url) {
    const bytes = await readFile(new URL(url.href.replace(/\.mjs$/, ".wasm")));
    const factory = (await import(url.href)).default;
    const module = await factory({ instantiateWasm(imports, receive) {
        WebAssembly.instantiate(bytes, imports).then(({ instance, module }) => receive(instance, module));
        return {};
    } });
    for (const name of ["_malloc", "_free", "ccall", ...["gpu_count", "gpu_name", "scenario_count",
        "scenario_name", "scenario_unit", "scenario_supported", "run", "destroy"].map(name => `_ncnn_vkpeak_${name}`)]) {
        assert.equal(typeof module[name], "function", `Missing ${name}`);
    }
    assert.ok(module.HEAPU8 instanceof Uint8Array);
    assert.equal(module._ncnn_vkpeak_scenario_count(), names.length);
    const pointer = module._malloc(258);
    assert.ok(pointer);
    const results = [];
    try {
        module._ncnn_vkpeak_destroy();
        module._ncnn_vkpeak_destroy();
        for (let index = 0; index < names.length; index++) {
            const row = [];
            for (const field of ["name", "unit"]) {
                const read = module[`_ncnn_vkpeak_scenario_${field}`];
                const expected = field === "name" ? names[index] : index < 5 ? "GFLOPS" : index < 9 ? "GIOPS" : "GBPS";
                for (const capacity of [1, 4, 256]) {
                    module.HEAPU8.fill(0xa5, pointer, pointer + 258);
                    const length = read(index, pointer + 1, capacity);
                    assert.equal(length, expected.length);
                    const copied = Math.min(length, capacity - 1);
                    assert.equal(new TextDecoder().decode(module.HEAPU8.subarray(pointer + 1, pointer + 1 + copied)), expected.slice(0, copied));
                    assert.equal(module.HEAPU8[pointer + 1 + copied], 0);
                    assert.equal(module.HEAPU8[pointer], 0xa5);
                    assert.equal(module.HEAPU8[pointer + 1 + capacity], 0xa5);
                }
                assert.equal(read(index, 0, 256), -1);
                assert.equal(read(index, pointer, 0), -1);
                assert.equal(read(index, pointer, -1), -1);
                row.push(expected);
            }
            results.push(row);
        }
        for (const index of [-1, names.length, 2147483647]) {
            assert.equal(module._ncnn_vkpeak_scenario_name(index, pointer, 256), -1);
            assert.equal(module._ncnn_vkpeak_scenario_unit(index, pointer, 256), -1);
            for (const name of ["scenario_supported", "run"]) {
                assert.equal(await module.ccall(`ncnn_vkpeak_${name}`, "number", ["number", "number"], [0, index], { async: true }), -1);
            }
        }
    } finally {
        module._free(pointer);
        await module.ccall("ncnn_vkpeak_destroy", null, [], [], { async: true });
    }
    return results;
}

assert.deepEqual(await inspect(candidateUrl), await inspect(baselineUrl));
const baselineWasm = await readFile(new URL("../assets/vkpeak-webgpu.wasm", import.meta.url));
const shaderHeader = await readFile(new URL("../src/vkpeak_shaders.h", import.meta.url), "utf8");
const shaders = [...shaderHeader.matchAll(/R"\(([\s\S]*?)\)";/g)];
assert.equal(shaders.length, 8);
for (const [, shader] of shaders) assert.ok(baselineWasm.includes(Buffer.from(shader)), "Shader differs from baseline WASM");
console.log(JSON.stringify({ status: "pass", check: "vkpeak metadata, buffer boundaries, invalid scenarios and original GLSL", scenarios: names.length, gpuBenchmarkExecuted: false }));
