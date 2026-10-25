# ncnn WebGPU demo

The checked-in UI, workers, models and CPU assets remain the demo baseline.
The reproducible build produces the SqueezeNet, benchncnn, benchncnn_llm and
vkpeak WebGPU application pairs. It does not build nikki from source or update
the committed assets. CI stages the tested site for GitHub Pages separately.

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
`nikki::static`. Its port may download the pinned Emdawn runtime on first link.

There is not yet a released SDK to pin as a default. Once the producer's release
is explicitly approved and published, select its fixed **YYYYMMDD tag and full
source commit**. Do not use a floating "latest" download. The download checks
the package version, source and toolchain without a cross-repository token.
A missing or unpublished release fails clearly, never falling back to source.

```sh
source /path/to/emsdk/emsdk_env.sh
export NIKKI_VERSION=<published-YYYYMMDD-tag>
export NIKKI_REVISION=<full-producer-commit>
tools/download-nikki.sh .deps/nikki
export NIKKI_PREFIX="$PWD/.deps/nikki"
tools/build-webgpu.sh
```

For an already downloaded SDK, omit the download step and set `NIKKI_PREFIX`
and `NIKKI_REVISION`. `NCNN_SOURCE_DIR`, `VKPEAK_SOURCE_DIR`, `BUILD_DIR` and
`JOBS` may be overridden;
existing ncnn checkouts must be clean at the pinned commit. Final-link optimizer
concurrency defaults to `BINARYEN_CORES=1` to bound memory use; this does not lower
optimization or disable Asyncify. The script serializes the four final links.
Outputs are `build/assets/{squeezenet,benchncnn,benchncnn-llm,vkpeak}-webgpu.mjs`
and matching `.wasm` files. Always keep each pair together.
`tools/build-squeezenet.sh` retains the minimal SqueezeNet-only entry point;
`tools/build-webgpu.sh benchncnn-webgpu` builds just the named target.
A missing/incomplete SDK is an error, never a request to silently rebuild nikki.
Use a fresh build directory and an SDK rebuilt with emsdk 6.0.12 when upgrading
from an older toolchain; do not reuse old object files or static archives.

## CI and GitHub Pages

`.github/workflows/webgpu-pages.yml` builds and tests pull requests, pushes to
`master`, and manual runs. Only a successful `master` push or manual run in
`nihui/ncnn-webgpu-test` can enter the separate Pages deployment job. PRs and
manual runs on other branches cannot deploy. The build token has only
`contents: read`, and checkout does not persist credentials; only the deployment
job receives `pages: write` and `id-token: write`. Deployments use the
`github-pages` environment and a non-cancelling deployment concurrency group.

Two prerequisites remain before the first real build/deployment:

1. Publish the producer SDK separately, then commit its real release date and
   source SHA in `config/nikki-sdk.env`. Both values are intentionally empty
   until a release exists. CI fails at this gate rather than skipping the build
   or publishing old assets. Manual runs use the same reviewed pin, with no
   version override.
2. Confirm the repository's **Settings → Pages → Source** is **GitHub Actions**.
   This change has not inspected or changed the current Pages setting. The
   workflow does not enable Pages or modify its settings automatically.

After all ABI, CPU and browser checks pass, `tools/stage-site.py` creates a fresh
`_site` containing only the existing HTML/JS/CSS/workers, the three SqueezeNet
model files, all scalar/SIMD CPU pairs, and all four newly built WebGPU pairs.
It rejects missing or empty runtime files, linked files, existing output and the
committed GPU directory as input. It does not copy `.git`, `.deps`, source,
tests, SDK files or build reports. Relative URLs and filenames are unchanged,
so the site also works under the `/ncnn-webgpu-test/` project prefix; no custom
COOP/COEP headers are needed by this threads-disabled build.

`actions/upload-pages-artifact` uploads this single site artifact and
`actions/deploy-pages` publishes it only after the build job succeeds. Test
reports and SDK/source provenance are uploaded as a separate non-site artifact.
Generated files are never committed or pushed to a `gh-pages` branch. A failed
test, missing SDK or incomplete site prevents deployment.

SDK-free staging/pin fixtures and local staging can be run with:

```sh
python3 -m unittest discover -s tests -p test_pages.py -v
python3 tools/stage-site.py --module-dir build/assets --output _site
```

## Acceptance tests

```sh
npm ci --prefix tests/browser --ignore-scripts
node tests/check-module-abi.mjs build/assets/*-webgpu.mjs
node tests/check-vkpeak-contract.mjs build/assets/vkpeak-webgpu.mjs
cmake --build build --target vkpeak-capabilities --parallel 2
node tests/check-vkpeak-capabilities.mjs build/tests/vkpeak-capabilities.mjs
emcmake cmake -S . -B build-cpu-reference -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DSQUEEZENET_CPU_ORACLE=ON -DNCNN_WEBGPU_EXTRA_DEMOS=ON \
  -DNCNN_SOURCE_DIR="$PWD/.deps/ncnn"
cmake --build build-cpu-reference --parallel 2
node tests/run-cpu-oracle.mjs build-cpu-reference/assets/squeezenet-reference.mjs
node tests/check-benchmark-contract.mjs build-cpu-reference/assets
node tests/browser/run.mjs --chrome /path/to/chrome --module-dir build/assets --extra-demos
```

The ABI smoke check instantiates the linked pair and validates its exported
functions, heap views and allocation helpers without requesting a GPU or running
benchmark main functions; it also checks SqueezeNet filesystem helpers. It does not prove browser or GPU inference.

The Node CPU check compares the reconstructed CPU wrapper with the untouched scalar
and SIMD CPU modules using the actual committed SqueezeNet model. The explicit
`SQUEEZENET_CPU_ORACLE=ON` diagnostic build is separate, never a missing-SDK
fallback and never overwrites either CPU asset. Omitting the module argument
checks only the old CPU modules, not the reconstructed wrapper. It is not browser
or GPU validation. The browser check serves the original worker/UI assets locally and overlays only the newly
built WebGPU pairs. Test-only instrumentation records actual compute dispatches,
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
The `int8-dotprod` item stays in the 12-scenario list but is explicitly
unsupported: its upstream single/dual kernels require saturating packed dot
(`OpSDotAccSat`), which the current nikki SDK rejects. A device dot-product
feature flag alone does not establish support. The original kernels are not
silently changed to non-saturating arithmetic; `int8-matrix` keeps its separate
cooperative-matrix capability check. A separate no-GPU diagnostic invokes the
actual shim with device-lookup stubs and advertised dot/matrix features: dot is
rejected before any device/kernel call, while matrix remains eligible.

## Benchmark and vkpeak contracts

`benchncnn-webgpu` and `benchncnn-llm-webgpu` retain the worker's automatic main,
`onExit`/`onAbort`, `noInitialRun` device enumeration and `model=NAME` selection.
Both use the pinned ncnn benchmark parameter graphs and synthetic zero weights,
not downloaded model weights. Unknown models must fail rather than run the
entire suite. Their maximum memory is 4 GiB, matching the committed modules.
CPU diagnostic modules use distinct `*-reference` names and never replace the
committed CPU assets.

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
numerical baseline. No existing CPU module or UI is regenerated by this build.
