import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveModel,
  buildImageMessagePayload,
  dimensionFor,
  MODELS,
  SUITE_SITES,
  SUITE_SCENES,
} from "../src/models.js";

test("resolveModel 接受 key、别名与中文名", () => {
  assert.equal(resolveModel("gemini-3").id, 6);
  assert.equal(resolveModel("gpt2").id, 195);
  assert.equal(resolveModel("电商模型2.0").id, 72);
  assert.equal(resolveModel(undefined).key, "gemini-3");
  assert.throws(() => resolveModel("不存在"), /未知模型/);
});

test("模型 id 都是数字且不重复", () => {
  const ids = Object.values(MODELS).map((m) => m.id);
  assert.ok(ids.every((id) => Number.isInteger(id)));
  assert.equal(new Set(ids).size, ids.length);
});

test("dimensionFor 按比例与档位取像素", () => {
  assert.equal(dimensionFor("1:1", "2K"), "2048x2048");
  assert.equal(dimensionFor("1:1", "1K"), "1024x1024");
  assert.equal(dimensionFor("9:16", "2K"), "1152x2048");
  assert.equal(dimensionFor("未知比例", "2K"), "2048x2048");
});

test("nano 族 payload 带 pattern 与 quality，auto 时 size 为空", () => {
  const p = buildImageMessagePayload({
    prompt: "cat",
    conversationId: "c1",
    modelId: 6,
    family: "nano",
    ratio: "auto",
    sizeName: "2K",
    pattern: "economy",
  });
  assert.equal(p.prompt, "cat");
  assert.equal(p.conversation_id, "c1");
  assert.equal(p.model_type, 6);
  assert.equal(p.size, "");
  assert.equal(p.pattern, "economy");
  assert.equal(p.quality, "high");
  assert.equal(p.dimension, undefined);
});

test("gpt2 族带 dimension、resolution、background", () => {
  const p = buildImageMessagePayload({
    prompt: "cat",
    modelId: 195,
    family: "gpt2",
    ratio: "16:9",
    sizeName: "2K",
    format: "jpeg",
  });
  assert.equal(p.model_type, 195);
  assert.equal(p.size, "16:9");
  assert.equal(p.dimension, "2048x1152");
  assert.equal(p.resolution, "high");
  assert.equal(p.quality, "high");
  assert.equal(p.output_format, "jpeg");
  assert.equal(p.background, "auto");
});

test("gpt1 族把 high 映射为 high、standard 映射为 default", () => {
  const high = buildImageMessagePayload({ prompt: "x", modelId: 83, family: "gpt1", sizeName: "2K" });
  const low = buildImageMessagePayload({ prompt: "x", modelId: 83, family: "gpt1", sizeName: "1K" });
  assert.equal(high.quality, "high");
  assert.equal(low.quality, "default");
});

test("seedream 族带 quantity=-1", () => {
  const p = buildImageMessagePayload({ prompt: "x", modelId: 78, family: "seedream", ratio: "1:1", sizeName: "2K" });
  assert.equal(p.quantity, -1);
  assert.equal(p.size, "1:1");
});

test("files 只在有值时才出现", () => {
  const withFiles = buildImageMessagePayload({ prompt: "x", modelId: 6, family: "nano", files: ["r1"] });
  const without = buildImageMessagePayload({ prompt: "x", modelId: 6, family: "nano" });
  assert.deepEqual(withFiles.files, ["r1"]);
  assert.equal(without.files, undefined);
});

test("套图站点与场景表完整", () => {
  assert.ok(SUITE_SITES.amazon);
  assert.equal(SUITE_SITES.amazon.country, "US");
  assert.equal(SUITE_SITES.taobao.lang, "zh");
  for (const key of ["main", "core", "selling", "material", "person"]) {
    assert.ok(SUITE_SCENES[key], `缺少场景 ${key}`);
  }
});
