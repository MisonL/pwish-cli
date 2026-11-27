import assert from "node:assert/strict";
import test from "node:test";
import { safeName, timestamp } from "../src/filename.js";

test("timestamp 生成可跨平台的文件名片段", () => {
  const s = timestamp(new Date("2026-11-27T10:30:00.123Z"));
  assert.equal(s, "2026-11-27T10-30-00");
  assert.ok(!/[:.]/.test(s), "不能含冒号或点，Windows 会拒绝");
});

test("safeName 清掉路径分隔符，防止写出到目标目录之外", () => {
  assert.equal(safeName("../../etc/passwd"), "etc-passwd");
  assert.equal(safeName("a/b\\c"), "a-b-c");
  assert.equal(safeName("main"), "main");
});

test("safeName 处理 Windows 保留字符、控制字符与首尾点", () => {
  assert.equal(safeName('a:b*c?d"e<f>g|h'), "a-b-c-d-e-f-g-h");
  assert.equal(safeName("x\u0000y\u001fz"), "x-y-z");
  assert.equal(safeName("...hidden..."), "hidden");
  assert.equal(safeName("  spaced  "), "spaced");
});

test("safeName 空值与超长输入都有兜底", () => {
  assert.equal(safeName(""), "image");
  assert.equal(safeName(undefined), "image");
  assert.equal(safeName("../"), "image");
  assert.equal(safeName("x".repeat(200)).length, 80);
});

test("safeName 保留中文与常见符号", () => {
  assert.equal(safeName("白底主图"), "白底主图");
  assert.equal(safeName("main-v2 (1)"), "main-v2 (1)");
});
