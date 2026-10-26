// Copyright 2026 Tencent
// SPDX-License-Identifier: BSD-3-Clause
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
let serial = 0;
async function load(navigator) {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: navigator });
    return import(`../i18n.mjs?test=${serial++}`);
}
try {
    const english = await load({ languages: ["en-US", "zh-CN"], language: "zh-CN" });
    const chinese = await load({ languages: ["zh-TW", "en-US"], language: "en-US" });
    assert.equal(english.language, "en");
    assert.equal(chinese.language, "zh");
    for (const [preferences, expected] of [
        [[], "en"], [["fr-FR"], "en"], [["en-GB", "zh"], "en"], [["zh-Hant", "en"], "zh"],
        [["fr", "zh-CN", "en"], "zh"], [["fr", "en", "zh-CN"], "en"],
        [["ZH_cn"], "zh"], [["english", "zhang"], "en"],
    ]) assert.equal(english.selectLanguage(preferences), expected, JSON.stringify(preferences));
    assert.equal((await load({ languages: [], language: "zh-CN" })).language, "zh");
    assert.equal((await load({ language: "en-GB" })).language, "en");
    assert.equal((await load(undefined)).language, "en");

    const keys = new Set();
    for (const filename of ["index.html", "benchncnn.html", "benchncnn_llm.html", "vkpeak.html", "app.js", "benchncnn.js", "benchncnn_llm.js", "vkpeak.js"]) {
        const source = await readFile(new URL(`../${filename}`, import.meta.url), "utf8");
        for (const match of source.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"|\bt\("([^"]+)"/g)) keys.add(match[1] || match[2]);
    }
    assert.ok(keys.size > 40, "cover static and dynamic message keys across all pages");
    for (const key of keys) {
        for (const module of [english, chinese]) {
            const text = module.t(key);
            assert.notEqual(text, key, `missing ${module.language} message: ${key}`);
            assert.ok(text.length > 0, `empty ${module.language} message: ${key}`);
            const values = Object.fromEntries([...text.matchAll(/\{([a-zA-Z]+)\}/g)].map(match => [match[1], "fixture-123"]));
            assert.doesNotMatch(module.t(key, values), /\{[a-zA-Z]+\}/, `unresolved interpolation: ${key}`);
        }
        assert.doesNotMatch(english.t(key), /[\u3400-\u9fff]/, `Chinese in English message: ${key}`);
    }
    assert.equal(english.t("backendFailed", { backend: "WASM", error: "fixture failure marker" }).includes("fixture failure marker"), true);
    console.log(JSON.stringify({ status: "pass", languages: ["en", "zh"], messageKeys: keys.size }));
} finally {
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete globalThis.navigator;
}
