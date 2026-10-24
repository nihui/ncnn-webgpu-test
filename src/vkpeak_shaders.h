// Copyright 2026 Tencent
// SPDX-License-Identifier: BSD-3-Clause

// Recovered verbatim from the baseline vkpeak-webgpu.wasm embedded GLSL.

static const char glsl_fp16_fp32_matrix[] = R"(
#version 450
#extension GL_EXT_shader_explicit_arithmetic_types_float16 : require
#extension GL_KHR_memory_scope_semantics : require
#extension GL_KHR_cooperative_matrix : require

layout(constant_id = 0) const int loop = 1;
layout(constant_id = 1) const int M = 1;
layout(constant_id = 2) const int N = 1;
layout(constant_id = 3) const int K = 1;
layout(constant_id = 4) const int SCOPE = 3;
layout(binding = 0) writeonly buffer c_blob { float c_blob_data[]; };

void main()
{
    const uint group_offset = gl_WorkGroupID.x * M * N;
    const float seed = float(gl_WorkGroupID.x & 7u) + 1.0;
    coopmat<float16_t, SCOPE, M, K, gl_MatrixUseA> a = coopmat<float16_t, SCOPE, M, K, gl_MatrixUseA>(seed);
    coopmat<float16_t, SCOPE, K, N, gl_MatrixUseB> b = coopmat<float16_t, SCOPE, K, N, gl_MatrixUseB>(seed + 1.0);
    coopmat<float, SCOPE, M, N, gl_MatrixUseAccumulator> c = coopmat<float, SCOPE, M, N, gl_MatrixUseAccumulator>(0.0);
    for (int i = 0; i < loop; i++)
    {c = coopMatMulAdd(a, b, c); c = coopMatMulAdd(a, b, c);c = coopMatMulAdd(a, b, c); c = coopMatMulAdd(a, b, c);c = coopMatMulAdd(a, b, c); c = coopMatMulAdd(a, b, c);c = coopMatMulAdd(a, b, c); c = coopMatMulAdd(a, b, c);c = coopMatMulAdd(a, b, c); c = coopMatMulAdd(a, b, c);c = coopMatMulAdd(a, b, c); c = coopMatMulAdd(a, b, c);c = coopMatMulAdd(a, b, c); c = coopMatMulAdd(a, b, c);c = coopMatMulAdd(a, b, c); c = coopMatMulAdd(a, b, c);}
    coopMatStore(c, c_blob_data, group_offset, N, gl_CooperativeMatrixLayoutRowMajor);
}
)";

static const char glsl_fp16_matrix[] = R"(
#version 450
#extension GL_EXT_shader_explicit_arithmetic_types_float16 : require
#extension GL_EXT_shader_16bit_storage : require
#extension GL_KHR_memory_scope_semantics : require
#extension GL_KHR_cooperative_matrix : require

layout(constant_id = 0) const int loop = 1;
layout(constant_id = 1) const int M = 1;
layout(constant_id = 2) const int N = 1;
layout(constant_id = 3) const int K = 1;
layout(constant_id = 4) const int SCOPE = 3;
layout(binding = 0) writeonly buffer c_blob { float16_t c_blob_data[]; };

void main()
{
    const uint group_offset = gl_WorkGroupID.x * M * N;
    const float seed = float(gl_WorkGroupID.x & 7u) + 1.0;
    coopmat<float16_t, SCOPE, M, K, gl_MatrixUseA> a = coopmat<float16_t, SCOPE, M, K, gl_MatrixUseA>(seed);
    coopmat<float16_t, SCOPE, K, N, gl_MatrixUseB> b = coopmat<float16_t, SCOPE, K, N, gl_MatrixUseB>(seed + 1.0);
    coopmat<float16_t, SCOPE, M, N, gl_MatrixUseAccumulator> c = coopmat<float16_t, SCOPE, M, N, gl_MatrixUseAccumulator>(0.0);
    for (int i = 0; i < loop; i++)
    {c = coopMatMulAdd(a, b, c); c = coopMatMulAdd(a, b, c);c = coopMatMulAdd(a, b, c); c = coopMatMulAdd(a, b, c);c = coopMatMulAdd(a, b, c); c = coopMatMulAdd(a, b, c);c = coopMatMulAdd(a, b, c); c = coopMatMulAdd(a, b, c);c = coopMatMulAdd(a, b, c); c = coopMatMulAdd(a, b, c);c = coopMatMulAdd(a, b, c); c = coopMatMulAdd(a, b, c);c = coopMatMulAdd(a, b, c); c = coopMatMulAdd(a, b, c);c = coopMatMulAdd(a, b, c); c = coopMatMulAdd(a, b, c);}
    coopMatStore(c, c_blob_data, group_offset, N, gl_CooperativeMatrixLayoutRowMajor);
}
)";

