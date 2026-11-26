import assert from "node:assert/strict";
import test from "node:test";
import { resolveBatchPrompts } from "../src/cli.js";

test("只有一条提示词时对所有图片复用", () => {
  assert.deepEqual(resolveBatchPrompts(3, { single: "白底商品图" }), ["白底商品图", "白底商品图", "白底商品图"]);
  assert.deepEqual(resolveBatchPrompts(2, { promptFileLines: ["统一风格"] }), ["统一风格", "统一风格"]);
});

test("提示词按行与图片一一对应", () => {
  assert.deepEqual(resolveBatchPrompts(2, { promptFileLines: ["A", "B"] }), ["A", "B"]);
});

test("提示词条数与图片数不一致时直接报错", () => {
  assert.throws(() => resolveBatchPrompts(2, { promptFileLines: ["A", "B", "C"] }), /数量必须一致/);
});

test("没有提示词时报错而不是静默空跑", () => {
  assert.throws(() => resolveBatchPrompts(2, {}), /缺少提示词/);
  assert.throws(() => resolveBatchPrompts(2, { single: "   " }), /缺少提示词/);
});
