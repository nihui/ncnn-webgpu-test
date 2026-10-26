# Copyright 2026 Tencent
# SPDX-License-Identifier: BSD-3-Clause
# Embed only the params from the pinned ncnn checkout, using its own generator.
function(generate_benchmark_params name directory)
    file(GLOB params CONFIGURE_DEPENDS "${directory}/*.param")
    if(NOT params)
        message(FATAL_ERROR "No benchmark parameters in ${directory}")
    endif()
    file(MAKE_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/param")
    set(headers)
    set(param_header_data)
    foreach(param IN LISTS params)
        get_filename_component(identifier "${param}" NAME)
        string(REGEX REPLACE "\\.param$" "" identifier "${identifier}")
        string(REGEX REPLACE "[.-]" "_" identifier "${identifier}")
        set(header "${CMAKE_CURRENT_BINARY_DIR}/param/${identifier}.hex.h")
        add_custom_command(OUTPUT "${header}"
            COMMAND "${CMAKE_COMMAND}" "-DPARAM_SRC=${param}"
                "-DPARAM_SRC_NAME_WE=${identifier}" "-DPARAM_HEADER=${header}"
                -P "${NCNN_SOURCE_DIR}/cmake/ncnn_generate_param_header.cmake"
            DEPENDS "${param}" "${NCNN_SOURCE_DIR}/cmake/ncnn_generate_param_header.cmake"
            VERBATIM)
        list(APPEND headers "${header}")
        string(APPEND param_header_data "#include \"param/${identifier}.hex.h\"\n")
    endforeach()
    configure_file("${NCNN_SOURCE_DIR}/benchmark/benchncnn_param_data.h.in"
        "${CMAKE_CURRENT_BINARY_DIR}/${name}_param_data.h" @ONLY)
    add_custom_target(${name}-params DEPENDS ${headers})
endfunction()