static const char glsl_int8_matrix[] = R"(
#version 450
#extension GL_EXT_shader_explicit_arithmetic_types : require
#extension GL_KHR_memory_scope_semantics : require
#extension GL_KHR_cooperative_matrix : require

layout(constant_id = 0) const int loop = 1;
layout(constant_id = 1) const int M = 1;
layout(constant_id = 2) const int N = 1;
layout(constant_id = 3) const int K = 1;
layout(constant_id = 4) const int SCOPE = 3;
layout(binding = 0) writeonly buffer c_blob { int c_blob_data[]; };

void main()
{
    const uint group_offset = gl_WorkGroupID.x * M * N;
    const int seed = int((gl_WorkGroupID.x & 7u) + 1u);
    coopmat<int8_t, SCOPE, M, K, gl_MatrixUseA> a = coopmat<int8_t, SCOPE, M, K, gl_MatrixUseA>(seed);
    coopmat<int8_t, SCOPE, K, N, gl_MatrixUseB> b = coopmat<int8_t, SCOPE, K, N, gl_MatrixUseB>(seed + 1);
    coopmat<int, SCOPE, M, N, gl_MatrixUseAccumulator> c = coopmat<int, SCOPE, M, N, gl_MatrixUseAccumulator>(0);
    for (int i = 0; i < loop; i++)
    {c = coopMatMulAdd(a, b, c); c = coopMatMulAdd(a, b, c);c = coopMatMulAdd(a, b, c); c = coopMatMulAdd(a, b, c);c = coopMatMulAdd(a, b, c); c = coopMatMulAdd(a, b, c);c = coopMatMulAdd(a, b, c); c = coopMatMulAdd(a, b, c);c = coopMatMulAdd(a, b, c); c = coopMatMulAdd(a, b, c);c = coopMatMulAdd(a, b, c); c = coopMatMulAdd(a, b, c);c = coopMatMulAdd(a, b, c); c = coopMatMulAdd(a, b, c);c = coopMatMulAdd(a, b, c); c = coopMatMulAdd(a, b, c);}
    coopMatStore(c, c_blob_data, group_offset, N, gl_CooperativeMatrixLayoutRowMajor);
}
)";

static const char glsl_fp_scalar[] = R"(
#version 450

layout(constant_id = 0) const int loop = 1;
layout(binding = 0) writeonly buffer c_blob { float c_blob_data[]; };

void main()
{
    const uint gx = gl_GlobalInvocationID.x;
    const uint lx = gl_LocalInvocationID.x;
    afp c0 = afp(gx);
    afp c1 = afp(lx);
    afp a = c0;
    afp b = c1;
    for (int i = 0; i < loop; i++)
    {c0 = a * c0 + b; c1 = a * c1 + b;c0 = a * c0 + b; c1 = a * c1 + b;c0 = a * c0 + b; c1 = a * c1 + b;c0 = a * c0 + b; c1 = a * c1 + b;c0 = a * c0 + b; c1 = a * c1 + b;c0 = a * c0 + b; c1 = a * c1 + b;c0 = a * c0 + b; c1 = a * c1 + b;c0 = a * c0 + b; c1 = a * c1 + b;}
    c_blob_data[gx] = float(c0 + c1);
}
)";

static const char glsl_fp_vec4[] = R"(
#version 450

layout(constant_id = 0) const int loop = 1;
layout(binding = 0) writeonly buffer c_blob { float c_blob_data[]; };

