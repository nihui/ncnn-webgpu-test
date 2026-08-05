// Copyright 2026 Tencent
// SPDX-License-Identifier: BSD-3-Clause

const models = [
    { label: "Hunyuan 0.5B Instruct", name: "hunyuan_0.5b" },
    { label: "Hunyuan 0.5B · INT8 G32", name: "hunyuan_0.5b_int8g32", quantized: true },
    { label: "Hunyuan 0.5B · INT8 G128", name: "hunyuan_0.5b_int8g128", quantized: true },
    { label: "MiniCPM4 0.5B", name: "minicpm4_0.5b" },
    { label: "MiniCPM4 0.5B · INT8 G32", name: "minicpm4_0.5b_int8g32", quantized: true },
    { label: "MiniCPM4 0.5B · INT8 G128", name: "minicpm4_0.5b_int8g128", quantized: true },
    { label: "Qwen2.5 0.5B", name: "qwen2.5_0.5b" },
    { label: "Qwen2.5 0.5B · INT8 G32", name: "qwen2.5_0.5b_int8g32", quantized: true },
    { label: "Qwen2.5 0.5B · INT8 G128", name: "qwen2.5_0.5b_int8g128", quantized: true },
    { label: "Qwen3 0.6B", name: "qwen3_0.6b" },
    { label: "Qwen3 0.6B · INT8 G32", name: "qwen3_0.6b_int8g32", quantized: true },
    { label: "Qwen3 0.6B · INT8 G128", name: "qwen3_0.6b_int8g128", quantized: true },
    { label: "Llama 3.2 1B", name: "llama3.2_1b" },
    { label: "Llama 3.2 1B · INT8 G32", name: "llama3.2_1b_int8g32", quantized: true },
    { label: "Llama 3.2 1B · INT8 G128", name: "llama3.2_1b_int8g128", quantized: true },
    { label: "TinyLlama 1.1B", name: "tinyllama_1.1b" },
    { label: "TinyLlama 1.1B · INT8 G32", name: "tinyllama_1.1b_int8g32", quantized: true },
    { label: "TinyLlama 1.1B · INT8 G128", name: "tinyllama_1.1b_int8g128", quantized: true },
    { label: "Youtu LLM 2B", name: "youtu_llm_2b" },
    { label: "Youtu LLM 2B · INT8 G32", name: "youtu_llm_2b_int8g32", quantized: true },
    { label: "Youtu LLM 2B · INT8 G128", name: "youtu_llm_2b_int8g128", quantized: true },
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
let ready = false;
let requestId = 0;

function workerUrl(target) {
    const query = new URLSearchParams({
        backend: target.backend,
        gpuIndex: target.gpuIndex ?? 0,
        v: assetVersion,
    });
    return `./benchncnn-llm-worker.mjs?${query}`;
}

function recordKey(model, target) {
    return `${model.name}\n${target.key}`;
}

function renderModelButtons() {
    const buttons = models.map((model) => {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.model = model.name;
        button.disabled = !ready || Boolean(activeModel);
        button.classList.toggle("is-running", activeModel === model.name);
        button.classList.toggle("has-results", runOrder.includes(model.name));

        const title = document.createElement("strong");
        title.textContent = model.label;
        const detail = document.createElement("small");
        detail.textContent = activeModel === model.name ? "正在比较全部后端…" : runOrder.includes(model.name) ? "再次运行" : model.quantized ? "weight-quant · CPU 后端" : "运行全部后端";
        button.append(title, detail);
        return button;
    });
    modelButtons.replaceChildren(...buttons);
    loopCountElement.disabled = !ready || Boolean(activeModel);
}

function createChartRow(model, target, metric, best, maximum) {
    const record = records.get(recordKey(model, target));
    const valueNumber = record?.status === "pass" ? record.result[metric] : 0;
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
        fill.style.width = `${Math.max(2, valueNumber / maximum * 100)}%`;
        if (valueNumber === best) row.classList.add("is-best");
    }
    track.append(fill);

    const value = document.createElement("div");
    value.className = "bar-value";
    if (record?.status === "pass") {
        const primary = document.createElement("strong");
        primary.textContent = `${valueNumber.toFixed(2)} tok/s`;
        value.append(primary);
    } else if (record?.status === "unsupported") {
        value.textContent = "Vulkan 跳过";
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

function createMetricChart(model, metric, titleText, detailText) {
    const section = document.createElement("section");
    section.className = "metric-chart";
    const heading = document.createElement("div");
    heading.className = "metric-chart-heading";
    const title = document.createElement("h4");
    title.textContent = titleText;
    const detail = document.createElement("p");
    detail.textContent = detailText;
    heading.append(title, detail);

    const chart = document.createElement("div");
    chart.className = "bar-chart";
    chart.setAttribute("aria-label", `${model.label} ${titleText} 吞吐量对比`);
    const values = targets
        .map((target) => records.get(recordKey(model, target)))
        .filter((record) => record?.status === "pass")
        .map((record) => record.result[metric]);
    const best = values.length ? Math.max(...values) : -1;
    const maximum = values.length ? Math.max(...values) : 1;
    for (const target of targets) chart.append(createChartRow(model, target, metric, best, maximum));
    section.append(heading, chart);
    return section;
}

function renderModelResult(model) {
    const panel = document.createElement("article");
    panel.className = "model-result";
    const header = document.createElement("div");
    header.className = "model-result-heading";
    const heading = document.createElement("h3");
    heading.textContent = model.label;
    const passed = targets.filter((target) => records.get(recordKey(model, target))?.status === "pass").length;
    const skipped = targets.filter((target) => records.get(recordKey(model, target))?.status === "unsupported").length;
    const summary = document.createElement("p");
    summary.textContent = `${passed} 个后端完成${skipped ? ` · ${skipped} 个跳过` : ""} · tok/s，越长越快`;
    header.append(heading, summary);
    panel.append(
        header,
        createMetricChart(model, "prefillTps", "Prefill", "256-token prefill"),
        createMetricChart(model, "decodeTps", "Decode", "1-token decode · 256-token cache"),
    );
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
    const panels = runOrder.map((name) => renderModelResult(models.find((model) => model.name === name)));
    resultsElement.replaceChildren(...panels);
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
        worker.addEventListener("error", (event) => reject(new Error(event.message || "benchncnn_llm Worker failed")));
        worker.postMessage({ id, loopCount, model: model.name, type: "run" });
    });
}

async function runModel(model) {
    if (!ready || activeModel) return;

    activeModel = model.name;
    if (!runOrder.includes(model.name)) runOrder.push(model.name);
    for (const target of targets) {
        records.set(recordKey(model, target), { status: target.backend === "webgpu" && model.quantized ? "unsupported" : "pending" });
    }
    renderModelButtons();
    renderResults();

    const runTargets = targets.filter((target) => target.backend !== "webgpu" || !model.quantized);
    let passed = 0;
    let failed = 0;
    for (let index = 0; index < runTargets.length; index++) {
        const target = runTargets[index];
        records.set(recordKey(model, target), { status: "running" });
        statusElement.textContent = `${model.label} · ${target.title} 正在执行 warmup 与测试（${index + 1}/${runTargets.length}）…`;
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

    statusElement.textContent = `${model.label} 完成：${passed} 个后端成功，${failed} 个失败。可继续选择其他模型，已有图表会保留。`;
    activeModel = "";
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
    if (!button) return;
    const model = models.find((item) => item.name === button.dataset.model);
    if (model) runModel(model);
});
window.addEventListener("pagehide", () => activeWorker?.terminate());

initialize();
