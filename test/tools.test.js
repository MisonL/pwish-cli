import assert from "node:assert/strict";
import test from "node:test";
import { convertFormat, resultUrls } from "../src/tools.js";

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
