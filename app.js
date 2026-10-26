// Copyright 2026 Tencent
// SPDX-License-Identifier: BSD-3-Clause

import { t, localizePage } from "./i18n.mjs";

localizePage();

const backendInfo = new Map([
    ["wasm", {
        detail: t("scalarCpu"),
        kind: "wasm",
        order: 1,
        title: "WASM",
    }],
    ["wasm-simd", {
        detail: "128-bit SIMD CPU",
        kind: "wasm-simd",
        order: 2,
        title: "WASM SIMD",
    }],
]);

const fileInput = document.querySelector("#image-file");
const dropZone = document.querySelector("#drop-zone");
const preview = document.querySelector("#preview");
const previewPlaceholder = document.querySelector("#preview-placeholder");
const sourceMeta = document.querySelector("#source-meta");
const backendButtons = document.querySelector(".backend-buttons");
const statusLine = document.querySelector("#status-line");
const resultTemplate = document.querySelector("#result-template");
const results = document.querySelector("#results");

const workers = new Map();
const pendingRequests = new Map();
const benchmarkTimes = new Map();
const assetVersion = Date.now().toString(36);
let labelsPromise;
let imageState;
let previewUrl;
let requestId = 0;

function getRunButtons() {
    return Array.from(document.querySelectorAll("[data-backend-key]"));
}

function getBackendInfo(backendKey) {
    return backendInfo.get(backendKey);
}

function supportsWasmSimd() {
    return WebAssembly.validate(new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0,
        3, 2, 1, 0, 10, 9, 1, 7, 0, 65, 0, 253, 15, 26, 11,
    ]));
}

function updateCapabilities() {
    document.querySelector("#cap-wasm").textContent = t("available");
    document.querySelector("#cap-wasm-simd").textContent = supportsWasmSimd() ? t("available") : t("unsupported");
    document.querySelector("#cap-webgpu").textContent = navigator.gpu ? t("enumerating") : t("unsupported");

    document.querySelector('[data-backend-key="wasm-simd"]').disabled = !supportsWasmSimd();
    const placeholder = document.querySelector("#webgpu-device-placeholder");
    if (!navigator.gpu) {
        placeholder.querySelector("small").textContent = t("browserUnsupported");
        document.querySelector("#webgpu-chart-placeholder .benchmark-value").textContent = t("unsupported");
    }
}

async function loadLabels() {
    if (!labelsPromise) {
        labelsPromise = fetch(`./models/synset_words.txt?v=${assetVersion}`)
            .then((response) => {
                if (!response.ok) throw new Error(t("labelsFailed", { status: response.status }));
                return response.text();
            })
            .then((text) => text.trim().split(/\r?\n/).map((line) => line.replace(/^\S+\s+/, "")));
    }
    return labelsPromise;
}

function setBusy(busy, activeBackend = "") {
    for (const button of getRunButtons()) {
        const unsupported = (button.dataset.backendKind === "wasm-simd" && !supportsWasmSimd())
            || (button.dataset.backendKind === "webgpu" && !navigator.gpu);
        button.disabled = busy || unsupported || !imageState;
        button.classList.toggle("is-running", busy && button.dataset.backendKey === activeBackend);
    }
}

function getWorker(backendKey) {
    if (workers.has(backendKey)) return workers.get(backendKey);

    const info = getBackendInfo(backendKey);
    const query = new URLSearchParams({ backend: info.kind, v: assetVersion });
    if (info.kind === "webgpu") query.set("gpuIndex", info.gpuIndex);
    const worker = new Worker(`./backend-worker.mjs?${query}`, { type: "module" });
    worker.addEventListener("message", (event) => {
        const request = pendingRequests.get(event.data.id);
        if (!request) return;
        pendingRequests.delete(event.data.id);
        if (event.data.status === "pass") request.resolve(event.data);
        else request.reject(new Error(event.data.error));
    });
    worker.addEventListener("error", (event) => {
        for (const [id, request] of pendingRequests) {
            if (request.backendKey !== backendKey) continue;
            pendingRequests.delete(id);
            request.reject(new Error(event.message || t("workerFailed", { backend: backendKey })));
        }
        releaseWorker(backendKey);
    });
    workers.set(backendKey, worker);
    return worker;
}

function releaseWorker(backendKey) {
    const worker = workers.get(backendKey);
    if (!worker) return;

    worker.terminate();
    workers.delete(backendKey);
}

