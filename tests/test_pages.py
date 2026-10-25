# Copyright 2026 Tencent
# SPDX-License-Identifier: BSD-3-Clause
"""SDK-free fixtures for the Pages allowlist and fail-closed release pin."""
from html.parser import HTMLParser
from pathlib import Path
import os
import shutil
import subprocess
import tempfile
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
                self.write(f"assets/{name}", "old GPU asset")
                self.write(f"build/assets/{name}", f"new:{name}")

    def write(self, name, value):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value)
        return path

    def test_complete_allowlist_and_new_gpu_pairs(self):
        for name in (".git/config", ".deps/nikki/lib/libnikki.a", "src/private.cpp", "tests/private.txt", "assets/unlisted.wasm"):
            self.write(name, "not for deployment")
        stage_site.stage(self.modules, self.output)
        actual = {p.relative_to(self.output).as_posix() for p in self.output.rglob("*") if p.is_file()}
        self.assertEqual(actual, self.expected)
        self.assertEqual(len(actual), 38)
        for name in actual:
            source = self.modules / Path(name).name if "-webgpu." in name else self.root / name
            self.assertEqual((self.output / name).read_bytes(), source.read_bytes())

    def test_each_missing_gpu_pair_member_fails_before_staging(self):
        for source in sorted(self.modules.iterdir()):
            with self.subTest(source=source.name):
                data = source.read_bytes()
                source.unlink()
                with self.assertRaisesRegex(ValueError, "runtime file"):
                    stage_site.stage(self.modules, self.output)
                self.assertFalse(self.output.exists())
                source.write_bytes(data)

    def test_missing_static_cpu_and_model_files_fail(self):
        for name in ("index.html", "backend-worker.mjs", "models/squeezenet_v1.1.bin", "assets/benchncnn-wasm-simd.wasm"):
            with self.subTest(name=name):
                source = self.root / name
                data = source.read_bytes()
                source.unlink()
                with self.assertRaises(ValueError):
                    stage_site.stage(self.modules, self.output)
                self.assertFalse(self.output.exists())
                source.write_bytes(data)

    def test_empty_and_symlink_inputs_fail(self):
        source = self.modules / "squeezenet-webgpu.wasm"
        source.write_bytes(b"")
        with self.assertRaises(ValueError):
            stage_site.stage(self.modules, self.output)
        source.unlink()
        source.symlink_to(self.root / "assets/squeezenet-webgpu.wasm")
        with self.assertRaises(ValueError):
            stage_site.stage(self.modules, self.output)
        self.assertFalse(self.output.exists())

    def test_old_gpu_directory_and_stale_output_fail(self):
        with self.assertRaisesRegex(ValueError, "newly built"):
            stage_site.stage(self.root / "assets", self.output)
        sentinel = self.write("_site/keep.txt", "keep")
        with self.assertRaisesRegex(ValueError, "already exists"):
            stage_site.stage(self.modules, self.output)
        self.assertEqual(sentinel.read_text(), "keep")

    def test_symlink_module_directory_fails(self):
        alias = self.root / "linked-assets"
        alias.symlink_to(self.modules, target_is_directory=True)
        with self.assertRaises(ValueError):
            stage_site.stage(alias, self.output)
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
