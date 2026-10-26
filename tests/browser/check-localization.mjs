// Copyright 2026 Tencent
// SPDX-License-Identifier: BSD-3-Clause
// exercise the real page DOM with deterministic workers, not model inference
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, extname } from "node:path";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright-core");
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const root = fileURLToPath(new URL("../../", import.meta.url));
const output = option("--output", "test-results-localization.json");
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".txt": "text/plain" };
const server = createServer(async (request, response) => {
    try {
        const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
        if (!path.startsWith("/project/")) return response.writeHead(404).end();
        const filename = resolve(root, path.slice("/project/".length));
        if (!filename.startsWith(root)) return response.writeHead(404).end();
        response.setHeader("Content-Type", types[extname(filename)] || "application/octet-stream");
        response.end(await readFile(filename));
    } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}/project/`;
const pages = ["index.html", "benchncnn.html", "benchncnn_llm.html", "vkpeak.html"];
let browser;
const cases = [];
let report;

function installMocks({ languages, gpu }) {
    Object.defineProperty(navigator, "languages", { get: () => languages });
    Object.defineProperty(navigator, "language", { get: () => languages[0] || "" });
    Object.defineProperty(navigator, "gpu", { get: () => gpu ? {} : undefined });
    window.mockFailure = false;
    window.mockRuns = 0;
    window.mockTerminations = 0;
    const scenarios = [{ name: "fp32-vec4", unit: "GFLOPS" }, { name: "int8-dotprod", unit: "GIOPS" }];
    window.Worker = class extends EventTarget {
        constructor(url) { super(); this.url = String(url); this.closed = false; }
        terminate() { this.closed = true; window.mockTerminations++; }
        send(data) { if (!this.closed) this.dispatchEvent(new MessageEvent("message", { data })); }
        postMessage(data) {
            setTimeout(() => {
                if (data.type === "list-devices") {
                    this.send({ id: data.id, status: "pass", devices: [{ index: 0, name: "Fixture GPU" }], scenarios });
                    return;
                }
                window.mockRuns++;
                if (window.mockFailure) {
                    this.send({ id: data.id, status: "fail", error: "fixture failure marker" });
                    return;
                }
                if (this.url.includes("backend-worker")) {
                    this.send({ id: data.id, status: "pass", backendKey: new URL(this.url, location.href).searchParams.get("backend"),
                        fastestMs: 1.25, initMs: 42, timings: Array(10).fill(1.25),
                        results: [{ index: 0, score: 0.8 }, { index: 1, score: 0.15 }, { index: 99999, score: 0.05 }] });
                } else if (this.url.includes("vkpeak-worker")) {
                    this.send({ id: data.id, status: "progress", name: "fp32-vec4", supported: true });
                    setTimeout(() => this.send({ id: data.id, status: "pass", results: [
                        { name: "fp32-vec4", score: 12.5, unit: "GFLOPS", status: "pass" },
                        { name: "int8-dotprod", status: "unsupported" },
                    ] }), 10);
                } else {
                    const result = { model: data.model, min: 1.25, max: 2.5, avg: 1.75, prefillTps: 12.5, decodeTps: 6.25 };
                    this.send({ id: data.id, status: "progress", result });
                    setTimeout(() => this.send({ id: data.id, status: "pass", results: [result] }), 10);
                }
            }, 10);
        }
    };
}

async function checkLanguage(page, expected, file) {
    const snapshot = await page.evaluate(() => {
        const attributes = [...document.querySelectorAll("[aria-label], [alt], [placeholder], meta[name='description']")]
            .flatMap(element => ["aria-label", "alt", "placeholder", "content"].map(name => element.getAttribute(name) || ""));
        const templates = [...document.querySelectorAll("template")].map(element => element.content.textContent);
        return { lang: document.documentElement.lang, title: document.title, heading: document.querySelector("h1").innerText,
            body: document.body.innerText, attributes, templates };
    });
    assert.equal(snapshot.lang, expected === "zh" ? "zh-CN" : "en", file);
    if (expected === "en") {
        assert.doesNotMatch([snapshot.body, ...snapshot.attributes, ...snapshot.templates].join("\n"), /[\u3400-\u9fff]/, `${file}: untranslated Chinese`);
    } else assert.match(snapshot.heading, /[\u3400-\u9fff]/, `${file}: Chinese heading`);
    return snapshot;
}

async function runPage(context, file, expected, exercise) {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base + file);
    if (file === "index.html") await page.waitForSelector('[data-backend-key="webgpu:0"]');
    else if (file === "vkpeak.html") await page.waitForSelector('[data-device-index="0"]');
    else await page.waitForSelector('[data-model]:not([disabled])');
    await checkLanguage(page, expected, file);
    if (exercise) {
        let button;
        if (file === "index.html") {
            const image = await page.evaluate(() => {
                const canvas = document.createElement("canvas"); canvas.width = 2; canvas.height = 2;
                canvas.getContext("2d").fillRect(0, 0, 2, 2);
                return canvas.toDataURL("image/png").split(",")[1];
            });
            await page.locator("#image-file").setInputFiles({ name: "fixture.png", mimeType: "image/png", buffer: Buffer.from(image, "base64") });
            button = page.locator('[data-backend-key="wasm"]');
            await page.waitForFunction(() => !document.querySelector('[data-backend-key="wasm"]').disabled);
        } else button = page.locator(file === "vkpeak.html" ? '[data-device-index="0"]' : '[data-model]').first();
        for (let repeat = 0; repeat < 2; repeat++) {
            const before = await page.evaluate(() => window.mockRuns);
            await button.click();
            await page.waitForFunction(before => window.mockRuns > before, before);
            await page.waitForFunction(file => !(file === "index.html" ? document.querySelector('[data-backend-key="wasm"]') :
                file === "vkpeak.html" ? document.querySelector('[data-device-index="0"]') : document.querySelector('[data-model]')).disabled, file);
            await checkLanguage(page, expected, file);
        }
        const text = await page.locator("#results").innerText();
        assert.match(text, file === "benchncnn_llm.html" || file === "vkpeak.html" ? /12\.50/ : /1\.25/, `${file}: unchanged numbers`);
        if (file === "index.html") {
            assert.equal(await page.locator("[data-result]").count(), 1, "repeat replaces result card");
            assert.match(text, /99999/, "fallback class label retains index");
        }
        await page.evaluate(() => { window.mockFailure = true; });
        await button.click();
        if (file === "index.html" || file === "vkpeak.html")
            await page.waitForFunction(() => (document.querySelector("#status-line") || document.querySelector("#status")).textContent.includes("fixture failure marker"));
        else {
            await page.waitForSelector('.is-fail[title="fixture failure marker"]');
            await page.waitForFunction(() => !document.querySelector('[data-model]').disabled);
        }
        await checkLanguage(page, expected, file);
        assert.ok(await page.evaluate(() => window.mockTerminations > 0), "workers cleaned up");
    }
    assert.deepEqual(errors, [], `${file}: uncaught page errors`);
    cases.push({ file, language: expected, exercise, status: "pass" });
    await page.close();
}

try {
    browser = await chromium.launch({ executablePath: option("--chrome", "/usr/bin/chromium"), headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    for (const [languages, expected, exercise] of [
        [["en-US", "zh-CN"], "en", true], [["zh-TW", "en-US"], "zh", true],
        [["fr-FR"], "en", false],
    ]) {
        const context = await browser.newContext();
        await context.addInitScript(installMocks, { languages, gpu: true });
        for (const file of pages) await runPage(context, file, expected, exercise);
        await context.close();
    }
    for (const [languages, expected] of [[["en"], "en"], [["zh-CN"], "zh"]]) {
        const context = await browser.newContext();
        await context.addInitScript(installMocks, { languages, gpu: false });
        for (const file of pages) {
            const page = await context.newPage();
            await page.goto(base + file);
            await page.waitForFunction(() => document.documentElement.lang === "en" || document.documentElement.lang === "zh-CN");
            await page.evaluate(() => import("./i18n.mjs"));
            await checkLanguage(page, expected, file);
            assert.equal(await page.evaluate(() => window.mockRuns), 0);
            cases.push({ file, language: expected, missingWebGPU: true, status: "pass" });
            await page.close();
        }
        await context.close();
    }
    report = { status: "pass", browser: browser.version(), cases, mockedWorkers: true, gpuInferenceExecuted: false };
} catch (error) {
    report = { status: "fail", error: error.stack || String(error), cases, mockedWorkers: true, gpuInferenceExecuted: false };
    process.exitCode = 1;
} finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    await writeFile(output, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report));
}
