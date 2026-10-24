// Instantiate newly linked pairs and inspect worker-facing ABIs without requesting
// an adapter or running GPU inference. This is not browser/WebGPU acceptance.
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const paths = process.argv.slice(2);
if (!paths.length || paths.some((path) => !path.endsWith(".mjs"))) throw new Error("Pass one or more newly linked .mjs modules");
const reports = [];
for (const path of paths) {
    const name = basename(path);
    let functions;
    if (name.startsWith("squeezenet-")) functions = ["ncnn_squeezenet_gpu_count", "ncnn_squeezenet_gpu_name", "ncnn_squeezenet_init", "ncnn_squeezenet_infer", "ncnn_squeezenet_destroy"];
    else if (name.startsWith("benchncnn-")) functions = ["main", "ncnn_benchmark_gpu_count", "ncnn_benchmark_gpu_name", "ncnn_benchmark_destroy_gpu_instance"];
    else if (name === "vkpeak-webgpu.mjs") functions = ["ncnn_vkpeak_gpu_count", "ncnn_vkpeak_gpu_name", "ncnn_vkpeak_scenario_count", "ncnn_vkpeak_scenario_name", "ncnn_vkpeak_scenario_unit", "ncnn_vkpeak_scenario_supported", "ncnn_vkpeak_run", "ncnn_vkpeak_destroy"];
    else throw new Error(`Unknown module contract: ${name}`);
    const url = pathToFileURL(resolve(path));
    const factory = (await import(url.href)).default;
    const bytes = await readFile(new URL(url.href.replace(/\.mjs$/, ".wasm")));
    const module = await factory({ noInitialRun: true, instantiateWasm(imports, receive) {
        WebAssembly.instantiate(bytes, imports).then(({ instance, module }) => receive(instance, module));
        return {};
    } });
    for (const symbol of ["_malloc", "_free", "ccall", ...functions.map((name) => `_${name}`)]) {
        if (typeof module[symbol] !== "function") throw new Error(`${name}: missing ABI function ${symbol}`);
    }
    if (!(module.HEAPU8 instanceof Uint8Array)) throw new Error(`${name}: missing byte heap`);
    const pointer = module._malloc(17 * 4);
    if (!pointer) throw new Error(`${name}: result allocation failed`);
    module.HEAPU8.fill(0, pointer, pointer + 17 * 4);
    module._free(pointer);
    if (name.startsWith("squeezenet-")) {
        if (!(module.HEAPF32 instanceof Float32Array)) throw new Error("Missing float heap");
        module.FS_createPath("/", "abi-check", true, true);
        module.FS_createDataFile("/abi-check", "probe", new Uint8Array([1]), true, false, true);
    }
    reports.push({ name, status: "pass", exportedFunctions: functions });
}
console.log(JSON.stringify({ status: "pass", check: "linked module ABIs and allocation helpers", gpuInferenceExecuted: false, modules: reports }));
