# Copyright 2026 Tencent
# SPDX-License-Identifier: BSD-3-Clause
cmake_minimum_required(VERSION 3.22)
project(ncnn_webgpu_squeezenet LANGUAGES C CXX)

if(NOT CMAKE_SYSTEM_NAME STREQUAL "Emscripten")
    message(FATAL_ERROR "Configure with emcmake and emsdk 6.0.12")
endif()
execute_process(COMMAND "${CMAKE_CXX_COMPILER}" -dumpversion
    OUTPUT_VARIABLE emsdk_version OUTPUT_STRIP_TRAILING_WHITESPACE)
if(NOT emsdk_version STREQUAL "6.0.12")
    message(FATAL_ERROR "This demo requires emsdk 6.0.12; got ${emsdk_version}")
endif()

option(SQUEEZENET_CPU_ORACLE "Build diagnostic CPU wrappers, never replacing committed CPU assets" OFF)
if(NOT SQUEEZENET_CPU_ORACLE)
    # There is deliberately no add_subdirectory(nikki) or source-build fallback.
    if(NOT EXISTS "${nikki_DIR}/nikkiConfig.cmake")
        message(FATAL_ERROR "Set nikki_DIR to the selected prebuilt SDK's lib/cmake/nikki directory")
    endif()
    find_package(nikki CONFIG REQUIRED PATHS "${nikki_DIR}" NO_DEFAULT_PATH)
    if(NOT TARGET nikki::static)
        message(FATAL_ERROR "The nikki package does not provide nikki::static")
    endif()
endif()

set(NCNN_SOURCE_DIR "" CACHE PATH "Pinned ncnn checkout (including its glslang submodule)")
if(NOT EXISTS "${NCNN_SOURCE_DIR}/CMakeLists.txt")
    message(FATAL_ERROR "Set NCNN_SOURCE_DIR to the checkout prepared by tools/build-squeezenet.sh")
endif()
if(SQUEEZENET_CPU_ORACLE)
    set(NCNN_VULKAN OFF CACHE BOOL "" FORCE)
else()
    set(NCNN_VULKAN ON CACHE BOOL "" FORCE)
endif()
set(NCNN_SIMPLEVK ON CACHE BOOL "" FORCE)
set(NCNN_THREADS OFF CACHE BOOL "" FORCE)
set(NCNN_OPENMP OFF CACHE BOOL "" FORCE)
set(NCNN_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(NCNN_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(NCNN_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(NCNN_BUILD_BENCHMARK OFF CACHE BOOL "" FORCE)
set(NCNN_INSTALL_SDK OFF CACHE BOOL "" FORCE)
set(NCNN_SHARED_LIB OFF CACHE BOOL "" FORCE)
set(NCNN_RUNTIME_CPU OFF CACHE BOOL "" FORCE)
set(NCNN_ENABLE_LTO OFF CACHE BOOL "" FORCE)
set(NCNN_SYSTEM_GLSLANG OFF CACHE BOOL "" FORCE)
add_subdirectory("${NCNN_SOURCE_DIR}" ncnn)
if(SQUEEZENET_CPU_ORACLE)
    set(application squeezenet-reference)
else()
    target_link_libraries(ncnn PUBLIC nikki::static)
    set(application squeezenet-webgpu)
endif()

function(add_demo_module target source)
    add_executable(${target} ${source})
    target_compile_features(${target} PRIVATE cxx_std_11)
    target_link_libraries(${target} PRIVATE ncnn)
    target_link_options(${target} PRIVATE
        -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=worker
        -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=268435456)
    set_target_properties(${target} PROPERTIES SUFFIX ".mjs"
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/assets")
endfunction()

add_demo_module(${application} src/squeezenet.cpp)
target_link_options(${application} PRIVATE --no-entry -sFORCE_FILESYSTEM=1
    "-sEXPORTED_FUNCTIONS=['_malloc','_free','_ncnn_squeezenet_gpu_count','_ncnn_squeezenet_gpu_name','_ncnn_squeezenet_init','_ncnn_squeezenet_infer','_ncnn_squeezenet_destroy']"
    "-sEXPORTED_RUNTIME_METHODS=['ccall','HEAPU8','HEAPF32','FS_createPath','FS_createDataFile']")

option(NCNN_WEBGPU_EXTRA_DEMOS "Also build benchncnn, benchncnn_llm and vkpeak" OFF)
if(NCNN_WEBGPU_EXTRA_DEMOS)
    include(cmake/BenchmarkParams.cmake)
    generate_benchmark_params(benchncnn "${NCNN_SOURCE_DIR}/benchmark/models")
    generate_benchmark_params(benchncnn_llm "${NCNN_SOURCE_DIR}/benchmark/models/llm")
    if(SQUEEZENET_CPU_ORACLE)
        set(backend reference)
    else()
        set(backend webgpu)
    endif()
    foreach(kind benchncnn benchncnn_llm)
        string(REPLACE "_" "-" stem "${kind}")
        set(target "${stem}-${backend}")
        add_demo_module(${target} "src/${kind}.cpp")
        target_include_directories(${target} PRIVATE "${NCNN_SOURCE_DIR}" "${CMAKE_CURRENT_BINARY_DIR}")
        add_dependencies(${target} "${kind}-params")
        target_link_options(${target} PRIVATE -sEXIT_RUNTIME=1 -sMAXIMUM_MEMORY=4294967296
            "-sEXPORTED_FUNCTIONS=['_main','_malloc','_free','_ncnn_benchmark_gpu_count','_ncnn_benchmark_gpu_name','_ncnn_benchmark_destroy_gpu_instance']"
            "-sEXPORTED_RUNTIME_METHODS=['ccall','callMain','HEAPU8']")
    endforeach()
    if(NOT SQUEEZENET_CPU_ORACLE)
        add_demo_module(vkpeak-webgpu src/vkpeak.cpp)
        target_link_options(vkpeak-webgpu PRIVATE --no-entry
            "-sEXPORTED_FUNCTIONS=['_malloc','_free','_ncnn_vkpeak_gpu_count','_ncnn_vkpeak_gpu_name','_ncnn_vkpeak_scenario_count','_ncnn_vkpeak_scenario_name','_ncnn_vkpeak_scenario_unit','_ncnn_vkpeak_scenario_supported','_ncnn_vkpeak_run','_ncnn_vkpeak_destroy']"
            "-sEXPORTED_RUNTIME_METHODS=['ccall','HEAPU8']")
    endif()
endif()
