// Copyright 2026 Tencent
// SPDX-License-Identifier: BSD-3-Clause
// real browser/worker capability probe and loader routing with mock factories,
// not linked application modules or GPU inference
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright-core");
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const chrome = option("--chrome", "/usr/bin/chromium");
const output = option("--output", "test-results-selection.json");
const runtime = await readFile(new URL("../../webgpu-runtime.mjs", import.meta.url));
const server = createServer((request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    response.setHeader("Content-Type", path.endsWith(".mjs") ? "text/javascript" : "text/html");
    if (path === "/project/webgpu-runtime.mjs") response.end(runtime);
    else if (/^\/project\/assets\/(wasm64\/)?(squeezenet|benchncnn|benchncnn-llm|vkpeak)-webgpu\.mjs$/.test(path)) {
        response.end(`export default async options => {
            if (options.fail) throw new Error("module initialization failed");
            return { loaded: ${JSON.stringify(path)}, located: options.locateFile("test.wasm") };
        };`);
    } else if (path === "/project/") response.end("<!doctype html><title>Runtime selection test</title>");
    else response.writeHead(404).end();
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
let report;
try {
    browser = await chromium.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/project/`);
    const cases = await page.evaluate(async () => {
        const run = mode => new Promise((resolve, reject) => {
            const workerSource = `
                import { createDemoRuntime, supportsMemory64 } from ${JSON.stringify(new URL("webgpu-runtime.mjs", location.href).href)};
                self.onmessage = async ({ data: mode }) => {
                    try {
                        const nativeMemory64 = supportsMemory64();
                        if (mode === "disabled") WebAssembly.validate = () => false;
                        Object.defineProperty(globalThis, "navigator", { value: mode === "missing" ? {} : { gpu: {} } });
                        const imports = [];
                        const assetUrl = path => { imports.push(path); return new URL(path, ${JSON.stringify(location.href)}); };
                        const results = [];
                        for (const stem of ["squeezenet", "benchncnn", "benchncnn-llm", "vkpeak"]) {
                            try {
                                const module = await createDemoRuntime(stem, "webgpu", assetUrl, { fail: mode === "broken" });
                                results.push({ stem, architecture: module.wasmArchitecture, loaded: module.loaded, located: module.located });
                            } catch (error) { results.push({ stem, error: error.message }); }
                        }
                        self.postMessage({ mode, nativeMemory64, results, imports });
                    } catch (error) { self.postMessage({ error: error.stack }); }
                };`;
            const url = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
            const worker = new Worker(url, { type: "module" });
            const timer = setTimeout(() => { cleanup(); reject(new Error("selection worker timed out")); }, 30000);
            const cleanup = () => { clearTimeout(timer); worker.terminate(); URL.revokeObjectURL(url); };
            worker.onmessage = ({ data }) => { cleanup(); resolve(data); };
            worker.onerror = event => { cleanup(); reject(new Error(event.message)); };
            worker.postMessage(mode);
        });
        const cases = [];
        for (const mode of ["native", "disabled", "missing", "broken"]) cases.push(await run(mode));
        return cases;
    });
    for (const test of cases) {
        assert.equal(test.error, undefined);
        assert.equal(test.nativeMemory64, true, "this CI browser must exercise real Memory64 detection");
        assert.equal(test.results.length, 4);
        for (const result of test.results) {
            if (test.mode === "missing") assert.match(result.error, /WebGPU is not available/);
            else if (test.mode === "broken") assert.match(result.error, /module initialization failed/);
            else {
                const architecture = test.mode === "disabled" ? "wasm32" : "wasm64";
                const prefix = architecture === "wasm64" ? "/project/assets/wasm64/" : "/project/assets/";
                assert.equal(result.architecture, architecture);
                assert.equal(result.loaded, `${prefix}${result.stem}-webgpu.mjs`);
                assert.equal(new URL(result.located).pathname, `${prefix}test.wasm`);
            }
        }
        if (test.mode === "missing") assert.deepEqual(test.imports, []);
        if (test.mode === "broken") assert.equal(test.imports.length, 4, "do not retry a module failure as wasm32");
    }
    report = { status: "pass", browser: browser.version(), cases, mockFactories: true, gpuInferenceExecuted: false };
} catch (error) {
    report = { status: "fail", error: error.stack || String(error), mockFactories: true, gpuInferenceExecuted: false };
    process.exitCode = 1;
} finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    await writeFile(output, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report));
}