function createPixels() {
    const canvas = document.createElement("canvas");
    canvas.width = imageState.width;
    canvas.height = imageState.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(imageState.bitmap, 0, 0, canvas.width, canvas.height);
    return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

function requestInference(backendKey) {
    const worker = getWorker(backendKey);
    const pixels = createPixels();
    const id = ++requestId;
    const promise = new Promise((resolve, reject) => {
        pendingRequests.set(id, { backendKey, reject, resolve });
    });
    worker.postMessage({
        height: imageState.height,
        id,
        pixels: pixels.buffer,
        type: "run",
        width: imageState.width,
    }, [pixels.buffer]);
    return promise;
}

function updateTimingComparison(backendKey, fastestMs) {
    benchmarkTimes.set(backendKey, fastestMs);
    const timings = Array.from(benchmarkTimes.values());
    const maximum = Math.max(...timings);
    const minimum = Math.min(...timings);

    document.querySelectorAll("[data-chart-backend]").forEach((row) => {
        const timing = benchmarkTimes.get(row.dataset.chartBackend);
        const hasResult = Number.isFinite(timing);
        row.classList.toggle("has-result", hasResult);
        row.classList.toggle("is-best", hasResult && timing === minimum);
        row.querySelector(".benchmark-bar").style.width = hasResult ? `${timing / maximum * 100}%` : "0";
        row.querySelector(".benchmark-value").textContent = hasResult ? `${timing.toFixed(2)} ms` : t("notRun");
    });
}

function renderResult(payload, labels) {
    const previous = Array.from(results.querySelectorAll("[data-result]"))
        .find((item) => item.dataset.result === payload.backendKey);
    if (previous) previous.remove();

    const info = getBackendInfo(payload.backendKey);
    const card = resultTemplate.content.firstElementChild.cloneNode(true);
    card.dataset.backendKind = info.kind;
    card.dataset.result = payload.backendKey;
    card.style.order = info.order;
    card.querySelector(".result-title").textContent = info.title;
    card.querySelector(".result-detail").textContent = info.detail;
    card.querySelector(".fastest-value").textContent = `${payload.fastestMs.toFixed(2)} ms`;
    card.querySelector(".init-value").textContent = `${payload.initMs.toFixed(0)} ms`;

    const topList = card.querySelector(".top-list");
    payload.results.forEach((item, rank) => {
        const row = document.createElement("li");
        const confidence = Math.max(0, Math.min(1, item.score));
        row.innerHTML = `
            <span class="rank">${rank + 1}</span>
            <span class="class-name">${labels[item.index] || t("classFallback", { index: item.index })}</span>
            <span class="class-id">#${item.index}</span>
            <span class="confidence">${(confidence * 100).toFixed(2)}%</span>
            <span class="confidence-track"><span style="width:${confidence * 100}%"></span></span>
        `;
        topList.append(row);
    });

    const timingList = card.querySelector(".timing-list");
    payload.timings.forEach((timing, index) => {
        const item = document.createElement("span");
        item.className = Math.abs(timing - payload.fastestMs) < 0.001 ? "is-fastest" : "";
        item.textContent = `${index + 1}: ${timing.toFixed(2)}`;
        timingList.append(item);
    });

    updateTimingComparison(payload.backendKey, payload.fastestMs);
    results.prepend(card);
}

async function runBackend(backendKey) {
    if (!imageState) return;

    const info = getBackendInfo(backendKey);
    const initialized = workers.has(backendKey);
    setBusy(true, backendKey);
    statusLine.textContent = initialized
        ? t("runningTen", { backend: info.title })
        : t("loadingTen", { backend: info.title });
    try {
        const [payload, labels] = await Promise.all([requestInference(backendKey), loadLabels()]);
        renderResult(payload, labels);
        statusLine.textContent = t("inferenceDone", { backend: info.title, time: payload.fastestMs.toFixed(2) });
    } catch (error) {
        console.error(error);
        statusLine.textContent = t("backendFailed", { backend: info.title, error: error.message });
    } finally {
        if (info.kind !== "webgpu")
            releaseWorker(backendKey);
        setBusy(false);
    }
}

function createWebgpuButton(device) {
    const backendKey = `webgpu:${device.index}`;
    const info = {
        detail: `${device.name} · fp16-packed GPU`,
        deviceName: device.name,
        gpuIndex: device.index,
        kind: "webgpu",
        order: 10 + device.index,
        title: `WebGPU ${device.index}`,
    };
    backendInfo.set(backendKey, info);

    const button = document.createElement("button");
    button.type = "button";
    button.dataset.backendKey = backendKey;
    button.dataset.backendKind = "webgpu";

    const title = document.createElement("span");
    title.textContent = info.title;
    const detail = document.createElement("small");
    detail.textContent = device.name;
    button.append(title, detail);
    return button;
}

function createWebgpuChartRow(device) {
    const backendKey = `webgpu:${device.index}`;
    const row = document.createElement("div");
    row.className = "benchmark-row";
    row.dataset.chartBackend = backendKey;

    const title = document.createElement("strong");
    title.textContent = `WebGPU ${device.index}`;
    title.title = device.name;

    const track = document.createElement("span");
    track.className = "benchmark-track";
    const bar = document.createElement("span");
    bar.className = "benchmark-bar";
    track.append(bar);

    const value = document.createElement("span");
    value.className = "benchmark-value";
    value.textContent = t("notRun");
    row.append(title, track, value);
    return row;
}

async function queryWebgpuDevices() {
    const query = new URLSearchParams({ backend: "webgpu", gpuIndex: "0", v: assetVersion });
    const worker = new Worker(`./backend-worker.mjs?${query}`, { type: "module" });
    const id = ++requestId;
    try {
        return await new Promise((resolve, reject) => {
            worker.addEventListener("message", (event) => {
                if (event.data.id !== id) return;
                if (event.data.status === "pass") resolve(event.data.devices);
                else reject(new Error(event.data.error));
            });
            worker.addEventListener("error", (event) => {
                reject(new Error(event.message || t("deviceWorkerFailed")));
            });
            worker.postMessage({ id, type: "list-devices" });
        });
    } finally {
        worker.terminate();
    }
}

async function discoverWebgpuDevices() {
    if (!navigator.gpu)
        return;

    const placeholder = document.querySelector("#webgpu-device-placeholder");
    const chartPlaceholder = document.querySelector("#webgpu-chart-placeholder");
    try {
        const devices = await queryWebgpuDevices();
        if (devices.length === 0)
            throw new Error(t("noGpu"));

        for (const device of devices) {
            backendButtons.insertBefore(createWebgpuButton(device), placeholder);
            chartPlaceholder.before(createWebgpuChartRow(device));
        }
        placeholder.remove();
        chartPlaceholder.remove();
        document.querySelector("#cap-webgpu").textContent = t("deviceCount", { count: devices.length });
        setBusy(false);
    } catch (error) {
        console.error(error);
        placeholder.querySelector("small").textContent = t("deviceEnumerationFailed");
        chartPlaceholder.querySelector(".benchmark-value").textContent = t("enumerationFailed");
        document.querySelector("#cap-webgpu").textContent = t("enumerationFailed");
        statusLine.textContent = t("enumerationError", { error: error.message });
    }
}

async function useImage(file) {
    if (!file?.type.startsWith("image/")) {
        statusLine.textContent = t("chooseSupportedImage");
        return;
    }

    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    if (imageState?.bitmap) imageState.bitmap.close();
    imageState = {
        bitmap,
        height: Math.max(1, Math.round(bitmap.height * scale)),
        width: Math.max(1, Math.round(bitmap.width * scale)),
    };

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);
    preview.src = previewUrl;
    preview.hidden = false;
    previewPlaceholder.hidden = true;
    sourceMeta.textContent = `${file.name} · ${bitmap.width}×${bitmap.height}`
        + (scale < 1 ? t("resizedInput", { width: imageState.width, height: imageState.height }) : "");
    statusLine.textContent = t("imageReady");
    setBusy(false);
}

async function selectImage(file) {
    try {
        await useImage(file);
    } catch (error) {
        console.error(error);
        statusLine.textContent = t("imageReadFailed", { error: error.message });
    }
}

fileInput.addEventListener("change", () => selectImage(fileInput.files[0]));
dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropZone.classList.add("is-dragging");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("is-dragging"));
dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropZone.classList.remove("is-dragging");
    selectImage(event.dataTransfer.files[0]);
});
backendButtons.addEventListener("click", (event) => {
    const button = event.target.closest("[data-backend-key]");
    if (button) runBackend(button.dataset.backendKey);
});
window.addEventListener("pagehide", () => {
    for (const backendKey of Array.from(workers.keys()))
        releaseWorker(backendKey);
});

updateCapabilities();
setBusy(false);
discoverWebgpuDevices();
