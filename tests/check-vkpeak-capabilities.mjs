// Copyright 2026 Tencent
// SPDX-License-Identifier: BSD-3-Clause

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

if (!process.argv[2]?.endsWith(".mjs")) throw new Error("Pass the newly linked vkpeak-capabilities.mjs test module");
const url = pathToFileURL(resolve(process.argv[2]));
const bytes = await readFile(new URL(url.href.replace(/\.mjs$/, ".wasm")));
const factory = (await import(url.href)).default;
const module = await factory({ instantiateWasm(imports, receive) {
    WebAssembly.instantiate(bytes, imports).then(({ instance, module }) => receive(instance, module));
    return {};
} });
assert.equal(module._ncnn_vkpeak_test_capabilities(), 0, "vkpeak capability/dispatch guard failed");
console.log(JSON.stringify({ status: "pass", check: "upstream saturating dot rejected before device lookup; int8 matrix independently supported", mockedGpuCapabilities: true, gpuBenchmarkExecuted: false }));
