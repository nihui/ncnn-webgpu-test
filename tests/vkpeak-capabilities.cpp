// Copyright 2026 Tencent
// SPDX-License-Identifier: BSD-3-Clause

// Exercise the actual ABI shim without requesting a browser adapter. Only the
// enumeration/device lookup boundary is replaced; no benchmark kernel is run.
#include "gpu.h"

struct TestGpuInfo
{
    bool support_fp16_storage() const { return true; }
    bool support_fp16_arithmetic() const { return true; }
    bool support_int8_arithmetic() const { return true; }
    bool support_cooperative_matrix() const { return true; }
    bool support_VK_KHR_cooperative_matrix() const { return true; }
    bool support_VK_NV_cooperative_matrix() const { return false; }
    const char* device_name() const { return "capability test"; }

    VkPhysicalDeviceShaderIntegerDotProductFeaturesKHR queryShaderIntegerDotProductFeatures() const
    {
        VkPhysicalDeviceShaderIntegerDotProductFeaturesKHR feature = {};
        feature.shaderIntegerDotProduct = VK_TRUE;
        return feature;
    }

    std::vector<VkCooperativeMatrixPropertiesKHR> queryCooperativeMatrixSubProperties() const
    {
        VkCooperativeMatrixPropertiesKHR property = {};
        property.MSize = property.NSize = property.KSize = 16;
        property.AType = property.BType = VK_COMPONENT_TYPE_SINT8_KHR;
        property.CType = property.ResultType = VK_COMPONENT_TYPE_SINT32_KHR;
        property.scope = VK_SCOPE_SUBGROUP_KHR;
        return std::vector<VkCooperativeMatrixPropertiesKHR>(1, property);
    }

    std::vector<VkCooperativeMatrixPropertiesNV> queryCooperativeMatrixSubPropertiesNV() const
    {
        return std::vector<VkCooperativeMatrixPropertiesNV>();
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

extern "C" int ncnn_vkpeak_test_capabilities()
{
    device_calls = 0;
    if (!test_info.queryShaderIntegerDotProductFeatures().shaderIntegerDotProduct)
        return 1;
    if (ncnn_vkpeak_scenario_supported(0, 7) != 0)
        return 2;
    if (ncnn_vkpeak_run(0, 7) != -1)
        return 3;
    if (device_calls != 0)
        return 4;
    // An unrelated int8 matrix path stays available with the required shape.
    if (ncnn_vkpeak_scenario_supported(0, 8) != 1)
        return 5;
    ncnn_vkpeak_destroy();
    return 0;
}
