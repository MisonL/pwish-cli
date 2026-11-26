import assert from "node:assert/strict";
import test from "node:test";
import { mimeOf, ossV1Signature } from "../src/upload.js";

test("mimeOf 按扩展名给 MIME，大小写不敏感", () => {
  assert.equal(mimeOf("a.jpg"), "image/jpeg");
  assert.equal(mimeOf("a.JPEG"), "image/jpeg");
  assert.equal(mimeOf("a.PNG"), "image/png");
  assert.equal(mimeOf("a.heic"), "image/heic");
  assert.equal(mimeOf("a.txt"), "application/octet-stream");
  assert.equal(mimeOf("no-ext"), "application/octet-stream");
});

test("ossV1Signature 对同名头做小写归一与字典序拼接", () => {
  const base = {
    verb: "PUT",
    mime: "image/png",
    date: "Thu, 26 Nov 2026 12:00:00 GMT",
    bucket: "b",
    key: "k.png",
    secret: "s",
  };
  const a = ossV1Signature({ ...base, ossHeaders: { "x-oss-date": "d", "x-oss-security-token": "t" } });
  const b = ossV1Signature({ ...base, ossHeaders: { "X-OSS-Security-Token": "t", "X-OSS-Date": "d" } });
  assert.equal(a, b);
});

test("ossV1Signature 头顺序变化不影响结果，内容变化会改变签过名", () => {
  const base = {
    verb: "PUT",
    mime: "image/jpeg",
    date: "d",
    bucket: "b",
    key: "k.jpg",
    secret: "s",
    ossHeaders: { "x-oss-date": "d" },
  };
  const one = ossV1Signature({ ...base, ossHeaders: { "x-oss-date": "d", "x-oss-callback": "c" } });
  const two = ossV1Signature({ ...base, ossHeaders: { "x-oss-callback": "c", "x-oss-date": "d" } });
  assert.equal(one, two);
  const changed = ossV1Signature({ ...base, ossHeaders: { "x-oss-date": "d", "x-oss-callback": "c2" } });
  assert.notEqual(one, changed);
});

test("ossV1Signature 支持空 body（contentMd5 默认空串）", () => {
  const sig = ossV1Signature({
    verb: "PUT",
    mime: "application/octet-stream",
    date: "d",
    bucket: "b",
    key: "k",
    secret: "s",
    ossHeaders: {},
  });
  assert.equal(typeof sig, "string");
  assert.ok(sig.length > 0);
});
