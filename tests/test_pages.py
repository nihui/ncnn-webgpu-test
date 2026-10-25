# Copyright 2026 Tencent
# SPDX-License-Identifier: BSD-3-Clause
"""SDK-free fixtures for the Pages allowlist and fail-closed release pin."""
from html.parser import HTMLParser
from pathlib import Path
import os
import shutil
import subprocess
import tempfile
import tarfile
import types
import unittest
from urllib.parse import urljoin, urlsplit

ROOT = Path(__file__).resolve().parents[1]
stage_site = types.ModuleType("stage_site")
stage_site.__file__ = str(ROOT / "tools/stage-site.py")
exec(compile(Path(stage_site.__file__).read_text(), stage_site.__file__, "exec"), stage_site.__dict__)


class PagesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.modules = self.root / "build/assets"
        self.modules64 = self.root / "build-wasm64/assets"
        self.output = self.root / "_site"
        stage_site.ROOT = self.root
        self.expected = set(stage_site.STATIC_FILES)
        for name in stage_site.STATIC_FILES:
            self.write(name, f"static:{name}")
        for module in ("squeezenet", "benchncnn", "benchncnn-llm"):
            for backend in ("wasm", "wasm-simd"):
                for suffix in ("mjs", "wasm"):
                    name = f"assets/{module}-{backend}.{suffix}"
                    self.expected.add(name)
                    self.write(name, f"cpu:{name}")
        for module in ("squeezenet", "benchncnn", "benchncnn-llm", "vkpeak"):
            for suffix in ("mjs", "wasm"):
                name = f"{module}-webgpu.{suffix}"
                self.expected.add(f"assets/{name}")
                self.expected.add(f"assets/wasm64/{name}")
                self.write(f"assets/{name}", "old GPU asset")
                self.write(f"build/assets/{name}", f"new:{name}")
                self.write(f"build-wasm64/assets/{name}", f"new64:{name}")

    def write(self, name, value):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value)
        return path

    def test_complete_allowlist_and_new_gpu_pairs(self):
        for name in (".git/config", ".deps/nikki/lib/libnikki.a", "src/private.cpp", "tests/private.txt", "assets/unlisted.wasm"):
            self.write(name, "not for deployment")
        stage_site.stage(self.modules, self.modules64, self.output)
        actual = {p.relative_to(self.output).as_posix() for p in self.output.rglob("*") if p.is_file()}
        self.assertEqual(actual, self.expected)
        self.assertEqual(len(actual), 47)
        for name in actual:
            source = (self.modules64 if "/wasm64/" in name else self.modules) / Path(name).name if "-webgpu." in name else self.root / name
            self.assertEqual((self.output / name).read_bytes(), source.read_bytes())

    def test_each_missing_gpu_pair_member_fails_before_staging(self):
        for source in sorted([*self.modules.iterdir(), *self.modules64.iterdir()]):
            with self.subTest(source=source.name):
                data = source.read_bytes()
                source.unlink()
                with self.assertRaisesRegex(ValueError, "runtime file"):
                    stage_site.stage(self.modules, self.modules64, self.output)
                self.assertFalse(self.output.exists())
                source.write_bytes(data)

    def test_missing_static_cpu_and_model_files_fail(self):
        for name in ("index.html", "backend-worker.mjs", "models/squeezenet_v1.1.bin", "assets/benchncnn-wasm-simd.wasm"):
            with self.subTest(name=name):
                source = self.root / name
                data = source.read_bytes()
                source.unlink()
                with self.assertRaises(ValueError):
                    stage_site.stage(self.modules, self.modules64, self.output)
                self.assertFalse(self.output.exists())
                source.write_bytes(data)

    def test_empty_and_symlink_inputs_fail(self):
        source = self.modules / "squeezenet-webgpu.wasm"
        source.write_bytes(b"")
        with self.assertRaises(ValueError):
            stage_site.stage(self.modules, self.modules64, self.output)
        source.unlink()
        source.symlink_to(self.root / "assets/squeezenet-webgpu.wasm")
        with self.assertRaises(ValueError):
            stage_site.stage(self.modules, self.modules64, self.output)
        self.assertFalse(self.output.exists())

    def test_old_gpu_directory_and_stale_output_fail(self):
        with self.assertRaisesRegex(ValueError, "newly built"):
            stage_site.stage(self.root / "assets", self.modules64, self.output)
        sentinel = self.write("_site/keep.txt", "keep")
        with self.assertRaisesRegex(ValueError, "already exists"):
            stage_site.stage(self.modules, self.modules64, self.output)
        self.assertEqual(sentinel.read_text(), "keep")

    def test_symlink_module_directory_fails(self):
        alias = self.root / "linked-assets"
        alias.symlink_to(self.modules, target_is_directory=True)
        with self.assertRaises(ValueError):
            stage_site.stage(alias, self.modules64, self.output)
        self.assertFalse(self.output.exists())

    def test_identical_architecture_directories_fail(self):
        with self.assertRaisesRegex(ValueError, "separate"):
            stage_site.stage(self.modules, self.modules, self.output)
        self.assertFalse(self.output.exists())

    def test_wasm64_committed_directory_fails(self):
        with self.assertRaisesRegex(ValueError, "newly built"):
            stage_site.stage(self.modules, self.root / "assets/wasm64", self.output)
        self.assertFalse(self.output.exists())

    def test_existing_html_links_keep_project_prefix(self):
        class Links(HTMLParser):
            def handle_starttag(self, tag, attrs):
                for key, value in attrs:
                    if key in ("href", "src") and value:
                        links.append(value)
        base = "https://example.invalid/ncnn-webgpu-test/"
        for name in ("index.html", "benchncnn.html", "benchncnn_llm.html", "vkpeak.html"):
            links = []
            Links().feed((ROOT / name).read_text())
            for link in links:
                if urlsplit(link).scheme or link.startswith("#"):
                    continue
                target = urlsplit(urljoin(base + name, link)).path
                self.assertTrue(target.startswith("/ncnn-webgpu-test/"), link)
                self.assertIn(target.removeprefix("/ncnn-webgpu-test/"), self.expected)


class SdkArchitectureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        curl = self.bin / "curl"
        curl.write_text('#!/usr/bin/env bash\nwhile [[ "$1" != --output ]]; do shift; done\ncp "$FIXTURE_ARCHIVE" "$2"\n')
        curl.chmod(0o755)

    def download(self, requested, packaged):
        package = self.root / f"nikki-20000101-{requested}-emscripten"
        package.mkdir(exist_ok=True)
        for name, value in {"release-version": "20000101", "source-revision": "a" * 40,
                            "emsdk-version": "6.0.12", "architecture": packaged}.items():
            (package / f"{name}.txt").write_text(value + "\n")
        (package / "lib/cmake/nikki").mkdir(parents=True, exist_ok=True)
        (package / "lib/cmake/nikki/nikkiConfig.cmake").write_text("# fixture\n")
        archive = self.root / "fixture.tar.gz"
        with tarfile.open(archive, "w:gz") as output:
            output.add(package, arcname=package.name)
        destination = self.root / "downloaded"
        result = subprocess.run(["bash", str(ROOT / "tools/download-nikki.sh"), str(destination)],
                                text=True, capture_output=True, env={**os.environ,
                                "PATH": str(self.bin) + os.pathsep + os.environ["PATH"],
                                "FIXTURE_ARCHIVE": str(archive), "WASM_ARCH": requested,
                                "NIKKI_VERSION": "20000101", "NIKKI_REVISION": "a" * 40})
        return result, destination

    def test_build_selects_matching_flags_and_rejects_wrong_sdk(self):
        for name, script in {
            "git": '#!/usr/bin/env bash\nif [[ "$3" == rev-parse ]]; then\n case "$2" in *ncnn) echo cb65ca26ba955bf456f3a26e13e9a644769fc4a4 ;; *) echo f37dab4c421781bf047face221dbaf6ae112a5e7 ;; esac\nfi\n',
            "emcmake": '#!/usr/bin/env bash\nprintf "%s\\n" "$@" > "$CAPTURE_FLAGS"\n',
            "cmake": '#!/usr/bin/env bash\nexit 0\n',
        }.items():
            command = self.bin / name
            command.write_text(script)
            command.chmod(0o755)
        for name in ("ncnn", "vkpeak"):
            (self.root / name).mkdir()
        for arch in ("wasm32", "wasm64"):
            result, sdk = self.download(arch, arch)
            self.assertEqual(result.returncode, 0, result.stderr)
            captured = self.root / "flags"
            env = {**os.environ, "PATH": str(self.bin) + os.pathsep + os.environ["PATH"],
                   "NIKKI_PREFIX": str(sdk), "NIKKI_REVISION": "a" * 40, "WASM_ARCH": arch,
                   "NCNN_SOURCE_DIR": str(self.root / "ncnn"), "VKPEAK_SOURCE_DIR": str(self.root / "vkpeak"),
                   "CAPTURE_FLAGS": str(captured)}
            result = subprocess.run(["bash", str(ROOT / "tools/build-webgpu.sh")], text=True, capture_output=True, env=env)
            self.assertEqual(result.returncode, 0, result.stderr)
            flags = captured.read_text().splitlines()
            expected = "-m64" if arch == "wasm64" else ""
            for name in ("CMAKE_C_FLAGS", "CMAKE_CXX_FLAGS", "CMAKE_EXE_LINKER_FLAGS"):
                self.assertIn(f"-D{name}={expected}", flags)
            self.assertIn(f"-DNCNN_WEBGPU_WASM_ARCH={arch}", flags)
            self.assertIn(str(ROOT / ("build-wasm64" if arch == "wasm64" else "build")), flags)
            captured.unlink()
            env["WASM_ARCH"] = "wasm32" if arch == "wasm64" else "wasm64"
            result = subprocess.run(["bash", str(ROOT / "tools/build-webgpu.sh")], text=True, capture_output=True, env=env)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("nikki architecture mismatch", result.stderr)
            self.assertFalse(captured.exists())
            shutil.rmtree(sdk)

    def test_download_both_architectures(self):
        for arch in ("wasm32", "wasm64"):
            with self.subTest(arch=arch):
                result, destination = self.download(arch, arch)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual((destination / "architecture.txt").read_text().strip(), arch)
                shutil.rmtree(destination)

    def test_mislabeled_package_rejected(self):
        for requested, packaged in (("wasm32", "wasm64"), ("wasm64", "wasm32")):
            with self.subTest(requested=requested):
                result, destination = self.download(requested, packaged)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("Package architecture mismatch", result.stderr)
                self.assertFalse(destination.exists())

    def test_invalid_architecture_rejected_before_download(self):
        result, destination = self.download("native", "native")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("WASM_ARCH must be", result.stderr)
        self.assertFalse(destination.exists())


class SdkPinTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "tools").mkdir()
        (self.root / "config").mkdir()
        self.script = self.root / "tools/read-sdk-pin.sh"
        shutil.copyfile(ROOT / "tools/read-sdk-pin.sh", self.script)

    def read_pin(self, version, revision):
        (self.root / "config/nikki-sdk.env").write_text(f"NIKKI_VERSION='{version}'\nNIKKI_REVISION='{revision}'\n")
        return subprocess.run(["bash", str(self.script)], text=True, capture_output=True,
                              env={**os.environ, "NIKKI_VERSION": "19990101", "NIKKI_REVISION": "b" * 40})

    def test_unconfigured_and_invalid_pins_block(self):
        for version, revision in (("", ""), ("latest", "a" * 40), ("20000101", "abc")):
            result = self.read_pin(version, revision)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(result.stdout, "")
            self.assertIn("build and deployment are blocked", result.stderr)

    def test_repo_pin_not_environment_override(self):
        # Synthetic fixture only: no download or claim that this release exists.
        result = self.read_pin("20000101", "a" * 40)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "NIKKI_VERSION=20000101\nNIKKI_REVISION=" + "a" * 40 + "\n")

    def test_missing_key_cannot_inherit_environment_pin(self):
        (self.root / "config/nikki-sdk.env").write_text("NIKKI_VERSION=20000101\n")
        result = subprocess.run(["bash", str(self.script)], text=True, capture_output=True,
                                env={**os.environ, "NIKKI_REVISION": "b" * 40})
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")
        self.assertIn("build and deployment are blocked", result.stderr)


if __name__ == "__main__":
    unittest.main()
