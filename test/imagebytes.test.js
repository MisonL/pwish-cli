import assert from "node:assert/strict";
import test from "node:test";
import { sniffImageExt, assertImageBytes } from "../src/imagebytes.js";

const fixtures = {
  ".png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0]),
  ".jpg": Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]),
  ".webp": Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
  ".gif": Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),
  ".bmp": Buffer.from([0x42, 0x4d, 0, 0, 0, 0]),
};

test("sniffImageExt 识别常见图片格式", () => {
  for (const [ext, buf] of Object.entries(fixtures)) {
    assert.equal(sniffImageExt(buf), ext);
  }
});

test("sniffImageExt 拒绝错误体与截断数据", () => {
  assert.equal(sniffImageExt(Buffer.from('<?xml version="1.0"?><Error><Code>AccessDenied</Code>')), null);
  assert.equal(sniffImageExt(Buffer.from('{"status":403,"message":"expired"}')), null);
  assert.equal(sniffImageExt(Buffer.from([0xff, 0xd8])), null);
  assert.equal(sniffImageExt(null), null);
});

test("assertImageBytes 抛出带诊断信息的错误", () => {
  const xml = Buffer.from('<?xml version="1.0"?><Error><Code>AccessDenied</Code></Error>');
  assert.throws(() => assertImageBytes(xml, "https://x.aliyuncs.com/a.png"), /下载结果不是图片.*AccessDenied/);
  assert.doesNotThrow(() => assertImageBytes(fixtures[".png"]));
});

test("WEBP 必须是 RIFF + WEBP 双标记", () => {
  const fake = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x4a, 0x50, 0x47, 0x00]);
  assert.equal(sniffImageExt(fake), null);
});
