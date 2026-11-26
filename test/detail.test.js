import assert from "node:assert/strict";
import test from "node:test";
import { DETAIL_SCENES, detailImagesOf } from "../src/detail.js";

test("详情图场景表覆盖服务端返回的 7 个场景", () => {
  assert.deepEqual(Object.keys(DETAIL_SCENES).sort(), [
    "detail",
    "dimensions",
    "feature",
    "highlights",
    "lifestyle",
    "poster",
    "scenes",
  ]);
});

test("detailImagesOf 按场景抽出结果图（与套图同构）", () => {
  const raw = {
    items: {
      poster: { answer: [{ file: "https://cdn.example.com/poster-1.png" }] },
      feature: {
        answer: [
          { file: "https://cdn.example.com/feature-1.png" },
          { file: "https://cdn.example.com/feature-2.png" },
        ],
      },
      detail: { answer: [] },
    },
  };
  const out = detailImagesOf(raw);
  assert.deepEqual(Object.keys(out).sort(), ["feature", "poster"]);
  assert.equal(out.feature.length, 2);
  assert.equal(out.poster[0].url, "https://cdn.example.com/poster-1.png");
});

test("detailImagesOf 兼容没有 items 的平铺结果", () => {
  const out = detailImagesOf({ answer: [{ file: "https://cdn.example.com/a.png" }] });
  assert.deepEqual(Object.keys(out), ["unknown"]);
  assert.equal(out.unknown[0].url, "https://cdn.example.com/a.png");
});
