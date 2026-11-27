import assert from "node:assert/strict";
import test from "node:test";
import { convertFormat, expansionForTarget, resultUrls, translateImage, restoreProduct } from "../src/tools.js";

test("resultUrls 只取正式结果，忽略预览图与蒙版", () => {
  const data = {
    task_id: "t1",
    state: 1,
    progress: 100,
    image: "https://cdn.example.com/out.png",
    small_image: "https://cdn.example.com/small.png",
    mask: "https://cdn.example.com/mask.png",
    accelerate_image: "",
  };
  assert.deepEqual(resultUrls(data), ["https://cdn.example.com/out.png"]);
});

test("resultUrls 支持换背景的多张候选图", () => {
  const data = {
    image_1: "https://cdn.example.com/1.jpg",
    image_2: "https://cdn.example.com/2.jpg",
    image_3: "",
    accelerate_image_1: "https://cdn.example.com/1-accel.jpg",
  };
  assert.deepEqual(resultUrls(data), ["https://cdn.example.com/1.jpg", "https://cdn.example.com/2.jpg"]);
});

test("resultUrls 支持对话式任务的 answer 结构", () => {
  const data = {
    answer: [
      [
        { file: "https://cdn.example.com/a.png", thumbnail: "https://cdn.example.com/a-thumb.png" },
        { file: "https://cdn.example.com/b.png" },
      ],
    ],
  };
  assert.deepEqual(resultUrls(data), ["https://cdn.example.com/a.png", "https://cdn.example.com/b.png"]);
});

test("resultUrls 对空结果返回空数组", () => {
  assert.deepEqual(resultUrls({}), []);
  assert.deepEqual(resultUrls(null), []);
  assert.deepEqual(resultUrls({ image: "", small_image: "https://cdn.example.com/small.png" }), []);
});

test("resultUrls 去重", () => {
  assert.deepEqual(resultUrls({ image: "https://cdn.example.com/x.png", url: "https://cdn.example.com/x.png" }), [
    "https://cdn.example.com/x.png",
  ]);
});

test("convertFormat 拒绝不支持的格式（不发起网络请求）", async () => {
  await assert.rejects(() => convertFormat({}, { file: "/tmp/x.png", format: "tiff" }), /不支持的格式/);
});

test("convertFormat 接受常见格式别名", async () => {
  // 只验证参数校验阶段：jpeg 会被归一成 jpg，随后才会因为缺少 client 失败
  await assert.rejects(() => convertFormat({}, { file: "/tmp/x.png", format: "jpeg" }), (err) => !/不支持的格式/.test(err.message));
});

test("resultUrls 支持扩图的 image1-4 结构，忽略原图占位", () => {
  const data = {
    state: 1,
    progress: 100,
    image1: "https://cdn.example.com/exp-1.png",
    image2: "https://cdn.example.com/exp-2.png",
    image3: "",
    ori_image1: "https://cdn.example.com/ori-1.png",
    accelerate_image1: "https://cdn.example.com/exp-1-accel.png",
  };
  assert.deepEqual(resultUrls(data), ["https://cdn.example.com/exp-1.png", "https://cdn.example.com/exp-2.png"]);
});

test("expansionForTarget 比原图宽时补左右", () => {
  const edges = expansionForTarget({ width: 512, height: 512, to: "16:9" });
  assert.equal(edges.top, 0);
  assert.equal(edges.bottom, 0);
  assert.ok(Math.abs(edges.left - (16 / 9 - 1) / 2) < 1e-9);
  assert.equal(edges.left, edges.right);
});

test("expansionForTarget 比原图高时补上下", () => {
  const edges = expansionForTarget({ width: 1600, height: 900, to: "9:16" });
  assert.equal(edges.left, 0);
  assert.equal(edges.right, 0);
  assert.ok(edges.top > 0);
  assert.equal(edges.top, edges.bottom);
});

test("expansionForTarget 已是目标比例时四边为 0", () => {
  const edges = expansionForTarget({ width: 1920, height: 1080, to: "16:9" });
  assert.deepEqual(edges, { left: 0, right: 0, top: 0, bottom: 0 });
});

test("expansionForTarget 拒绝未知画幅", () => {
  assert.throws(() => expansionForTarget({ width: 10, height: 10, to: "21:9" }), /不支持的目标画幅/);
});

test("translateImage 拒绝不支持的语言（不发起网络请求）", async () => {
  const client = { request: () => assert.fail("不应发起请求") };
  await assert.rejects(() => translateImage(client, { file: "x.png", to: "XXX" }), /不支持的目标语言|不支持的--to语言/);
});

test("translateImage 拒绝源语言与目标语言相同", async () => {
  const client = { request: () => assert.fail("不应发起请求") };
  await assert.rejects(() => translateImage(client, { file: "x.png", from: "ENG", to: "ENG" }), /相同/);
});

test("translateImage 本地拦截 auto 源语言（服务端会 task failed）", async () => {
  const client = { request: () => assert.fail("不应发起请求") };
  await assert.rejects(() => translateImage(client, { file: "x.png", from: "auto", to: "ENG" }), /不支持自动识别/);
});

test("restoreProduct 要求正好 2 张源图（服务端限制）", async () => {
  const client = { request: () => assert.fail("不应发起请求") };
  await assert.rejects(() => restoreProduct(client, { images: ["a.png"] }), /正好 2 张/);
  await assert.rejects(() => restoreProduct(client, { images: ["a.png", "b.png", "c.png"] }), /正好 2 张/);
  await assert.rejects(() => restoreProduct(client, { images: [] }), /正好 2 张/);
});
