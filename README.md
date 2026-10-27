# ncnn WebGPU demo

The repository keeps UI sources and models, not precompiled application modules.
The build produces scalar and SIMD wasm32 CPU modules for SqueezeNet, benchncnn
and benchncnn_llm, plus wasm32/wasm64 WebGPU modules for those demos and vkpeak.
CI stages the tested site for GitHub Pages; serve the staged output, not the
source checkout. nikki is consumed as a prebuilt SDK rather than built here.

## Rebuild the demos from a prebuilt nikki SDK

Requirements: emsdk **6.0.12**, CMake >= 3.22, Ninja, Python >= 3.12, Git,
Node >= 20, curl, and GNU patch. ncnn is fixed to
`cb65ca26ba955bf456f3a26e13e9a644769fc4a4`, including its glslang submodule.
[nihui/vkpeak](https://github.com/nihui/vkpeak) is fixed to
`f37dab4c421781bf047face221dbaf6ae112a5e7`. The build fetches these source
checkouts if absent and rejects a different revision or tracked local changes.
Only nikki is consumed as a prebuilt SDK; ncnn and vkpeak are upstream sources.
The nikki SDK supplies its matching Tint/SPIRV-Tools archives, Vulkan headers,
pinned Emdawnwebgpu port and Asyncify/Closure link settings through
`nikki::static`. Use a dual-architecture SDK release that includes the Emdawn
runtime and architecture metadata. The WebGPU vkpeak build requires release
`20261027` or newer for packed saturating integer dots and int8 cooperative
matrix translation; a reused older SDK fails configuration rather than exposing
tests its translator cannot run. This minimum does not apply to CPU or
SqueezeNet-only builds.

Each build resolves the latest formal nikki release once through GitHub's public
API. The selected YYYYMMDD tag is resolved to its actual commit, including
annotated tags; `target_commitish` is not trusted as a source revision. Both
architectures use that same resolution even if a newer release appears mid-build.
The downloader verifies each archive's GitHub SHA256 digest before extraction,
then checks package version, source commit, toolchain and architecture. Missing
releases, incomplete architecture pairs or absent digests fail closed, with no
source-build fallback. No cross-repository token or manually edited pin is needed.

```sh
source /path/to/emsdk/emsdk_env.sh
python3 tools/resolve-sdk-release.py > sdk-release.env || exit 1
set -a
source sdk-release.env
set +a
for arch in wasm32 wasm64; do
    WASM_ARCH="$arch" tools/download-nikki.sh ".deps/nikki-$arch"
    WASM_ARCH="$arch" NIKKI_PREFIX="$PWD/.deps/nikki-$arch" \
        BUILD_DIR="build-$arch" tools/build-webgpu.sh
done
```

For an already downloaded SDK, omit the download step and set `NIKKI_PREFIX`
and `NIKKI_REVISION`, with `WASM_ARCH=wasm32` or `wasm64` matching its
`architecture.txt`. The downloader defaults to `.deps/nikki-$WASM_ARCH`. `NCNN_SOURCE_DIR`, `VKPEAK_SOURCE_DIR`, `BUILD_DIR` and
`JOBS` may be overridden;
existing ncnn checkouts must be clean at the pinned commit. Final-link optimizer
concurrency defaults to `BINARYEN_CORES=1` to bound memory use; this does not lower
optimization or disable Asyncify. The script serializes the four final links.
Outputs are `${BUILD_DIR}/assets/{squeezenet,benchncnn,benchncnn-llm,vkpeak}-webgpu.mjs`
and matching `.wasm` files. Default build directories are `build` for wasm32 and
`build-wasm64` for wasm64; the loop above sets both explicitly. Always keep each
pair together and never mix architectures.
`tools/build-squeezenet.sh` retains the minimal SqueezeNet-only entry point;
`tools/build-webgpu.sh benchncnn-webgpu` builds just the named target.
A missing/incomplete SDK is an error, never a request to silently rebuild nikki.
Use a fresh build directory and an SDK rebuilt with emsdk 6.0.12 when upgrading
from an older toolchain; do not reuse old object files or static archives.

## Build CPU backends

The CPU modules reuse the same pinned ncnn sources and browser adapters. No
nikki SDK is required. After activating emsdk 6.0.12, run:

```sh
for backend in wasm wasm-simd; do
    CPU_BACKEND="$backend" BUILD_DIR="build-cpu-$backend" tools/build-cpu.sh
done
python3 tests/check-cpu-features.py build-cpu-wasm/assets build-cpu-wasm-simd/assets
node tests/run-cpu-oracle.mjs build-cpu-wasm/assets build-cpu-wasm-simd/assets
node tests/check-benchmark-contract.mjs build-cpu-wasm/assets build-cpu-wasm-simd/assets
```

Outputs retain `*-wasm.{mjs,wasm}` and `*-wasm-simd.{mjs,wasm}` filenames and
the existing worker ABI. CPU backends remain wasm32; only the SIMD variant uses
SIMD instructions. Deployment requires both CPU output directories and both
WebGPU output directories. No deleted binary is downloaded or used as fallback.

## Page language

Pages choose the first supported language in the browser's preference list:
Chinese (`zh` locales) or English (`en` locales), with English as the fallback
when neither is listed. The shared `i18n.mjs` includes static labels,
accessibility text and dynamic status/results. Model names, backend identifiers
and benchmark values are not translated.

## Automatic browser selection

WebGPU workers validate a small Memory64 module in the current browser. When
supported they load `assets/wasm64/*-webgpu.mjs` and its matching Wasm; otherwise
they keep the wasm32 `assets/*-webgpu.mjs` path. The choice is shared by all four
demos and does not use browser-name/version guesses. Scalar and SIMD CPU backends
remain wasm32 modules, now built from source. WebGPU must still be available; Memory64
does not add WebGPU support or change GPU buffer limits.

Pointer parameters use Emscripten's `ccall` pointer type for either ABI, while
heap offsets stay Numbers without 32-bit shifts. Wasm64 permits an 8 GiB maximum
linear memory (not an upfront allocation). A failed download, module initialization
or GPU operation is reported, not silently retried as wasm32 and hidden.

## CI and GitHub Pages

`.github/workflows/webgpu-pages.yml` builds and tests pull requests, pushes to
`master`, and manual runs. Only a successful `master` push or manual run in
`nihui/ncnn-webgpu-test` can enter the separate Pages deployment job. PRs and
manual runs on other branches cannot deploy. The build token has only
`contents: read`, and checkout does not persist credentials; only the deployment
job receives `pages: write` and `id-token: write`. Deployments use the
`github-pages` environment and a non-cancelling deployment concurrency group.

CI resolves the latest formal release once after the SDK-free tests. It records
the release ID, tag, actual commit and both asset digests in
`test-results-sdk-resolution.json`, with the frozen build environment in
`sdk-release.env`. These are uploaded separately even if resolution or a later
step fails, so the exact SDK input can be inspected or reused for a reproduction.
A missing/incomplete release blocks the build and deployment rather than using
old assets.

Before the first deployment, confirm **Settings → Pages → Source** is
**GitHub Actions**. This change has not inspected or changed the current Pages
setting; the workflow does not enable Pages or modify its settings automatically.

After all ABI, CPU and browser checks pass, `tools/stage-site.py` creates a fresh
`_site` containing only the existing HTML/JS/CSS/workers, the three SqueezeNet
model files, all newly built scalar/SIMD CPU pairs, and all four WebGPU pairs for each architecture.
It rejects missing or empty runtime files, linked files, existing output and the
committed GPU directory as input. It does not copy `.git`, `.deps`, source,
tests, SDK files or build reports. Wasm32 filenames are unchanged; wasm64 pairs
live under `assets/wasm64/`. Relative URLs are preserved,
so the site also works under the `/ncnn-webgpu-test/` project prefix; no custom
COOP/COEP headers are needed by this threads-disabled build.

`actions/upload-pages-artifact` uploads this single site artifact and
`actions/deploy-pages` publishes it only after the build job succeeds. Test
reports and SDK/source provenance are uploaded as a separate non-site artifact.
Generated files are never committed or pushed to a `gh-pages` branch. A failed
test, missing SDK or incomplete site prevents deployment.

SDK-free staging/release-resolution fixtures and local staging can be run with:

```sh
python3 -m unittest discover -s tests -p test_pages.py -v
node tests/check-runtime-selection.mjs
node tests/check-worker-diagnostics.mjs
node tests/check-localization.mjs
npm ci --prefix tests/browser --ignore-scripts
node tests/browser/check-selection.mjs --chrome /path/to/chrome
node tests/browser/check-localization.mjs --chrome /path/to/chrome
python3 tools/stage-site.py --module-dir build-wasm32/assets \
  --wasm64-module-dir build-wasm64/assets --output _site
```

The SDK-free Chromium test uses real browser workers and the real Memory64
probe, but mock module factories. It covers all four module paths, a simulated
unsupported-memory64 browser, absent WebGPU, and initialization errors without
claiming application/GPU execution. CI runs it before SDK release resolution.

## Acceptance tests

```sh
npm ci --prefix tests/browser --ignore-scripts
for arch in wasm32 wasm64; do
    node tests/check-module-abi.mjs --expect-arch "$arch" "build-$arch"/assets/*-webgpu.mjs
    node tests/check-vkpeak-contract.mjs "build-$arch/assets/vkpeak-webgpu.mjs"
    cmake --build "build-$arch" --target vkpeak-capabilities --parallel 2
    node tests/check-vkpeak-capabilities.mjs "build-$arch/tests/vkpeak-capabilities.mjs"
    python3 tests/check-vkpeak-upstream-gates.py "build-$arch/upstream/vkpeak/vkpeak.cpp"
done
for backend in wasm wasm-simd; do
    CPU_BACKEND="$backend" BUILD_DIR="build-cpu-$backend" tools/build-cpu.sh
    node tests/check-module-abi.mjs --expect-arch wasm32 "build-cpu-$backend"/assets/*.mjs
done
python3 tests/check-cpu-features.py build-cpu-wasm/assets build-cpu-wasm-simd/assets
node tests/run-cpu-oracle.mjs build-cpu-wasm/assets build-cpu-wasm-simd/assets
node tests/check-benchmark-contract.mjs build-cpu-wasm/assets build-cpu-wasm-simd/assets
node tests/browser/run.mjs --chrome /path/to/chrome \
  --module-dir build-wasm32/assets --module64-dir build-wasm64/assets \
  --cpu-module-dir build-cpu-wasm/assets --simd-module-dir build-cpu-wasm-simd/assets \
  --expect-arch wasm64 --extra-demos
node tests/browser/run.mjs --chrome /path/to/chrome \
  --module-dir build-wasm32/assets --module64-dir build-wasm64/assets \
  --cpu-module-dir build-cpu-wasm/assets --simd-module-dir build-cpu-wasm-simd/assets \
  --expect-arch wasm32 --disable-memory64 --extra-demos
```

Run the ABI/contract checks for both build directories. The `--disable-memory64`
browser test simulates a failed capability probe in test-only worker instrumentation;
it executes the real wasm32 modules, without adding a production override. The
wasm64 pass uses the browser's real capability probe. Both assert the selected
architecture in worker responses.

The ABI smoke check instantiates the linked pair and validates its exported
functions, heap views and allocation helpers without requesting a GPU or running
benchmark main functions; it also checks SqueezeNet filesystem helpers. It does not prove browser or GPU inference.

The Node CPU check compares the freshly built scalar/SIMD wrappers with saved
numeric fixtures captured from the former CPU baseline using the real SqueezeNet
model. It checks both backend parity and historical top-3 results without
retaining generated binaries. It is not browser or GPU validation. The browser
check serves UI/worker sources locally and overlays only the explicitly selected
newly built CPU and WebGPU directories. Test-only instrumentation records actual
compute dispatches, adapter identity, uncaptured WebGPU errors and unexpected
device loss. A missing pair fails; no committed module can silently satisfy it.

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

## Thin SqueezeNet bridge

`src/squeezenet.cpp` is the browser ABI bridge for
[ncnn's SqueezeNet example](https://github.com/Tencent/ncnn/blob/cb65ca26ba955bf456f3a26e13e9a644769fc4a4/examples/squeezenet.cpp).
It calls ncnn's preprocessing, Net and Extractor APIs. The necessary adaptation
is persistent model state, RGBA input and the worker's existing `gpu_count`,
`gpu_name`, `init`, `infer`, `destroy` and 17-float result contract instead of an
OpenCV image-path CLI. The old CPU WASM
confirms direct bilinear resize to 227 x 227 (no crop), RGBA-to-BGR conversion,
means `(104,117,123)`, ten timed inferences and 1000 classes. The worker exposes
only top-3 `(class, score)` pairs plus ten times and their minimum. The generated
module retains malloc/free, ccall, HEAPU8/HEAPF32 and the two FS creation helpers.

## Upstream source adapters

The two benchmark translation units directly include ncnn's pinned
`benchmark/benchncnn.cpp` and `benchmark/benchncnn_llm.cpp`; vkpeak directly
includes the pinned project's `vkpeak.cpp`. Model catalogues, options, kernels,
calibration and scoring stay upstream rather than being copied into this repo.
The build copies only those named files into its own `upstream/` directory,
applies `patches/*.patch` with zero context fuzz, and leaves the original
checkouts unchanged. An input-content signature avoids regenerating unchanged
adapted files. Patch failure is a build error, not a fallback to local engines.

The ncnn patch adds worker single-model filtering, removes the Node-only mount,
propagates failures to the worker's exit contract and coordinates allocator
cleanup. It preserves the upstream model table, input shapes, options and
warmups. The vkpeak patch guards the CLI for library inclusion and bounds
browser buffers to 16 MiB plus dispatch/calibration limits; it preserves the
upstream kernels and throughput calculations. These upstream workloads are
not intended to reproduce the old generated vkpeak asset's timing values.
The `int8-dotprod` item uses the original saturating packed-dot
(`OpSDotAccSat`) kernels. SDK 20261027 or newer provides the required lowering;
its device `shaderIntegerDotProduct` feature controls eligibility. General
`shaderInt8` arithmetic and 8-bit buffer storage are not required for packed
32-bit operands. `int8-matrix` independently requires a matching signed-int8
input/int32 accumulator cooperative-matrix configuration; both the shim and
adapted upstream gate allow this dedicated path without general `shaderInt8`.
The SDK minimum is checked at configure time, because an older SDK's dot-product
feature alone does not guarantee the needed translator support. No shader or
throughput formula is substituted. A no-GPU diagnostic invokes the actual shim
with device-lookup stubs: dot and matrix remain eligible with `shaderInt8=false`,
while missing features or incompatible matrix types/scope are rejected before
device lookup. This checks eligibility, not hardware throughput.

## Benchmark and vkpeak contracts

`benchncnn-webgpu` and `benchncnn-llm-webgpu` retain the worker's automatic main,
`onExit`/`onAbort`, `noInitialRun` device enumeration and `model=NAME` selection.
Both use the pinned ncnn benchmark parameter graphs and synthetic zero weights,
not downloaded model weights. Unknown models must fail rather than run the
entire suite. Their wasm32 maximum memory remains 4 GiB, matching the previous modules;
wasm64 permits 8 GiB.
Optional CPU diagnostic modules retain distinct `*-reference` names; production
CPU builds use the normal `*-wasm` and `*-wasm-simd` names.

The focused CPU test checks a single blazeface iteration and CLI error handling;
it does not run the large LLM benchmark. Browser `--extra-demos` additionally
checks all three workers' adapter enumeration, runs one blazeface timing
iteration with actual compute dispatch, and checks vkpeak's 12 scenario names
and units. It does not run LLM model inference or the full vkpeak performance
suite. Neither ABI checks nor device enumeration establish numerical accuracy
or peak hardware performance. The vkpeak Node contract checks metadata, invalid
arguments and an upstream shader provenance marker, not execution. The preserved `copy-h2d`
and `copy-d2h` scenarios time mapped staging memcpy plus flush/invalidate, not
submitted GPU transfers; do not present them as physical device bandwidth.
The unchanged SqueezeNet parity test remains the
numerical baseline. All application modules are generated by the build; UI sources are copied unchanged.
