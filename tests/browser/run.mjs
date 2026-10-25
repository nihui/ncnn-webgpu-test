// Copyright 2026 Tencent
// SPDX-License-Identifier: BSD-3-Clause
import { createServer } from "node:http";
import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright-core");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
function option(name, fallback = "") {
    const index = args.indexOf(name);
    if (index < 0) return fallback;
    if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`Missing ${name} value`);
    return args[index + 1];
}
const cpuOnly = args.includes("--cpu-only");
const extraDemos = args.includes("--extra-demos");
if (cpuOnly && extraDemos) throw new Error("--extra-demos requires the newly built WebGPU modules");
const query = new URLSearchParams();
if (cpuOnly) query.set("cpu-only", "");
if (extraDemos) query.set("extra-demos", "");

const moduleDir = option("--module-dir");
const module64Dir = option("--module64-dir");
const expectedArchitecture = option("--expect-arch");
const disableMemory64 = args.includes("--disable-memory64");
if (expectedArchitecture) query.set("expect-arch", expectedArchitecture);
if (!cpuOnly && !moduleDir) throw new Error("--module-dir is required: do not accidentally test the old committed WebGPU asset");
const pagePath = `/tests/browser/harness.html?${query}`;
if (!cpuOnly && !module64Dir) throw new Error("--module64-dir is required for automatic architecture selection");
if (expectedArchitecture && !["wasm32", "wasm64"].includes(expectedArchitecture)) throw new Error("invalid --expect-arch");
const chrome = option("--chrome", process.env.CHROME || "/usr/bin/chromium");
const output = option("--output", "test-results.json");
const timeout = Number(option("--timeout", "1800000"));
const hardware = args.includes("--hardware");
const stems = ["squeezenet", ...(extraDemos ? ["benchncnn", "benchncnn-llm", "vkpeak"] : [])];
for (const directory of [moduleDir, module64Dir].filter(Boolean)) for (const stem of stems) for (const ext of ["mjs", "wasm"]) await stat(resolve(directory, `${stem}-webgpu.${ext}`));
const mime = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm" };
const server = createServer(async (request, response) => {
    try {
        const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
        if (pathname === "/favicon.ico") { response.writeHead(204).end(); return; }
        let path = resolve(root, `.${pathname}`);
        if (!path.startsWith(root + sep)) { response.writeHead(403).end(); return; }
        if (moduleDir && /^\/assets\/(squeezenet|benchncnn|benchncnn-llm|vkpeak)-webgpu\.(mjs|wasm)$/.test(pathname)) path = resolve(moduleDir, pathname.split("/").at(-1));
        if (module64Dir && /^\/assets\/wasm64\/(squeezenet|benchncnn|benchncnn-llm|vkpeak)-webgpu\.(mjs|wasm)$/.test(pathname)) path = resolve(module64Dir, pathname.split("/").at(-1));
        let body = await readFile(path);
        if (/^\/(backend|benchncnn|benchncnn-llm|vkpeak)-worker\.mjs$/.test(pathname)) body = Buffer.concat([
            // simulate an older engine for the wasm32 fallback path without a production override
            Buffer.from(disableMemory64 ? "WebAssembly.validate = () => false;\n" : ""),
            await readFile(resolve(root, "tests/browser/observe-worker.mjs")), Buffer.from("\n"), body]);
        response.writeHead(200, { "Content-Type": mime[extname(path)] || "application/octet-stream", "Cache-Control": "no-store" }).end(body);
    } catch { response.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
if (args.includes("--serve-only")) {
    console.log(`http://127.0.0.1:${server.address().port}${pagePath}`);
    console.log("Serving the acceptance page for an existing browser; press Ctrl-C to stop.");
    await new Promise(() => {});
}
let browser;
const errors = [];
const logs = [];
let report;
try {
    const launchArgs = ["--enable-gpu", "--disable-dev-shm-usage", "--no-sandbox"];
    if (!hardware) launchArgs.push("--enable-unsafe-webgpu", "--use-webgpu-adapter=swiftshader", "--use-gl=angle", "--use-angle=swiftshader");
    browser = await chromium.launch({ executablePath: chrome, headless: true, args: launchArgs });
    const page = await browser.newPage();
    page.on("console", (message) => {
        const text = message.text();
        logs.push(text);
        // ncnn reports warnings through printErr, so match genuine backend errors
        // rather than rejecting every warning from its ordinary stderr stream.
        if (message.type() === "error" || /uncaptured error|failed status=|no such shader module|WebGPU validation/i.test(text)) errors.push(text);
        console.error(`[${message.type()}] ${text}`);
    });
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("requestfailed", (request) => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
    page.setDefaultTimeout(timeout);
    await page.goto(`http://127.0.0.1:${server.address().port}${pagePath}`);
    report = await Promise.race([
        page.evaluate(() => window.testDone),
        new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error("SqueezeNet browser test timed out")), timeout); timer.unref(); }),
    ]);
    report.browser = browser.version();
    report.mode = hardware ? "hardware (not guaranteed by launch flags)" : "SwiftShader software WebGPU";
    report.expectedArchitecture = expectedArchitecture;
    report.memory64CapabilityDisabledForTest = disableMemory64;
    report.module64Dir = module64Dir ? resolve(module64Dir) : null;
    report.moduleDir = moduleDir ? resolve(moduleDir) : null;
    report.errors = errors;
    report.logs = logs;
    if (errors.length) report.status = "fail";
    if (!cpuOnly && !hardware && report.status === "pass" && !report.cases.some((test) => test.results.some((result) => /swiftshader/i.test(result.observation.adapter)))) {
        report.status = "fail";
        errors.push("Expected SwiftShader adapter identity was not observed");
    }
    if (report.status !== "pass") process.exitCode = 1;
} catch (error) {
    report = { status: "fail", error: error.stack || String(error), errors, logs };
    process.exitCode = 1;
} finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await writeFile(output, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report));
}
