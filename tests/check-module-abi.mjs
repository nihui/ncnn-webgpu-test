// Instantiate the linked pair and inspect the worker-facing ABI without requesting
// an adapter or running GPU inference. This is not a browser/WebGPU acceptance test.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
if (!process.argv[2]?.endsWith(".mjs")) throw new Error("Pass the newly linked .mjs module");
const url = pathToFileURL(resolve(process.argv[2]));
const factory = (await import(url.href)).default;
const bytes = await readFile(new URL(url.href.replace(/\.mjs$/, ".wasm")));
const module = await factory({ instantiateWasm(imports, receive) {
    WebAssembly.instantiate(bytes, imports).then(({ instance, module }) => receive(instance, module));
    return {};
} });
for (const name of ["_malloc", "_free", "ccall", "FS_createPath", "FS_createDataFile",
    "_ncnn_squeezenet_gpu_count", "_ncnn_squeezenet_gpu_name", "_ncnn_squeezenet_init",
    "_ncnn_squeezenet_infer", "_ncnn_squeezenet_destroy"]) {
    if (typeof module[name] !== "function") throw new Error(`Missing ABI function ${name}`);
}
if (!(module.HEAPU8 instanceof Uint8Array) || !(module.HEAPF32 instanceof Float32Array)) throw new Error("Missing heap views");
const pointer = module._malloc(17 * 4);
if (!pointer) throw new Error("Result allocation failed");
module.HEAPF32.fill(0, pointer / 4, pointer / 4 + 17);
module._free(pointer);
module.FS_createPath("/", "abi-check", true, true);
module.FS_createDataFile("/abi-check", "probe", new Uint8Array([1]), true, false, true);
console.log(JSON.stringify({ status: "pass", check: "linked module ABI and allocation/FS helpers", gpuInferenceExecuted: false }));
