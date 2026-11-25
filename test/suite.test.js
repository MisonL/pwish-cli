import test from "node:test";
import assert from "node:assert/strict";
import { suiteImagesOf } from "../src/suite.js";
import { imagesOf } from "../src/tasks.js";

const item = (id) => ({
  task_id: id,
  state: 1,
  answer: [{ file: `https://cdn/${id}.png`, thumbnail: `https://cdn/${id}-thumb.png`, file_id: `${id}-1` }],
});

test("suiteImagesOf 优先按 items 的键归场景", () => {
  const data = { items: { main: item("a"), selling: item("b") } };
  const out = suiteImagesOf(data);
  assert.deepEqual(Object.keys(out).sort(), ["main", "selling"]);
  assert.equal(out.main[0].url, "https://cdn/a.png");
  assert.equal(out.selling[0].url, "https://cdn/b.png");
});

test("suiteImagesOf 支持 scene 字段的旧结构", () => {
  const data = { answers: [{ scene: "core", answer: [{ file: "https://cdn/x.png" }] }] };
  const out = suiteImagesOf(data);
  assert.deepEqual(Object.keys(out), ["core"]);
});

test("suiteImagesOf 无结构时退化为 unknown", () => {
  const out = suiteImagesOf(item("z"));
  assert.deepEqual(Object.keys(out), ["unknown"]);
  assert.equal(out.unknown.length, 1);
});

test("imagesOf 过滤没有 URL 的条目并保留 fileId", () => {
  const imgs = imagesOf({ answer: [{ file: "https://cdn/1.png", file_id: "1" }, { thumbnail: "x" }, null] });
  assert.equal(imgs.length, 1);
  assert.equal(imgs[0].fileId, "1");
});

test("imagesOf 对非数组 answer 返回空", () => {
  assert.deepEqual(imagesOf({ answer: null }), []);
  assert.deepEqual(imagesOf({}), []);
});
