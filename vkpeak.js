// Copyright 2026 Tencent
// SPDX-License-Identifier: BSD-3-Clause

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
    scenarioHeader.textContent = "测试条目";
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
            else if (result?.status === "unsupported") value.textContent = "不支持";
            else if (result?.status === "fail") value.textContent = "失败";
            else value.textContent = "未运行";
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
            reject(new Error(event.message || "WebGPU 设备枚举 Worker 失败"));
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
                    ? `WebGPU ${device.index} 正在运行 ${event.data.name}…`
                    : `WebGPU ${device.index} 跳过 ${event.data.name}（设备不支持）`;
                return;
            }
            if (event.data.status === "pass") resolve(event.data.results);
            else reject(new Error(event.data.error));
        });
        worker.addEventListener("error", (event) => {
            reject(new Error(event.message || "vkpeak Worker 失败"));
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
    statusElement.textContent = `WebGPU ${device.index} 正在创建 vkwebgpu 设备并编译 shader…`;
    try {
        const benchmarkResults = await runWorker(device, id);
        resultsByDevice.set(device.index, benchmarkResults);
        renderResults();
        const passed = benchmarkResults.filter((item) => item.status === "pass").length;
        const unsupported = benchmarkResults.filter((item) => item.status === "unsupported").length;
        statusElement.textContent = `WebGPU ${device.index} 完成：${passed} 项有效，${unsupported} 项设备不支持。`;
    } catch (error) {
        console.error(error);
        statusElement.textContent = `WebGPU ${device.index} 失败：${error.message}`;
    } finally {
        activeWorker?.terminate();
        activeWorker = undefined;
        setBusy(false);
    }
}

async function initialize() {
    if (!navigator.gpu) {
        document.querySelector("#device-placeholder").textContent = "浏览器不支持 WebGPU";
        statusElement.textContent = "当前浏览器没有 navigator.gpu。";
        return;
    }

    try {
        const environment = await queryEnvironment();
        devices = environment.devices;
        scenarios = environment.scenarios;
        if (devices.length === 0) throw new Error("ncnn 未报告可用 GPU");

        deviceButtons.replaceChildren(...devices.map(createDeviceButton));
        renderResults();
        statusElement.textContent = `已枚举 ${devices.length} 个 WebGPU 设备，选择设备开始测试。`;
    } catch (error) {
        console.error(error);
        document.querySelector("#device-placeholder").textContent = "设备枚举失败";
        statusElement.textContent = `WebGPU 设备枚举失败：${error.message}`;
    }
}

deviceButtons.addEventListener("click", (event) => {
    const button = event.target.closest("[data-device-index]");
    if (button) runDevice(Number(button.dataset.deviceIndex));
});
window.addEventListener("pagehide", () => activeWorker?.terminate());

initialize();
