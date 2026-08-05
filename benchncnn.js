// Copyright 2026 Tencent
// SPDX-License-Identifier: BSD-3-Clause

const models = [
    "squeezenet", "squeezenet_int8", "mobilenet", "mobilenet_int8", "mobilenet_v2",
    "mobilenet_v3", "shufflenet", "shufflenet_v2", "mnasnet", "proxylessnasnet",
    "efficientnet_b0", "efficientnetv2_b0", "regnety_400m", "blazeface", "googlenet",
    "googlenet_int8", "resnet18", "resnet18_int8", "alexnet", "vgg16", "vgg16_int8",
    "resnet50", "resnet50_int8", "squeezenet_ssd", "squeezenet_ssd_int8",
    "mobilenet_ssd", "mobilenet_ssd_int8", "mobilenet_yolo", "mobilenetv2_yolov3",
    "yolov4-tiny", "nanodet_m", "yolo-fastest-1.1", "yolo-fastestv2",
    "vision_transformer", "FastestDet",
];

const modelButtons = document.querySelector("#model-buttons");
const resultsElement = document.querySelector("#results");
const statusElement = document.querySelector("#status");
const loopCountElement = document.querySelector("#loop-count");
const assetVersion = Date.now().toString(36);

let targets = [
    { backend: "wasm", color: "#7a8276", detail: "单线程标量 Wasm", key: "wasm", title: "WASM" },
    { backend: "wasm-simd", color: "#d76528", detail: "单线程 Wasm SIMD", key: "wasm-simd", title: "WASM-SIMD" },
];
const records = new Map();
const runOrder = [];
let activeWorker;
let activeModel = "";
let activeTargetKey = "";
let ready = false;
let requestId = 0;

function workerUrl(target) {
    const query = new URLSearchParams({
        backend: target.backend,
        gpuIndex: target.gpuIndex ?? 0,
        v: assetVersion,
    });
    return `./benchncnn-worker.mjs?${query}`;
}

function recordKey(model, target) {
    return `${model}\n${target.key}`;
}

function renderModelButtons() {
    const buttons = models.map((model) => {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.model = model;
        button.disabled = !ready || Boolean(activeModel);
        button.classList.toggle("is-running", activeModel === model);
        button.classList.toggle("has-results", runOrder.includes(model));

        const title = document.createElement("strong");
        title.textContent = model;
        const detail = document.createElement("small");
        detail.textContent = activeModel === model ? "正在比较全部后端…" : runOrder.includes(model) ? "再次运行" : "运行全部后端";
        button.append(title, detail);
        return button;
    });
    modelButtons.replaceChildren(...buttons);
    loopCountElement.disabled = !ready || Boolean(activeModel);
}

function createChartRow(model, target, fastest, slowest) {
    const record = records.get(recordKey(model, target));
    const row = document.createElement("div");
    row.className = "bar-row";
    row.style.setProperty("--bar-color", target.color);

    const label = document.createElement("div");
    label.className = "bar-label";
    const title = document.createElement("strong");
    title.textContent = target.title;
    const detail = document.createElement("small");
    detail.textContent = target.detail;
    label.append(title, detail);

    const track = document.createElement("div");
    track.className = "bar-track";
    const fill = document.createElement("div");
    fill.className = "bar-fill";
    if (record?.status === "pass") {
        fill.style.width = `${Math.max(2, record.result.min / slowest * 100)}%`;
        if (record.result.min === fastest) row.classList.add("is-best");
    }
    track.append(fill);

    const value = document.createElement("div");
    value.className = "bar-value";
    if (record?.status === "pass") {
        const primary = document.createElement("strong");
        primary.textContent = `${record.result.min.toFixed(2)} ms`;
        const secondary = document.createElement("small");
        secondary.textContent = `avg ${record.result.avg.toFixed(2)} · max ${record.result.max.toFixed(2)}`;
        value.append(primary, secondary);
    } else if (record?.status === "fail") {
        value.classList.add("is-fail");
        value.textContent = "失败";
        value.title = record.error;
    } else {
        value.textContent = record?.status === "running" ? "运行中…" : "等待…";
    }

    row.append(label, track, value);
    return row;
}

