// Bounded Node-only checks of the unchanged CPU assets and rebuilt wrappers.
// One small CNN runs with one measured iteration and its normal warmups. LLM
// checks cover selection/error/lifecycle only, NOT model inference or WebGPU.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const scriptPath = fileURLToPath(import.meta.url);
const cnnResult = /^\s*(\S+)\s+min\s*=\s*([0-9.]+)\s+max\s*=\s*([0-9.]+)\s+avg\s*=\s*([0-9.]+)/;
const llmResult = /^\s*(\S+)\s+([0-9.]+)\s+([0-9.]+)\s*$/;

if (process.argv[2] === "--case") {
    const [path, mode, ...arguments_] = process.argv.slice(3);
    const factory = (await import(pathToFileURL(path).href)).default;
    const bytes = await readFile(path.replace(/\.mjs$/, ".wasm"));
    const lines = [];
    let exitStatus = null;
    const module = await factory({
        noInitialRun: mode === "devices",
        arguments: arguments_,
        print: (line) => lines.push(String(line)),
        printErr: (line) => lines.push(String(line)),
        onExit: (status) => { exitStatus = status; },
        onAbort: (reason) => { throw new Error(`Unexpected abort: ${reason}`); },
        instantiateWasm(imports, receive) {
            WebAssembly.instantiate(bytes, imports).then(({ instance, module }) => receive(instance, module));
            return {};
        },
    });
    if (mode === "devices") {
        for (const name of ["_main", "_malloc", "_free", "ccall", "_ncnn_benchmark_gpu_count", "_ncnn_benchmark_gpu_name", "_ncnn_benchmark_destroy_gpu_instance"])
            assert.equal(typeof module[name], "function", `Missing ${name}`);
        assert.ok(module.HEAPU8 instanceof Uint8Array);
        const pointer = module._malloc(16);
        assert.ok(pointer);
        module.HEAPU8.fill(0x5a, pointer, pointer + 16);
        try {
            assert.equal(await module.ccall("ncnn_benchmark_gpu_count", "number", [], [], { async: true }), 0);
            assert.equal(module.ccall("ncnn_benchmark_gpu_name", "number", ["number", "number", "number"], [0, pointer, 16]), -1);
            assert.equal(module.ccall("ncnn_benchmark_gpu_name", "number", ["number", "number", "number"], [-1, 0, 0]), -1);
            assert.deepEqual(Array.from(module.HEAPU8.subarray(pointer, pointer + 16)), Array(16).fill(0x5a));
        } finally {
            module._free(pointer);
            await module.ccall("ncnn_benchmark_destroy_gpu_instance", null, [], [], { async: true });
            await module.ccall("ncnn_benchmark_destroy_gpu_instance", null, [], [], { async: true });
        }
        assert.equal(exitStatus, null, "noInitialRun must not execute the suite");
    }
    console.log(JSON.stringify({ exitStatus, lines }));
} else {
    const runFile = promisify(execFile);
    const report = [];
    async function run(path, mode, args = []) {
        // A separate process bounds even synchronous Wasm execution.
        const { stdout } = await runFile(process.execPath, [scriptPath, "--case", path, mode, ...args], { timeout: 30000, maxBuffer: 1024 * 1024 });
        return JSON.parse(stdout.trim());
    }
    function args(model, gpu = "-1", loop = "1") {
        return [loop, "1", "2", gpu, "0", `model=${model}`];
    }
    const directory = join(dirname(scriptPath), "..", "assets");
    const builds = [
        { label: "committed-wasm", dir: directory, suffix: "wasm" },
        { label: "committed-wasm-simd", dir: directory, suffix: "wasm-simd" },
    ];
    if (process.argv[2]) builds.push({ label: "rebuilt-cpu", dir: resolve(process.argv[2]), suffix: "reference" });
    for (const build of builds) {
        for (const name of ["benchncnn", "benchncnn-llm"]) {
            const path = join(build.dir, `${name}-${build.suffix}.mjs`);
            const pattern = name === "benchncnn" ? cnnResult : llmResult;
            await run(path, "devices");
            const invalid = await run(path, "run", args("__missing_benchmark_model__"));
            assert.notEqual(invalid.exitStatus, null, "onExit must fire for an invalid model");
            assert.notEqual(invalid.exitStatus, 0);
            assert.ok(invalid.lines.some((line) => line.includes("unknown model __missing_benchmark_model__")));
            assert.equal(invalid.lines.filter((line) => pattern.test(line)).length, 0);
            if (build.label === "rebuilt-cpu") {
                const model = name === "benchncnn" ? "blazeface" : "qwen2.5_0.5b";
                for (const rejected of [args(model, "0"), args(model, "-1", "0"), args(model, "-1", "not-a-number"), args(model).slice(0, -1)]) {
                    const result = await run(path, "run", rejected);
                    assert.notEqual(result.exitStatus, null);
                    assert.notEqual(result.exitStatus, 0, "Invalid workload or missing GPU must not succeed");
                    assert.equal(result.lines.filter((line) => pattern.test(line)).length, 0);
                }
                if (name === "benchncnn-llm") {
                    const result = await run(path, "run", args("qwen2.5_0.5b_int8g32", "0"));
                    assert.notEqual(result.exitStatus, 0);
                    // Device validation runs before upstream model selection. This CPU
                    // diagnostic must reject the request rather than fall back to CPU.
                    assert.ok(result.lines.some((line) => line.includes("no WebGPU backend")));
                    assert.equal(result.lines.filter((line) => pattern.test(line)).length, 0);
                }
            }
            if (name === "benchncnn") {
                const result = await run(path, "run", args("blazeface"));
                assert.equal(result.exitStatus, 0);
                const matches = result.lines.map((line) => line.match(cnnResult)).filter(Boolean);
                assert.equal(matches.length, 1, "Exactly the requested model must run");
                const [_, model, ...values] = matches[0];
                assert.equal(model, "blazeface");
                const timings = values.map(Number);
                assert.ok(timings.every((value) => Number.isFinite(value) && value >= 0));
                assert.equal(timings[0], timings[1], "One measured loop has identical min/max/avg");
                assert.equal(timings[0], timings[2]);
                report.push({ build: build.label, module: name, check: "CPU blazeface, one iteration plus normal warmups", timings });
            } else {
                report.push({ build: build.label, module: name, check: "CPU module ABI, lifecycle and invalid-model selection only", llmInferenceExecuted: false });
            }
        }
    }
    console.log(JSON.stringify({ status: "pass", gpuExecuted: false, report }, null, 2));
}
