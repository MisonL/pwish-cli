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

test("writeFileAtomic 先写临时文件再改名，不留半截文件", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { writeFileAtomic } = await import("../src/tasks.js");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-atomic-"));
  const target = path.join(dir, "x.png");
  try {
    writeFileAtomic(target, Buffer.from([1, 2, 3]));
    assert.deepEqual([...fs.readFileSync(target)], [1, 2, 3]);
    assert.deepEqual(fs.readdirSync(dir), ["x.png"], "不应残留 .part 文件");

    // 覆盖已有文件也走同一条路径
    writeFileAtomic(target, Buffer.from([9]));
    assert.deepEqual([...fs.readFileSync(target)], [9]);
    assert.deepEqual(fs.readdirSync(dir), ["x.png"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("writeFileAtomic 目标目录不可写时报错且不留下临时文件", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { writeFileAtomic } = await import("../src/tasks.js");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-atomic2-"));
  try {
    // 目标路径的父目录不存在 → 写入失败
    assert.throws(() => writeFileAtomic(path.join(dir, "missing", "x.png"), Buffer.from([1])));
    assert.deepEqual(fs.readdirSync(dir), [], "失败后不应残留文件");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
