#!/usr/bin/env python3
# Copyright 2026 Tencent
# SPDX-License-Identifier: BSD-3-Clause
"""Execute the adapted upstream's real early capability guards, without a GPU."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile

source = Path(sys.argv[1]).read_text()
start = source.index("static double vkpeak(int device_id,")
end = source.index("    // check shader bf16 feature", start)
# Compile the actual guard block, not a second implementation of its predicates.
guards = source[start:end] + "    return 1;\n}\n"
stubs = r"""
namespace ncnn {
struct Features { bool shaderFloat64 = false; bool shaderInt64 = false; bool shaderIntegerDotProduct = true; };
struct Info {
    bool fp16 = true, matrix = true;
    Features features;
    bool support_fp16_storage() const { return fp16; }
    bool support_fp16_arithmetic() const { return fp16; }
    bool support_int8_arithmetic() const { return false; }
    bool support_cooperative_matrix() const { return matrix; }
    Features physicalDevicefeatures() const { return features; }
    Features queryShaderIntegerDotProductFeatures() const { return features; }
};
struct VulkanDevice { Info info; };
static VulkanDevice device;
static VulkanDevice* get_gpu_device(int id) { return id == 0 ? &device : 0; }
}
"""
cases = r"""
int main() {
    if (vkpeak(0, 3, 6, 256) != 1) return 1;
    if (vkpeak(0, 3, 6, 4) != 1) return 2;
    if (vkpeak(0, 3, 6, 1) != 0) return 3; // General shaderInt8 remains unavailable.
    ncnn::device.info.features.shaderIntegerDotProduct = false;
    if (vkpeak(0, 3, 6, 4) != 0 || vkpeak(0, 3, 6, 256) != 1) return 4;
    ncnn::device.info.features.shaderIntegerDotProduct = true;
    ncnn::device.info.matrix = false;
    if (vkpeak(0, 3, 6, 256) != 0 || vkpeak(0, 3, 6, 4) != 1) return 5;
    if (vkpeak(-1, 3, 6, 4) != 0) return 6;
    return 0;
}
"""
with tempfile.TemporaryDirectory() as directory:
    cpp = Path(directory) / "gates.cpp"
    binary = Path(directory) / "gates"
    cpp.write_text(stubs + guards + cases)
    subprocess.run(["c++", "-std=c++11", str(cpp), "-o", str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
print(json.dumps({"status": "pass", "check": "adapted upstream int8 guards with shaderInt8=false", "mockedGpuCapabilities": True, "gpuBenchmarkExecuted": False}))
