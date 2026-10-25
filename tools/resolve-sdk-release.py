#!/usr/bin/env python3
# Copyright 2026 Tencent
# SPDX-License-Identifier: BSD-3-Clause
"""Resolve one latest formal nikki release for both WebAssembly architectures."""
import argparse
import json
from pathlib import Path
import re
import sys
from urllib.request import Request, urlopen

API = "https://api.github.com/repos/nihui/nikki"


def get_json(path):
    request = Request(API + path, headers={"Accept": "application/vnd.github+json", "User-Agent": "ncnn-webgpu-test"})
    with urlopen(request, timeout=60) as response:
        return json.load(response)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def resolve_release(fetch=get_json):
    release = fetch("/releases/latest")
    require(isinstance(release, dict), "No latest nikki release")
    require(release.get("draft") is False and release.get("prerelease") is False and release.get("published_at"),
            "Latest nikki release must be published, non-draft and non-prerelease")
    version = release.get("tag_name", "")
    require(isinstance(version, str) and re.fullmatch(r"[0-9]{8}", version), "Expected a YYYYMMDD release tag")
    assets = {}
    for arch in ("wasm32", "wasm64"):
        name = f"nikki-{version}-{arch}-emscripten.tar.gz"
        matches = [asset for asset in release.get("assets", []) if asset.get("name") == name]
        require(len(matches) == 1, f"Missing or duplicate SDK asset: {name}")
        asset = matches[0]
        require(asset.get("state") == "uploaded" and isinstance(asset.get("size"), int) and asset["size"] > 0, f"SDK asset is not uploaded or is empty: {name}")
        digest = asset.get("digest", "")
        require(isinstance(digest, str) and re.fullmatch(r"sha256:[0-9a-f]{64}", digest), f"Missing SHA256 digest: {name}")
        expected_url = f"https://github.com/nihui/nikki/releases/download/{version}/{name}"
        require(asset.get("browser_download_url") == expected_url, f"Unexpected download URL: {name}")
        assets[arch] = {"name": name, "sha256": digest[7:], "url": expected_url}
    # target_commitish may be a branch; resolve the actual release tag instead
    ref = fetch(f"/git/ref/tags/{version}")
    require(ref.get("ref") == f"refs/tags/{version}", "Release tag ref mismatch")
    target = ref.get("object", {})
    for _ in range(8):
        sha = target.get("sha", "")
        require(isinstance(sha, str) and re.fullmatch(r"[0-9a-f]{40}", sha), "Invalid release tag SHA")
        if target.get("type") == "commit":
            return {"status": "pass", "release_id": release.get("id"), "version": version,
                    "revision": sha, "published_at": release["published_at"], "assets": assets}
        require(target.get("type") == "tag", "Release tag must point to a commit")
        target = fetch(f"/git/tags/{sha}").get("object", {})
    raise ValueError("Too many annotated release tags")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("test-results-sdk-resolution.json"))
    args = parser.parse_args()
    try:
        result = resolve_release()
    except Exception as error:
        result = {"status": "fail", "error": str(error)}
        args.output.write_text(json.dumps(result, indent=2) + "\n")
        print(f"SDK release resolution failed: {error}", file=sys.stderr)
        return 1
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(f'NIKKI_VERSION={result["version"]}')
    print(f'NIKKI_REVISION={result["revision"]}')
    for arch, asset in result["assets"].items():
        print(f'NIKKI_{arch.upper()}_SHA256={asset["sha256"]}')
    print(f'Resolved nikki {result["version"]} at {result["revision"]}', file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
