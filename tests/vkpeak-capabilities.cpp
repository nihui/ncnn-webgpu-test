// Copyright 2026 Tencent
// SPDX-License-Identifier: BSD-3-Clause

// Exercise the actual ABI shim without requesting a browser adapter. Only the
// enumeration/device lookup boundary is replaced; no benchmark kernel is run.
#include "gpu.h"

struct TestGpuInfo
{
    bool dot = true;
    bool matrix = true;
    bool khr = true;
    bool nv = false;
    bool shape = true;
    bool signed_input = true;
    bool int32_accumulator = true;
    bool matching_result = true;
    bool supported_scope = true;
    bool fp16_storage = true;
    bool fp16_arithmetic = true;

    bool support_fp16_storage() const { return fp16_storage; }
    bool support_fp16_arithmetic() const { return fp16_arithmetic; }
    // Match nikki's profile: matrix components and packed dot are available,
    // but general scalar shaderInt8 arithmetic and 8-bit buffers are not.
    bool support_int8_arithmetic() const { return false; }
    bool support_int8_storage() const { return false; }
    bool support_cooperative_matrix() const { return matrix; }
    bool support_VK_KHR_cooperative_matrix() const { return khr; }
    bool support_VK_NV_cooperative_matrix() const { return nv; }
    const char* device_name() const { return "capability test"; }

    VkPhysicalDeviceShaderIntegerDotProductFeaturesKHR queryShaderIntegerDotProductFeatures() const
    {
        VkPhysicalDeviceShaderIntegerDotProductFeaturesKHR feature = {};
        feature.shaderIntegerDotProduct = dot ? VK_TRUE : VK_FALSE;
        return feature;
    }

    std::vector<VkCooperativeMatrixPropertiesKHR> queryCooperativeMatrixSubProperties() const
    {
        if (!shape) return {};
        VkCooperativeMatrixPropertiesKHR property = {};
        property.MSize = property.NSize = property.KSize = 16;
        property.AType = property.BType = signed_input ? VK_COMPONENT_TYPE_SINT8_KHR : VK_COMPONENT_TYPE_UINT8_KHR;
        property.CType = int32_accumulator ? VK_COMPONENT_TYPE_SINT32_KHR : VK_COMPONENT_TYPE_FLOAT32_KHR;
        property.ResultType = matching_result ? property.CType : VK_COMPONENT_TYPE_UINT32_KHR;
        property.scope = supported_scope ? VK_SCOPE_SUBGROUP_KHR : VK_SCOPE_DEVICE_KHR;
        return std::vector<VkCooperativeMatrixPropertiesKHR>(1, property);
    }

    std::vector<VkCooperativeMatrixPropertiesNV> queryCooperativeMatrixSubPropertiesNV() const
    {
        if (!shape) return {};
        VkCooperativeMatrixPropertiesNV property = {};
        property.MSize = property.NSize = property.KSize = 16;
        property.AType = property.BType = signed_input ? VK_COMPONENT_TYPE_SINT8_NV : VK_COMPONENT_TYPE_UINT8_NV;
        property.CType = int32_accumulator ? VK_COMPONENT_TYPE_SINT32_NV : VK_COMPONENT_TYPE_FLOAT32_NV;
        property.DType = matching_result ? property.CType : VK_COMPONENT_TYPE_UINT32_NV;
        property.scope = supported_scope ? VK_SCOPE_SUBGROUP_NV : VK_SCOPE_DEVICE_NV;
        return std::vector<VkCooperativeMatrixPropertiesNV>(1, property);
    }
};

static int device_calls = 0;
static TestGpuInfo test_info;

namespace ncnn {
static int test_create_gpu_instance() { return 0; }
static int test_get_gpu_count() { return 1; }
static const TestGpuInfo& test_get_gpu_info(int) { return test_info; }
static VulkanDevice* test_get_gpu_device(int)
{
    device_calls++;
    return 0;
}
static void test_destroy_gpu_instance() {}
} // namespace ncnn

#define create_gpu_instance test_create_gpu_instance
#define get_gpu_count test_get_gpu_count
#define get_gpu_info test_get_gpu_info
#define get_gpu_device test_get_gpu_device
#define destroy_gpu_instance test_destroy_gpu_instance
#include "../src/vkpeak.cpp"
#undef create_gpu_instance
#undef get_gpu_count
#undef get_gpu_info
#undef get_gpu_device
#undef destroy_gpu_instance

static bool rejected_before_device_lookup(int scenario)
{
    device_calls = 0;
    return ncnn_vkpeak_scenario_supported(0, scenario) == 0 &&
           ncnn_vkpeak_run(0, scenario) == -1 && device_calls == 0;
}

extern "C" int ncnn_vkpeak_test_capabilities()
{
    test_info = TestGpuInfo();
    device_calls = 0;
    if (test_info.support_int8_arithmetic() || test_info.support_int8_storage())
        return 1;
    // Independent packed-dot and typed-matrix capabilities, with shaderInt8=0.
    if (ncnn_vkpeak_scenario_supported(0, 7) != 1 || ncnn_vkpeak_scenario_supported(0, 8) != 1 || device_calls != 0)
        return 2;
    // Supported tests reach device lookup; the stub deliberately has no device.
    if (ncnn_vkpeak_run(0, 7) != 0 || device_calls != 1)
        return 3;
    if (ncnn_vkpeak_run(0, 8) != 0 || device_calls != 2)
        return 4;

    test_info.dot = false;
    if (!rejected_before_device_lookup(7) || ncnn_vkpeak_scenario_supported(0, 8) != 1)
        return 5;
    test_info = TestGpuInfo();
    test_info.matrix = false;
    if (!rejected_before_device_lookup(8) || ncnn_vkpeak_scenario_supported(0, 7) != 1)
        return 6;

    // Check the exact input/accumulator/result/scope contract on KHR and NV.
    bool TestGpuInfo::* missing[] = {&TestGpuInfo::shape, &TestGpuInfo::signed_input,
        &TestGpuInfo::int32_accumulator, &TestGpuInfo::matching_result, &TestGpuInfo::supported_scope};
    for (int extension = 0; extension < 2; extension++)
    {
        for (unsigned int i = 0; i < sizeof(missing) / sizeof(missing[0]); i++)
        {
            test_info = TestGpuInfo();
            test_info.khr = extension == 0;
            test_info.nv = extension == 1;
            if (ncnn_vkpeak_scenario_supported(0, 8) != 1)
                return 7;
            test_info.*missing[i] = false;
            if (!rejected_before_device_lookup(8))
                return 8;
        }
    }
    test_info = TestGpuInfo();
    test_info.khr = false;
    if (!rejected_before_device_lookup(8))
        return 9;
    test_info = TestGpuInfo();
    test_info.fp16_storage = false;
    if (!rejected_before_device_lookup(4))
        return 10;
    test_info = TestGpuInfo();
    test_info.fp16_arithmetic = false;
    if (!rejected_before_device_lookup(2))
        return 11;
    ncnn_vkpeak_destroy();
    return 0;
}
