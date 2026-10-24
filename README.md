# ncnn WebGPU demo

The checked-in UI, workers, models and CPU assets remain the demo baseline.
The default build only produces the SqueezeNet WebGPU application pair. It does not
build nikki from source, update the committed assets or deploy GitHub Pages.

## Rebuild SqueezeNet from a prebuilt nikki SDK

Requirements: emsdk **6.0.12**, CMake >= 3.22, Ninja, Python >= 3.12, Git,
Node >= 20, and curl. ncnn is fixed to
`cb65ca26ba955bf456f3a26e13e9a644769fc4a4`, including its glslang submodule.
The nikki SDK supplies its matching Tint/SPIRV-Tools archives, Vulkan headers,
pinned Emdawnwebgpu port and Asyncify/Closure link settings through
`nikki::static`. Its port may download the pinned Emdawn runtime on first link.

There is not yet a released SDK to pin as a default. Once the producer's release
is explicitly approved and published, select its fixed **YYYYMMDD tag and full
source commit**. Do not use a floating "latest" download. The
`SqueezeNet prebuilt nikki consumer` manual workflow takes those required values,
downloads the public date-named SDK asset, checks the package version/source/
toolchain, links the demo, runs tests and uploads the application pair. It needs
no cross-repository token and does not publish a release or deploy Pages. A
missing or unpublished release fails clearly, never falling back to source.

```sh
source /path/to/emsdk/emsdk_env.sh
export NIKKI_VERSION=<published-YYYYMMDD-tag>
export NIKKI_REVISION=<full-producer-commit>
tools/download-nikki.sh .deps/nikki
export NIKKI_PREFIX="$PWD/.deps/nikki"
tools/build-squeezenet.sh
```

For an already downloaded SDK, omit the download step and set `NIKKI_PREFIX`
and `NIKKI_REVISION`. `NCNN_SOURCE_DIR`, `BUILD_DIR` and `JOBS` may be overridden;
existing ncnn checkouts must be clean at the pinned commit. Final-link optimizer
concurrency defaults to `BINARYEN_CORES=1` to bound memory use; this does not lower
optimization or disable Asyncify. Outputs are
`build/assets/squeezenet-webgpu.mjs` and `.wasm`. Always keep the pair together.
A missing/incomplete SDK is an error, never a request to silently rebuild nikki.
Use a fresh build directory and an SDK rebuilt with emsdk 6.0.12 when upgrading
from an older toolchain; do not reuse old object files or static archives.

## Acceptance tests

```sh
npm ci --prefix tests/browser --ignore-scripts
node tests/check-module-abi.mjs build/assets/squeezenet-webgpu.mjs
emcmake cmake -S . -B build-cpu-reference -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DSQUEEZENET_CPU_ORACLE=ON \
  -DNCNN_SOURCE_DIR="$PWD/.deps/ncnn"
cmake --build build-cpu-reference --parallel 2
node tests/run-cpu-oracle.mjs build-cpu-reference/assets/squeezenet-reference.mjs
node tests/browser/run.mjs --chrome /path/to/chrome --module-dir build/assets
```

The ABI smoke check instantiates the linked pair and validates its exported
functions, heap views, allocation and filesystem helpers without requesting a
GPU. It does not prove browser or GPU inference.

The Node CPU check compares the reconstructed CPU wrapper with the untouched scalar
and SIMD CPU modules using the actual committed SqueezeNet model. The explicit
`SQUEEZENET_CPU_ORACLE=ON` diagnostic build is separate, never a missing-SDK
fallback and never overwrites either CPU asset. Omitting the module argument
checks only the old CPU modules, not the reconstructed wrapper. It is not browser
or GPU validation. The browser check serves the original worker/UI assets locally and overlays only the newly
built WebGPU pair. Test-only instrumentation records actual compute dispatches,
adapter identity, uncaptured WebGPU errors and unexpected device loss. No new
pair is accepted by accidentally testing the old committed WebGPU assets.

The fixtures are deterministic asymmetric-color RGBA images, square and
non-square, plus a repeated run to check model/worker reuse. Tests require the
same top-3 class IDs as the scalar CPU oracle and probability differences no
larger than `0.002 + 0.02 * abs(CPU score)`. The 17-float return layout and all ten
timing values are checked. This is **top-3 parity, not comparison of all 1000
probabilities**, and it uses synthetic images with the real model, not a natural
image accuracy dataset. Tests never loosen tolerance based on a failing GPU run.

By default Chromium uses software SwiftShader; it proves browser compute and
numerical behavior, not hardware performance. `--hardware` uses the browser's
normal adapter selection and records identity, but the flag alone is not proof
of a physical GPU. `--cpu-only` is a browser baseline diagnostic. Reports go to
`test-results.json` (or `--output PATH`); tests fail rather than skip when a
required adapter is unavailable. `--serve-only` serves the same test page for an
existing browser and displays the report in-page, without launching Chromium or
changing its settings. The local test runner uses `--no-sandbox` only
for an isolated, loopback-only headless test process, not a user browser.

## Recovered wrapper contract

`src/squeezenet.cpp` reconstructs the missing source for the worker's existing
`gpu_count`, `gpu_name`, `init`, `infer` and `destroy` exports. The old CPU WASM
confirms direct bilinear resize to 227 x 227 (no crop), RGBA-to-BGR conversion,
means `(104,117,123)`, ten timed inferences and 1000 classes. The worker exposes
only top-3 `(class, score)` pairs plus ten times and their minimum. The generated
module retains malloc/free, ccall, HEAPU8/HEAPF32 and the two FS creation helpers.

Benchmark, LLM and vkpeak sources/builds are intentionally outside this first
step. Do not update their generated modules until this SqueezeNet path has been
validated. No existing CPU module or UI is regenerated by this build.
