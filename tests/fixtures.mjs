// Copyright 2026 Tencent
// SPDX-License-Identifier: BSD-3-Clause
export const cases = [["square", 227, 227, 1], ["non-square", 319, 173, 2], ["square-repeat", 227, 227, 1]];
export function pixels(width, height, seed) {
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4;
        data[index] = (x * 3 + y + seed * 31) % 256;
        data[index + 1] = (x + y * 5 + seed * 17) % 256;
        data[index + 2] = ((x ^ y) * 7 + seed * 43) % 256;
        data[index + 3] = (x + y * 3) % 256;
    }
    return data.buffer;
}
export function compareTop3(expected, actual, context) {
    for (let rank = 0; rank < 3; rank++) {
        const tolerance = 0.002 + 0.02 * Math.abs(expected[rank].score);
        if (actual[rank].index !== expected[rank].index || Math.abs(actual[rank].score - expected[rank].score) > tolerance)
            throw new Error(`${context} rank ${rank}: ${JSON.stringify(actual[rank])} != CPU ${JSON.stringify(expected[rank])} (tolerance ${tolerance})`);
    }
}
export function validateABI(result) {
    if (result.results.length !== 3 || result.timings.length !== 10) throw new Error("17-float ABI mismatch");
    for (const item of result.results) {
        if (!Number.isInteger(item.index) || item.index < 0 || item.index >= 1000 ||
            !Number.isFinite(item.score) || item.score < 0 || item.score > 1) throw new Error("invalid classification");
    }
    if (!Number.isFinite(result.fastestMs) || result.timings.some((t) => !Number.isFinite(t) || t < 0) ||
        Math.abs(Math.min(...result.timings) - result.fastestMs) > 0.001) throw new Error("invalid timings");
}
