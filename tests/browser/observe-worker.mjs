// Test-only instrumentation prepended by the local server; production worker is unchanged.
const observation = { adapter: "", dispatches: 0, validationErrors: [], deviceLost: false };
const originalPostMessage = self.postMessage.bind(self);
self.postMessage = (message, ...rest) => originalPostMessage({ ...message, observation: structuredClone(observation) }, ...rest);
if (navigator.gpu) {
    const requestAdapter = navigator.gpu.requestAdapter.bind(navigator.gpu);
    navigator.gpu.requestAdapter = async (...args) => {
        const adapter = await requestAdapter(...args);
        if (adapter) {
            const info = adapter.info || {};
            observation.adapter = [info.vendor, info.architecture, info.device, info.description].filter(Boolean).join(" ");
            const requestDevice = adapter.requestDevice.bind(adapter);
            adapter.requestDevice = async (...deviceArgs) => {
                const device = await requestDevice(...deviceArgs);
                device.addEventListener("uncapturederror", (event) => observation.validationErrors.push(event.error.message));
                device.lost.then((info) => {
                    if (info.reason !== "destroyed") observation.deviceLost = true;
                });
                return device;
            };
        }
        return adapter;
    };
    const dispatch = GPUComputePassEncoder.prototype.dispatchWorkgroups;
    GPUComputePassEncoder.prototype.dispatchWorkgroups = function (...args) {
        observation.dispatches++;
        return dispatch.apply(this, args);
    };
}
