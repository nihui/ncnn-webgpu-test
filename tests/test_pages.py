# Copyright 2026 Tencent
# SPDX-License-Identifier: BSD-3-Clause
"""SDK-free fixtures for the Pages allowlist and fail-closed release resolution."""
from html.parser import HTMLParser
from pathlib import Path
import os
import copy
import hashlib
import io
import contextlib
import sys
from unittest.mock import patch
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

    def download(self, requested, packaged, bad_digest=False):
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
                                "NIKKI_VERSION": "20000101", "NIKKI_REVISION": "a" * 40,
                                f"NIKKI_{requested.upper()}_SHA256": "0" * 64 if bad_digest else hashlib.sha256(archive.read_bytes()).hexdigest()})
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

    def test_archive_digest_mismatch_rejected_before_extraction(self):
        result, destination = self.download("wasm64", "wasm64", bad_digest=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("SDK archive SHA256 mismatch", result.stderr)
        self.assertFalse(destination.exists())

    def test_invalid_architecture_rejected_before_download(self):
        result, destination = self.download("native", "native")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("WASM_ARCH must be", result.stderr)
        self.assertFalse(destination.exists())


resolver = types.ModuleType("resolver")
resolver.__file__ = str(ROOT / "tools/resolve-sdk-release.py")
exec(compile(Path(resolver.__file__).read_text(), resolver.__file__, "exec"), resolver.__dict__)


class SdkReleaseTests(unittest.TestCase):
    def setUp(self):
        self.release = {"id": 123, "tag_name": "20000101", "draft": False, "prerelease": False,
                        "published_at": "2000-01-01T00:00:00Z", "target_commitish": "wrong-branch", "assets": []}
        for arch in ("wasm32", "wasm64"):
            name = f"nikki-20000101-{arch}-emscripten.tar.gz"
            self.release["assets"].append({"name": name, "digest": "sha256:" + "b" * 64,
                "state": "uploaded", "size": 123,
                "browser_download_url": f"https://github.com/nihui/nikki/releases/download/20000101/{name}"})
        self.ref = {"ref": "refs/tags/20000101", "object": {"type": "commit", "sha": "a" * 40}}
        self.calls = []

    def fetch(self, path):
        self.calls.append(path)
        if path == "/releases/latest":
            return copy.deepcopy(self.release)
        if path == "/git/ref/tags/20000101":
            return copy.deepcopy(self.ref)
        if path == "/git/tags/" + "c" * 40:
            return {"object": {"type": "commit", "sha": "a" * 40}}
        raise RuntimeError("Unexpected API call: " + path)

    def test_latest_resolved_once_for_both_architectures(self):
        result = resolver.resolve_release(self.fetch)
        self.assertEqual(result["revision"], "a" * 40)
        self.assertEqual(result["version"], "20000101")
        self.assertEqual(set(result["assets"]), {"wasm32", "wasm64"})
        self.assertEqual(self.calls, ["/releases/latest", "/git/ref/tags/20000101"])

    def test_annotated_tag_resolves_actual_commit(self):
        self.ref["object"] = {"type": "tag", "sha": "c" * 40}
        result = resolver.resolve_release(self.fetch)
        self.assertEqual(result["revision"], "a" * 40)
        self.assertEqual(self.calls.count("/releases/latest"), 1)

    def test_no_release_or_api_failure_has_no_fallback(self):
        def fail(path):
            self.calls.append(path)
            raise RuntimeError("HTTP 404: no release")
        with self.assertRaisesRegex(RuntimeError, "no release"):
            resolver.resolve_release(fail)
        self.assertEqual(self.calls, ["/releases/latest"])

    def test_draft_prerelease_unpublished_and_bad_tag_rejected(self):
        for key, value in (("draft", True), ("prerelease", True), ("published_at", None), ("tag_name", "main")):
            with self.subTest(key=key):
                original = self.release[key]
                self.release[key] = value
                with self.assertRaises(ValueError):
                    resolver.resolve_release(self.fetch)
                self.release[key] = original

    def test_missing_duplicate_or_invalid_assets_rejected(self):
        good = copy.deepcopy(self.release["assets"])
        for assets in (good[:1], good[1:], good + [good[0]]):
            self.release["assets"] = assets
            with self.assertRaisesRegex(ValueError, "Missing or duplicate"):
                resolver.resolve_release(self.fetch)
        for key, value in (("digest", None), ("digest", "sha256:no"), ("state", "new"), ("size", 0),
                           ("browser_download_url", "https://example.invalid/sdk.tar.gz")):
            with self.subTest(key=key, value=value):
                self.release["assets"] = copy.deepcopy(good)
                self.release["assets"][0][key] = value
                with self.assertRaises(ValueError):
                    resolver.resolve_release(self.fetch)

    def test_failed_resolution_overwrites_provenance_and_emits_no_environment(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "resolution.json"
            output.write_text('{"status": "pass", "version": "stale"}')
            stdout = io.StringIO()
            stderr = io.StringIO()
            with patch.object(sys, "argv", ["resolve-sdk-release.py", "--output", str(output)]), \
                 patch.object(resolver, "resolve_release", side_effect=RuntimeError("HTTP 403: rate limited")), \
                 contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                self.assertEqual(resolver.main(), 1)
            self.assertEqual(stdout.getvalue(), "")
            self.assertEqual(resolver.json.loads(output.read_text()), {"status": "fail", "error": "HTTP 403: rate limited"})
            self.assertIn("rate limited", stderr.getvalue())

    def test_tag_mismatch_and_noncommit_rejected(self):
        for ref in ({"ref": "refs/tags/wrong", "object": {"type": "commit", "sha": "a" * 40}},
                    {"ref": "refs/tags/20000101", "object": {"type": "tree", "sha": "a" * 40}},
                    {"ref": "refs/tags/20000101", "object": {"type": "commit", "sha": "main"}}):
            self.ref = ref
            with self.assertRaises(ValueError):
                resolver.resolve_release(self.fetch)


if __name__ == "__main__":
    unittest.main()
