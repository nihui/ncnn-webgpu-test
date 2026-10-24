// Bounded production-worker checks. This is not a complete benchmark suite.
export async function runExtraDemos() {
    const results = [];
    let id = 0;
    for (const kind of ["benchncnn", "benchncnn-llm", "vkpeak"]) {
        const worker = new Worker(`/${kind}-worker.mjs?backend=webgpu&gpuIndex=0`, { type: "module" });
        const request = (message) => new Promise((resolve, reject) => {
            const requestId = ++id;
            const cleanup = () => {
                worker.removeEventListener("message", onMessage);
                worker.removeEventListener("error", onError);
            };
            const onError = (event) => { cleanup(); reject(new Error(event.message)); };
            const onMessage = ({ data }) => {
                if (data.id !== requestId || data.status === "progress") return;
                cleanup();
                if (data.status !== "pass") reject(new Error(`${kind}: ${JSON.stringify(data)}`));
                else resolve(data);
            };
            worker.addEventListener("message", onMessage);
            worker.addEventListener("error", onError);
            worker.postMessage({ ...message, id: requestId });
        });
        const validateObservation = (data) => {
            if (!data.observation?.adapter || data.observation.validationErrors.length || data.observation.deviceLost) throw new Error(`${kind}: missing adapter or WebGPU error`);
        };
        try {
            const environment = await request({ type: "list-devices" });
            validateObservation(environment);
            if (!environment.devices?.length) throw new Error(`${kind}: no GPU device`);
            if (kind === "benchncnn") {
                const result = await request({ type: "run", model: "blazeface", loopCount: 1 });
                validateObservation(result);
                const row = result.results?.[0];
                if (result.results?.length !== 1 || row.name !== "blazeface" || ![row.min, row.max, row.avg].every((v) => Number.isFinite(v) && v > 0) || row.min > row.avg || row.avg > row.max) throw new Error("Invalid single-model benchncnn result");
                if (result.observation.dispatches <= environment.observation.dispatches) throw new Error("benchncnn did not dispatch GPU compute");
                results.push({ kind, environment, result, coverage: "one blazeface timing iteration, including upstream warmup; not numerical parity" });
            } else if (kind === "vkpeak") {
                const expected = ["fp32-scalar", "fp32-vec4", "fp16-scalar", "fp16-vec4", "fp16-matrix", "int32-scalar", "int32-vec4", "int8-dotprod", "int8-matrix", "copy-h2d", "copy-d2h", "copy-d2d"];
                if (JSON.stringify(environment.scenarios?.map((s) => s.name)) !== JSON.stringify(expected)) throw new Error("vkpeak scenario contract changed");
                if (environment.scenarios.some((s) => !["GFLOPS", "GIOPS", "GBPS"].includes(s.unit))) throw new Error("vkpeak unit contract changed");
                results.push({ kind, environment, benchmarkExecuted: false, coverage: "adapter and scenario enumeration only; no peak-performance claim" });
            } else {
                results.push({ kind, environment, benchmarkExecuted: false, coverage: "adapter enumeration only; no LLM model inference" });
            }
        } finally { worker.terminate(); }
    }
    return results;
}