void main()
{
    const uint gx = gl_GlobalInvocationID.x;
    const uint lx = gl_LocalInvocationID.x;
    afpvec4 c0 = afpvec4(gx);
    afpvec4 c1 = afpvec4(lx);
    afpvec4 a = c0 + afpvec4(0, 1, 2, -3);
    afpvec4 b = c1 + afpvec4(2, 3, 5, -7);
    for (int i = 0; i < loop; i++)
    {c0 = a * c0 + b; c1 = a * c1 + b;c0 = a * c0 + b; c1 = a * c1 + b;c0 = a * c0 + b; c1 = a * c1 + b;c0 = a * c0 + b; c1 = a * c1 + b;c0 = a * c0 + b; c1 = a * c1 + b;c0 = a * c0 + b; c1 = a * c1 + b;c0 = a * c0 + b; c1 = a * c1 + b;c0 = a * c0 + b; c1 = a * c1 + b;}
    c0 += c1;
    c_blob_data[gx] = float((c0.x + c0.y) + (c0.z + c0.w));
}
)";

static const char glsl_int_scalar[] = R"(
#version 450

layout(constant_id = 0) const int loop = 1;
layout(binding = 0) writeonly buffer c_blob { int c_blob_data[]; };

void main()
{
    const uint gx = gl_GlobalInvocationID.x;
    const uint lx = gl_LocalInvocationID.x;
    int c0 = int(gx);
    int c1 = int(lx);
    int a = c0;
    int b = c1;
    for (int i = 0; i < loop; i++)
    {c0 = a * c0 + b; c1 = a * c1 + b;c0 = a * c0 + b; c1 = a * c1 + b;c0 = a * c0 + b; c1 = a * c1 + b;c0 = a * c0 + b; c1 = a * c1 + b;c0 = a * c0 + b; c1 = a * c1 + b;c0 = a * c0 + b; c1 = a * c1 + b;c0 = a * c0 + b; c1 = a * c1 + b;c0 = a * c0 + b; c1 = a * c1 + b;}
    c_blob_data[gx] = c0 + c1;
}
)";

static const char glsl_int_vec4[] = R"(
#version 450

layout(constant_id = 0) const int loop = 1;
layout(binding = 0) writeonly buffer c_blob { int c_blob_data[]; };

void main()
{
    const uint gx = gl_GlobalInvocationID.x;
    const uint lx = gl_LocalInvocationID.x;
    ivec4 c0 = ivec4(gx);
    ivec4 c1 = ivec4(lx);
    ivec4 a = c0 + ivec4(0, 1, 2, -3);
    ivec4 b = c1 + ivec4(2, 3, 5, -7);
    for (int i = 0; i < loop; i++)
    {c0 = a * c0 + b; c1 = a * c1 + b;c0 = a * c0 + b; c1 = a * c1 + b;c0 = a * c0 + b; c1 = a * c1 + b;c0 = a * c0 + b; c1 = a * c1 + b;c0 = a * c0 + b; c1 = a * c1 + b;c0 = a * c0 + b; c1 = a * c1 + b;c0 = a * c0 + b; c1 = a * c1 + b;c0 = a * c0 + b; c1 = a * c1 + b;}
    c0 += c1;
    c_blob_data[gx] = (c0.x + c0.y) + (c0.z + c0.w);
}
)";

static const char glsl_int8_dotprod[] = R"(
#version 450
#extension GL_EXT_integer_dot_product : require

layout(constant_id = 0) const int loop = 1;
layout(binding = 0) writeonly buffer c_blob { int c_blob_data[]; };

void main()
{
    const uint gx = gl_GlobalInvocationID.x;
    const uint lx = gl_LocalInvocationID.x;
    int c0 = int(gx);
    int c1 = int(lx);
    const int a = int(gx);
    const int b = int(lx);
    for (int i = 0; i < loop; i++)
    {c0 += dotPacked4x8EXT(a, b); c1 += dotPacked4x8EXT(a, b);c0 += dotPacked4x8EXT(a, b); c1 += dotPacked4x8EXT(a, b);c0 += dotPacked4x8EXT(a, b); c1 += dotPacked4x8EXT(a, b);c0 += dotPacked4x8EXT(a, b); c1 += dotPacked4x8EXT(a, b);c0 += dotPacked4x8EXT(a, b); c1 += dotPacked4x8EXT(a, b);c0 += dotPacked4x8EXT(a, b); c1 += dotPacked4x8EXT(a, b);c0 += dotPacked4x8EXT(a, b); c1 += dotPacked4x8EXT(a, b);c0 += dotPacked4x8EXT(a, b); c1 += dotPacked4x8EXT(a, b);}
    c_blob_data[gx] = c0 + c1;
}
)";
