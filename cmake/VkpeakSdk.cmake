# Copyright 2026 Tencent
# SPDX-License-Identifier: BSD-3-Clause
function(require_vkpeak_sdk package_dir)
    # Only vkpeak needs these lowerings; do not constrain CPU/SqueezeNet builds.
    get_filename_component(sdk_root "${package_dir}/../../.." ABSOLUTE)
    set(version_file "${sdk_root}/release-version.txt")
    set(required_sdk "vkpeak requires nikki SDK 20261027 or newer (packed saturating integer dot and int8 cooperative matrix lowering)")
    if(NOT EXISTS "${version_file}")
        message(FATAL_ERROR "${required_sdk}; missing ${version_file}")
    endif()
    file(READ "${version_file}" sdk_release)
    string(STRIP "${sdk_release}" sdk_release)
    if(NOT sdk_release MATCHES "^[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]$"
       OR sdk_release LESS 20261027)
        message(FATAL_ERROR "${required_sdk}; got '${sdk_release}'")
    endif()
endfunction()
