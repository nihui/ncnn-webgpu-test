// Run the untouched browser CPU modules in Node via Emscripten instantiateWasm.
// This checks model/ABI/fixtures only. It is NOT a browser or WebGPU test.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import { cases, pixels, compareTop3, validateABI } from "./fixtures.mjs";
const results = new Map();
const modules = ["wasm", "wasm-simd"].map((backend) => [backend, new URL(`../assets/squeezenet-${backend}.mjs`, import.meta.url)]);
if (process.argv[2]) modules.push(["rebuilt-cpu", pathToFileURL(resolve(process.argv[2]))]);
for (const [backend, moduleUrl] of modules) {
    const factory = (await import(moduleUrl.href)).default;
    const bytes = await readFile(new URL(moduleUrl.href.replace(/\.mjs$/, ".wasm")));
    const module = await factory({ instantiateWasm(imports, receive) {
        WebAssembly.instantiate(bytes, imports).then(({ instance, module }) => receive(instance, module));
        return {};
    } });
    module.FS_createPath("/", "models", true, true);
    for (const extension of ["param", "bin"]) {
        const name = `squeezenet_v1.1.${extension}`;
        module.FS_createDataFile("/models", name, await readFile(new URL(`../models/${name}`, import.meta.url)), true, false, true);
    }
    if (await module.ccall("ncnn_squeezenet_init", "number", ["number"], [0], { async: true })) throw new Error("CPU initialization failed");
    const backendResults = [];
    for (const [name, width, height, seed] of cases) {
        const input = new Uint8Array(pixels(width, height, seed));
        const inputPointer = module._malloc(input.length);
        const outputPointer = module._malloc(17 * 4);
        try {
            module.HEAPU8.set(input, inputPointer);
            if (await module.ccall("ncnn_squeezenet_infer", "number", ["number", "number", "number", "number"], [inputPointer, width, height, outputPointer], { async: true })) throw new Error("CPU inference failed");
            const values = Array.from(module.HEAPF32.subarray(outputPointer / 4, outputPointer / 4 + 17));
            const result = { name, backend, results: [0, 1, 2].map((rank) => ({ index: values[rank * 2], score: values[rank * 2 + 1] })), timings: values.slice(6, 16), fastestMs: values[16] };
            validateABI(result);
            backendResults.push(result);
        } finally { module._free(outputPointer); module._free(inputPointer); }
    }
    await module.ccall("ncnn_squeezenet_destroy", null, [], [], { async: true });
    results.set(backend, backendResults);
}
for (const [backend, backendResults] of results) for (let index = 0; index < cases.length; index++) compareTop3(results.get("wasm")[index].results, backendResults[index].results, `${cases[index][0]} ${backend}`);
const report = { status: "pass", rebuiltWrapperTested: results.has("rebuilt-cpu"), environment: "Node CPU oracle only; no browser or GPU", model: "committed SqueezeNet v1.1", results: Object.fromEntries(results) };
await writeFile("test-results-cpu-node.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report));
