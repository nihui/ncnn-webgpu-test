// Copyright 2026 Tencent
// SPDX-License-Identifier: BSD-3-Clause

import { t, localizePage } from "./i18n.mjs";

localizePage();

const deviceButtons = document.querySelector("#device-buttons");
const resultsElement = document.querySelector("#results");
const statusElement = document.querySelector("#status");

const assetVersion = Date.now().toString(36);
const resultsByDevice = new Map();
let devices = [];
let scenarios = [];
let activeWorker;
let requestId = 0;

function workerUrl(gpuIndex = 0) {
    const query = new URLSearchParams({ gpuIndex, v: assetVersion });
    return `./vkpeak-worker.mjs?${query}`;
}

function setBusy(busy, deviceIndex = -1) {
    document.querySelectorAll("[data-device-index]").forEach((button) => {
        button.disabled = busy;
        button.classList.toggle("is-running", busy && Number(button.dataset.deviceIndex) === deviceIndex);
    });
}

function createDeviceButton(device) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.deviceIndex = device.index;
    const title = document.createElement("strong");
    title.textContent = `WebGPU ${device.index}`;
    const detail = document.createElement("small");
    detail.textContent = device.name;
    button.append(title, detail);
    return button;
}

function renderResults() {
    if (devices.length === 0 || scenarios.length === 0) return;

    const scroll = document.createElement("div");
    scroll.className = "table-scroll";
    const table = document.createElement("table");

    const head = document.createElement("thead");
    const headerRow = document.createElement("tr");
    const scenarioHeader = document.createElement("th");
    scenarioHeader.scope = "col";
    scenarioHeader.textContent = t("scenario");
    headerRow.append(scenarioHeader);
    for (const device of devices) {
        const cell = document.createElement("th");
        cell.scope = "col";
        const title = document.createElement("strong");
        title.textContent = `WebGPU ${device.index}`;
        const detail = document.createElement("small");
        detail.textContent = device.name;
        cell.append(title, detail);
        headerRow.append(cell);
    }
    head.append(headerRow);
    table.append(head);

    const body = document.createElement("tbody");
    for (const scenario of scenarios) {
        const row = document.createElement("tr");
        const name = document.createElement("th");
        name.scope = "row";
        name.textContent = scenario.name;
        row.append(name);

        for (const device of devices) {
            const result = resultsByDevice.get(device.index)?.find((item) => item.name === scenario.name);
            const value = document.createElement("td");
            value.className = `is-${result?.status || "pending"}`;
            if (result?.status === "pass") value.textContent = `${result.score.toFixed(2)} ${result.unit}`;
            else if (result?.status === "unsupported") value.textContent = t("unsupported");
            else if (result?.status === "fail") value.textContent = t("failed");
            else value.textContent = t("notRun");
            row.append(value);
        }
        body.append(row);
    }
    table.append(body);
    scroll.append(table);
    resultsElement.replaceChildren(scroll);
}

function queryEnvironment() {
    const worker = new Worker(workerUrl(), { type: "module" });
    const id = ++requestId;
    return new Promise((resolve, reject) => {
        worker.addEventListener("message", (event) => {
            if (event.data.id !== id) return;
            worker.terminate();
            if (event.data.status === "pass") resolve(event.data);
            else reject(new Error(event.data.error));
        });
        worker.addEventListener("error", (event) => {
            worker.terminate();
            reject(new Error(event.message || t("deviceWorkerFailed")));
        });
        worker.postMessage({ id, type: "list-devices" });
    });
}

function runWorker(device, id) {
    const worker = new Worker(workerUrl(device.index), { type: "module" });
    activeWorker = worker;
    return new Promise((resolve, reject) => {
        worker.addEventListener("message", (event) => {
            if (event.data.id !== id) return;
            if (event.data.status === "progress") {
                statusElement.textContent = event.data.supported
                    ? t("peakRunning", { index: device.index, name: event.data.name })
                    : t("peakSkipped", { index: device.index, name: event.data.name });
                return;
            }
            if (event.data.status === "pass") resolve(event.data.results);
            else reject(new Error(event.data.error));
        });
        worker.addEventListener("error", (event) => {
            reject(new Error(event.message || t("vkpeakWorkerFailed")));
        });
        worker.postMessage({ id, type: "run" });
    });
}

async function runDevice(deviceIndex) {
    if (activeWorker) return;
    const device = devices.find((item) => item.index === deviceIndex);
    if (!device) return;

    const id = ++requestId;
    setBusy(true, deviceIndex);
    statusElement.textContent = t("peakInitializing", { index: device.index });
    try {
        const benchmarkResults = await runWorker(device, id);
        resultsByDevice.set(device.index, benchmarkResults);
        renderResults();
        const passed = benchmarkResults.filter((item) => item.status === "pass").length;
        const unsupported = benchmarkResults.filter((item) => item.status === "unsupported").length;
        statusElement.textContent = t("peakDone", { index: device.index, passed, unsupported });
    } catch (error) {
        console.error(error);
        statusElement.textContent = t("backendFailed", { backend: `WebGPU ${device.index}`, error: error.message });
    } finally {
        activeWorker?.terminate();
        activeWorker = undefined;
        setBusy(false);
    }
}

async function initialize() {
    if (!navigator.gpu) {
        document.querySelector("#device-placeholder").textContent = t("webgpuUnsupported");
        statusElement.textContent = t("noNavigatorGpu");
        return;
    }

    try {
        const environment = await queryEnvironment();
        devices = environment.devices;
        scenarios = environment.scenarios;
        if (devices.length === 0) throw new Error(t("noGpu"));

        deviceButtons.replaceChildren(...devices.map(createDeviceButton));
        renderResults();
        statusElement.textContent = t("devicesReady", { count: devices.length });
    } catch (error) {
        console.error(error);
        document.querySelector("#device-placeholder").textContent = t("deviceEnumerationFailed");
        statusElement.textContent = t("enumerationError", { error: error.message });
    }
}

deviceButtons.addEventListener("click", (event) => {
    const button = event.target.closest("[data-device-index]");
    if (button) runDevice(Number(button.dataset.deviceIndex));
});
window.addEventListener("pagehide", () => activeWorker?.terminate());

initialize();
