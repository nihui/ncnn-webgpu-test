// Copyright 2026 Tencent
// SPDX-License-Identifier: BSD-3-Clause

// use the first supported browser preference; fall back to English
export function selectLanguage(languages = []) {
    for (const locale of languages) {
        const base = String(locale).toLowerCase().split(/[-_]/)[0];
        if (base === "zh") return "zh";
        if (base === "en") return "en";
    }
    return "en";
}

const preferences = globalThis.navigator?.languages;
export const language = selectLanguage(preferences?.length ? preferences : [globalThis.navigator?.language || "en"]);

const messages = {
    "squeezeHero": {"zh": "同一张图，<br><em>多个浏览器后端。</em>", "en": "One image,<br><em>multiple browser backends.</em>"},
    "squeezeIntro": {"zh": "真实 ImageNet 模型在本地完成推理。每次连续执行 10 轮，展示最快一轮的耗时、Top-3 分类和置信度。", "en": "Run a real ImageNet model locally. Each run performs 10 consecutive inferences and shows the fastest time, top-3 classes and confidence."},
    "checking": {"zh": "检测中", "en": "Checking"},
    "chooseImage": {"zh": "选择或拖入图片", "en": "Choose or drop an image"},
    "replaceImage": {"zh": "点击更换图片", "en": "Click to replace the image"},
    "inputSection": {"zh": "01 / 输入", "en": "01 / INPUT"},
    "chooseBackend": {"zh": "选择推理后端", "en": "Choose an inference backend"},
    "noImage": {"zh": "尚未选择图片", "en": "No image selected"},
    "scalarCpu": {"zh": "标量 CPU", "en": "Scalar CPU"},
    "enumeratingDevices": {"zh": "正在枚举设备…", "en": "Enumerating devices…"},
    "uploadToStart": {"zh": "上传图片后即可开始。", "en": "Upload an image to get started."},
    "resultSection": {"zh": "02 / 结果", "en": "02 / RESULTS"},
    "classificationPerformance": {"zh": "分类与性能", "en": "Classification and performance"},
    "squeezeTiming": {"zh": "计时覆盖创建 `Extractor`、`Extractor::input()` 和 `Extractor::extract()`，模型加载、WebGPU shader 编译和图片预处理不计入；初始化时间单独显示。", "en": "Timing covers creating `Extractor`, `Extractor::input()` and `Extractor::extract()`. Model loading, WebGPU shader compilation and image preprocessing are excluded; initialization is shown separately."},
    "fastestTen": {"zh": "10 次最快", "en": "Fastest of 10"},
    "backendComparison": {"zh": "各后端与设备耗时对比", "en": "Backend and device timings"},
    "shorterTen": {"zh": "越短越快 · 每项取 10 次连续推理的最快值", "en": "Shorter is faster · Fastest of 10 consecutive inferences"},
    "notRun": {"zh": "待运行", "en": "Not run"},
    "resultsEmpty": {"zh": "运行任一后端后，详细结果会显示在这里。", "en": "Run a backend to see detailed results here."},
    "tenTimings": {"zh": "10 次推理 / ms", "en": "10 inferences / ms"},
    "browserCapabilities": {"zh": "浏览器能力", "en": "Browser capabilities"},
    "imagePreview": {"zh": "待分类图片预览", "en": "Image preview for classification"},
    "squeezeDescription": {"zh": "ncnn SqueezeNet WASM、WASM SIMD 与多 WebGPU 设备浏览器端推理对比", "en": "Compare ncnn SqueezeNet inference with WASM, WASM SIMD and multiple WebGPU devices in your browser"},
    "initialization": {"zh": "初始化", "en": "Initialization"},
    "benchHero": {"zh": "浏览器版 <em>benchncnn</em>", "en": "<em>benchncnn</em> in your browser"},
    "benchIntro": {"zh": "选择一个 ncnn 内置模型，页面会自动顺序运行 WASM、WASM-SIMD 与每个 WebGPU 设备。每个后端完成后立即加入耗时柱状图。", "en": "Choose a built-in ncnn model to run WASM, WASM-SIMD and each WebGPU device in sequence. Timings appear in the chart as each backend finishes."},
    "chooseModel": {"zh": "选择模型", "en": "Choose a model"},
    "modelEnumPending": {"zh": "正在枚举 WebGPU 设备，稍后选择模型开始测试。", "en": "Enumerating WebGPU devices. Choose a model when ready."},
    "modelTimings": {"zh": "模型耗时", "en": "Model timings"},
    "benchTiming": {"zh": "保持原生 benchncnn 口径，计时包含创建 Extractor、输入、提取输出及 Extractor 销毁；模型加载和 warmup 不计入。", "en": "Matches native benchncnn timing: Extractor creation, input, output extraction and Extractor destruction are included; model loading and warmup are excluded."},
    "modelsEmpty": {"zh": "选择一个模型，自动比较全部可用后端。", "en": "Choose a model to compare all available backends."},
    "benchFooter": {"zh": "柱越短越快 · 各后端顺序运行，避免相互争抢资源", "en": "Shorter bars are faster · Backends run sequentially to avoid resource contention"},
    "configureSection": {"zh": "01 / 配置", "en": "01 / CONFIGURE"},
    "benchmarkResultSection": {"zh": "02 / 结果", "en": "02 / RESULTS"},
    "benchModels": {"zh": "benchncnn 模型", "en": "benchncnn models"},
    "benchDescription": {"zh": "ncnn benchncnn 浏览器性能测试", "en": "ncnn benchncnn browser benchmark"},
    "loopCount": {"zh": "正式循环次数", "en": "Measured iterations"},
    "llmHero": {"zh": "浏览器版 <em>benchncnn_llm</em>", "en": "<em>benchncnn_llm</em> in your browser"},
    "llmIntro": {"zh": "选择一个 LLM 结构，页面会自动顺序运行 WASM、WASM-SIMD 与每个 WebGPU 设备，并实时绘制 prefill 和 decode 吞吐量柱状图。", "en": "Choose an LLM architecture to run WASM, WASM-SIMD and each WebGPU device in sequence, with live prefill and decode throughput charts."},
    "prefillDecode": {"zh": "Prefill 与 Decode", "en": "Prefill and Decode"},
    "llmTiming": {"zh": "每个模型完成后立即更新 prefill 与 decode。数值保持新版原生 benchncnn_llm 的最快轮 tokens/s 口径。", "en": "Prefill and decode update as each model finishes. Values use the fastest iteration in tokens/s, matching the current native benchncnn_llm."},
    "llmFooter": {"zh": "柱越长越快 · 后端间销毁 Worker 以回收 Wasm 与 WebGPU 内存", "en": "Longer bars are faster · Workers are destroyed between backends to release Wasm and WebGPU memory"},
    "llmModels": {"zh": "benchncnn_llm 模型", "en": "benchncnn_llm models"},
    "llmDescription": {"zh": "ncnn benchncnn_llm 浏览器性能测试", "en": "ncnn benchncnn_llm browser benchmark"},
    "vkpeakHero": {"zh": "浏览器版 <em>vkpeak</em>", "en": "<em>vkpeak</em> in your browser"},
    "vkpeakIntro": {"zh": "参考 <a href=\"https://github.com/nihui/vkpeak\" target=\"_blank\" rel=\"noreferrer\">vkpeak</a>，通过 ncnn Vulkan API、nikki 和 WebGPU 测量合成算术、cooperative matrix 吞吐与内存带宽。结果不代表真实模型性能。", "en": "Based on <a href=\"https://github.com/nihui/vkpeak\" target=\"_blank\" rel=\"noreferrer\">vkpeak</a>, measuring synthetic arithmetic, cooperative matrix throughput and memory bandwidth through ncnn Vulkan API, nikki and WebGPU. Results do not represent real model performance."},
    "chooseDevice": {"zh": "选择 WebGPU 设备", "en": "Choose a WebGPU device"},
    "deviceRunHint": {"zh": "设备逐个运行，避免相互争抢 GPU；已经完成的结果会保留在同一张表中。", "en": "Devices run one at a time to avoid GPU contention. Completed results stay in the same table."},
    "initializingNikki": {"zh": "正在初始化 nikki。", "en": "Initializing nikki."},
    "peakResults": {"zh": "峰值测试结果", "en": "Peak benchmark results"},
    "peakTableHint": {"zh": "每一行是一个 vkpeak 测试条目，每一列对应一个由 ncnn 枚举的 WebGPU 设备。", "en": "Each row is a vkpeak test; each column is a WebGPU device enumerated by ncnn."},
    "devicesEmpty": {"zh": "设备枚举完成后将在这里生成结果表。", "en": "The results table will appear after device enumeration."},
    "localTests": {"zh": "所有测试均在本地浏览器中运行", "en": "All tests run locally in your browser"},
    "deviceSection": {"zh": "01 / 设备", "en": "01 / DEVICE"},
    "vkpeakDescription": {"zh": "ncnn Vulkan on nikki 浏览器峰值测试", "en": "ncnn Vulkan on nikki browser peak benchmark"},
    "labelsFailed": {"zh": "类别文件加载失败：HTTP {status}", "en": "Failed to load class labels: HTTP {status}"},
    "workerFailed": {"zh": "{backend} Worker 失败", "en": "{backend} Worker failed"},
    "classFallback": {"zh": "类别 {index}", "en": "Class {index}"},
    "runningTen": {"zh": "{backend} 正在连续推理 10 次…", "en": "{backend}: running 10 consecutive inferences…"},
    "loadingTen": {"zh": "{backend} 正在加载模型并连续推理 10 次…", "en": "{backend}: loading the model and running 10 consecutive inferences…"},
    "inferenceDone": {"zh": "{backend} 完成，最快 {time} ms", "en": "{backend} finished; fastest {time} ms"},
    "backendFailed": {"zh": "{backend} 失败：{error}", "en": "{backend} failed: {error}"},
    "deviceCount": {"zh": "{count} 个设备", "en": "{count} devices"},
    "enumerationError": {"zh": "WebGPU 设备枚举失败：{error}", "en": "WebGPU device enumeration failed: {error}"},
    "resizedInput": {"zh": " · 推理输入缩放至 {width}×{height}", "en": " · Inference input resized to {width}×{height}"},
    "imageReadFailed": {"zh": "图片读取失败：{error}", "en": "Failed to read image: {error}"},
    "available": {"zh": "可用", "en": "Available"},
    "unsupported": {"zh": "不支持", "en": "Unsupported"},
    "enumerating": {"zh": "正在枚举", "en": "Enumerating"},
    "browserUnsupported": {"zh": "浏览器不支持", "en": "Browser unsupported"},
    "deviceWorkerFailed": {"zh": "WebGPU 设备枚举 Worker 失败", "en": "WebGPU device enumeration Worker failed"},
    "noGpu": {"zh": "ncnn 未报告可用 GPU", "en": "ncnn reported no available GPU"},
    "deviceEnumerationFailed": {"zh": "设备枚举失败", "en": "Device enumeration failed"},
    "enumerationFailed": {"zh": "枚举失败", "en": "Enumeration failed"},
    "chooseSupportedImage": {"zh": "请选择 JPEG、PNG、WebP 等浏览器支持的图片。", "en": "Choose a browser-supported image such as JPEG, PNG or WebP."},
    "imageReady": {"zh": "图片已就绪，请选择一个后端。", "en": "Image ready. Choose a backend."},
    "benchmarkSummary": {"zh": "{passed}/{total} 个后端完成 · min ms，越短越快", "en": "{passed}/{total} backends completed · min ms, shorter is faster"},
    "timingAria": {"zh": "{model} 后端耗时对比", "en": "{model} backend timing comparison"},
    "benchmarkRunning": {"zh": "{model} · {backend} 正在执行 warmup 与测试（{current}/{total}）…", "en": "{model} · {backend}: warming up and benchmarking ({current}/{total})…"},
    "benchmarkDone": {"zh": "{model} 完成：{passed} 个后端成功，{failed} 个失败。可继续选择其他模型，已有图表会保留。", "en": "{model} finished: {passed} backends passed, {failed} failed. Choose another model; existing charts will remain."},
    "modelsReady": {"zh": "已枚举 {count} 个 WebGPU 设备；点击模型将自动顺序运行 {total} 个后端。", "en": "Found {count} WebGPU devices. Choose a model to run {total} backends in sequence."},
    "enumerationCpuFallback": {"zh": "WebGPU 设备枚举失败：{error}；仍可比较两个 CPU 后端。", "en": "WebGPU device enumeration failed: {error}. The two CPU backends remain available."},
    "scalarSingleThread": {"zh": "单线程标量 Wasm", "en": "Single-thread scalar Wasm"},
    "simdSingleThread": {"zh": "单线程 Wasm SIMD", "en": "Single-thread Wasm SIMD"},
    "comparingBackends": {"zh": "正在比较全部后端…", "en": "Comparing all backends…"},
    "runAgain": {"zh": "再次运行", "en": "Run again"},
    "runAll": {"zh": "运行全部后端", "en": "Run all backends"},
    "failed": {"zh": "失败", "en": "Failed"},
    "running": {"zh": "运行中…", "en": "Running…"},
    "waiting": {"zh": "等待…", "en": "Waiting…"},
    "cpuOnly": {"zh": "当前浏览器没有 WebGPU；将比较 WASM 与 WASM-SIMD。", "en": "WebGPU is unavailable in this browser; comparing WASM and WASM-SIMD."},
    "benchWorkerFailed": {"zh": "benchncnn Worker 失败", "en": "benchncnn Worker failed"},
    "throughputAria": {"zh": "{model} {metric} 吞吐量对比", "en": "{model} {metric} throughput comparison"},
    "llmSummary": {"zh": "{passed} 个后端完成 · {skipped} 个跳过 · tok/s，越长越快", "en": "{passed} backends completed · {skipped} skipped · tok/s, longer is faster"},
    "quantizedCpu": {"zh": "weight-quant · CPU 后端", "en": "weight-quant · CPU backends"},
    "vulkanSkipped": {"zh": "Vulkan 跳过", "en": "Vulkan skipped"},
    "llmWorkerFailed": {"zh": "benchncnn_llm Worker 失败", "en": "benchncnn_llm Worker failed"},
    "peakRunning": {"zh": "WebGPU {index} 正在运行 {name}…", "en": "WebGPU {index}: running {name}…"},
    "peakSkipped": {"zh": "WebGPU {index} 跳过 {name}（设备不支持）", "en": "WebGPU {index}: skipping {name} (unsupported by this device)"},
    "peakInitializing": {"zh": "WebGPU {index} 正在创建 nikki 设备并编译 shader…", "en": "WebGPU {index}: creating the nikki device and compiling shaders…"},
    "peakDone": {"zh": "WebGPU {index} 完成：{passed} 项有效，{unsupported} 项设备不支持。", "en": "WebGPU {index} finished: {passed} tests passed, {unsupported} unsupported by this device."},
    "devicesReady": {"zh": "已枚举 {count} 个 WebGPU 设备，选择设备开始测试。", "en": "Found {count} WebGPU devices. Choose a device to start."},
    "scenario": {"zh": "测试条目", "en": "Test"},
    "vkpeakWorkerFailed": {"zh": "vkpeak Worker 失败", "en": "vkpeak Worker failed"},
    "webgpuUnsupported": {"zh": "浏览器不支持 WebGPU", "en": "This browser does not support WebGPU"},
    "noNavigatorGpu": {"zh": "当前浏览器没有 navigator.gpu。", "en": "navigator.gpu is unavailable in this browser."},
    "squeezeTitle": {"zh": "ncnn SqueezeNet · 浏览器后端对比", "en": "ncnn SqueezeNet · Browser Backend Lab"},
    "benchTitle": {"zh": "benchncnn · 浏览器性能测试", "en": "benchncnn · Browser Benchmark"},
    "llmTitle": {"zh": "benchncnn_llm · 浏览器性能测试", "en": "benchncnn_llm · Browser Benchmark"},
    "vkpeakTitle": {"zh": "vkpeak · ncnn Vulkan 浏览器峰值测试", "en": "vkpeak · ncnn Vulkan on WebGPU"},
    "averageMaximum": {"zh": "平均 {avg} · 最大 {max}", "en": "avg {avg} · max {max}"}
};

export function t(key, values = {}) {
    const message = messages[key]?.[language] ?? messages[key]?.en ?? key;
    return message.replace(/\{([a-zA-Z]+)\}/g, (match, name) => Object.hasOwn(values, name) ? String(values[name]) : match);
}

export function localizePage(root = document) {
    if (root.documentElement) root.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    for (const element of root.querySelectorAll("[data-i18n]")) {
        element.textContent = t(element.dataset.i18n);
    }
    // rich messages contain only fixed markup from this module, never runtime values
    for (const element of root.querySelectorAll("[data-i18n-html]")) {
        element.innerHTML = t(element.dataset.i18nHtml);
    }
    for (const attribute of ["aria-label", "alt", "content"]) {
        for (const element of root.querySelectorAll(`[data-i18n-${attribute}]`)) {
            element.setAttribute(attribute, t(element.getAttribute(`data-i18n-${attribute}`)));
        }
    }
    for (const template of root.querySelectorAll("template")) localizePage(template.content);
}