function renderModelResult(model) {
    const panel = document.createElement("article");
    panel.className = "model-result";

    const header = document.createElement("div");
    header.className = "model-result-heading";
    const heading = document.createElement("h3");
    heading.textContent = model;
    const passed = targets.filter((target) => records.get(recordKey(model, target))?.status === "pass").length;
    const summary = document.createElement("p");
    summary.textContent = `${passed}/${targets.length} 个后端完成 · min ms，越短越快`;
    header.append(heading, summary);

    const chart = document.createElement("div");
    chart.className = "bar-chart";
    chart.setAttribute("aria-label", `${model} 后端耗时对比`);
    const values = targets
        .map((target) => records.get(recordKey(model, target)))
        .filter((record) => record?.status === "pass")
        .map((record) => record.result.min);
    const fastest = values.length ? Math.min(...values) : -1;
    const slowest = values.length ? Math.max(...values) : 1;
    for (const target of targets) chart.append(createChartRow(model, target, fastest, slowest));

    panel.append(header, chart);
    return panel;
}

function renderResults() {
    if (runOrder.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = "选择一个模型，自动比较全部可用后端。";
        resultsElement.replaceChildren(empty);
        return;
    }

    resultsElement.replaceChildren(...runOrder.map(renderModelResult));
}

function queryDevices() {
    const target = { backend: "webgpu", gpuIndex: 0 };
    const worker = new Worker(workerUrl(target), { type: "module" });
    const id = ++requestId;
    return new Promise((resolve, reject) => {
        worker.addEventListener("message", (event) => {
            if (event.data.id !== id) return;
            worker.terminate();
            if (event.data.status === "pass") resolve(event.data.devices);
            else reject(new Error(event.data.error));
        });
        worker.addEventListener("error", (event) => {
            worker.terminate();
            reject(new Error(event.message || "WebGPU device enumeration Worker failed"));
        });
        worker.postMessage({ id, type: "list-devices" });
    });
}

function runWorker(target, model, loopCount) {
    const worker = new Worker(workerUrl(target), { type: "module" });
    activeWorker = worker;
    const id = ++requestId;
    return new Promise((resolve, reject) => {
        worker.addEventListener("message", (event) => {
            if (event.data.id !== id) return;
            if (event.data.status === "progress") {
                records.set(recordKey(model, target), { result: event.data.result, status: "pass" });
                renderResults();
                return;
            }
            if (event.data.status === "pass") resolve(event.data.results[0]);
            else reject(new Error(event.data.error));
        });
        worker.addEventListener("error", (event) => reject(new Error(event.message || "benchncnn Worker failed")));
        worker.postMessage({ id, loopCount, model, type: "run" });
    });
}

async function runModel(model) {
    if (!ready || activeModel) return;

    activeModel = model;
    activeTargetKey = "";
    if (!runOrder.includes(model)) runOrder.push(model);
    for (const target of targets) records.set(recordKey(model, target), { status: "pending" });
    renderModelButtons();
    renderResults();

    let passed = 0;
    let failed = 0;
    for (let index = 0; index < targets.length; index++) {
        const target = targets[index];
        activeTargetKey = target.key;
        records.set(recordKey(model, target), { status: "running" });
        statusElement.textContent = `${model} · ${target.title} 正在执行 warmup 与测试（${index + 1}/${targets.length}）…`;
        renderResults();
        try {
            await runWorker(target, model, Number(loopCountElement.value));
            passed++;
        } catch (error) {
            console.error(error);
            records.set(recordKey(model, target), { error: error.message, status: "fail" });
            failed++;
        } finally {
            activeWorker?.terminate();
            activeWorker = undefined;
            renderResults();
        }
    }

    statusElement.textContent = `${model} 完成：${passed} 个后端成功，${failed} 个失败。可继续选择其他模型，已有图表会保留。`;
    activeModel = "";
    activeTargetKey = "";
    renderModelButtons();
    renderResults();
}

async function initialize() {
    renderModelButtons();
    renderResults();
    let deviceMessage = "当前浏览器没有 WebGPU；将比较 WASM 与 WASM-SIMD。";
    if (navigator.gpu) {
        try {
            const devices = await queryDevices();
            targets = targets.concat(devices.map((device) => ({
                backend: "webgpu",
                color: `hsl(${96 + device.index * 37} 58% 42%)`,
                detail: device.name,
                gpuIndex: device.index,
                key: `webgpu:${device.index}`,
                title: `WebGPU ${device.index}`,
            })));
            deviceMessage = `已枚举 ${devices.length} 个 WebGPU 设备；点击模型将自动顺序运行 ${targets.length} 个后端。`;
        } catch (error) {
            console.error(error);
            deviceMessage = `WebGPU 设备枚举失败：${error.message}；仍可比较两个 CPU 后端。`;
        }
    }
    ready = true;
    statusElement.textContent = deviceMessage;
    renderModelButtons();
}

modelButtons.addEventListener("click", (event) => {
    const button = event.target.closest("[data-model]");
    if (button) runModel(button.dataset.model);
});
window.addEventListener("pagehide", () => activeWorker?.terminate());

initialize();
