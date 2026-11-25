import test from "node:test";
import assert from "node:assert/strict";
import { decodeVarint, snappyDecompress } from "../src/browser-token.js";

test("decodeVarint 解析单字节与多字节", () => {
  assert.deepEqual(decodeVarint(Buffer.from([0x00])), { value: 0, next: 1 });
  assert.deepEqual(decodeVarint(Buffer.from([0x7f])), { value: 127, next: 1 });
  assert.deepEqual(decodeVarint(Buffer.from([0x80, 0x01])), { value: 128, next: 2 });
  assert.deepEqual(decodeVarint(Buffer.from([0xac, 0x02])), { value: 300, next: 2 });
});

test("decodeVarint 对不完整输入抛错", () => {
  assert.throws(() => decodeVarint(Buffer.from([0x80])), /varint 溢出/);
});

test("snappyDecompress 还原纯 literal 块", () => {
  // 长度 5 + 单个 literal（tag=0x10 表示长度 1 的 4 字节... 用 (len-1)<<2 = 0x10 → len 5）
  const payload = Buffer.from("hello");
  const stream = Buffer.concat([Buffer.from([0x05]), Buffer.from([(payload.length - 1) << 2]), payload]);
  assert.equal(snappyDecompress(stream).toString(), "hello");
});

test("snappyDecompress 还原带 backref 的块", () => {
  // "ababab": 先 literal "ab"，再用 type=1 backref 复制 4 个字节（offset 2）
  const stream = Buffer.concat([
    Buffer.from([0x06]), // 解压后长度 6
    Buffer.from([0x04]), // literal, len = (4>>2)+1 = 2
    Buffer.from("ab"),
    // type=1: len = 4 + ((tag>>2)&7), offset 高 3 位在 tag 中
    Buffer.from([0x01 | (0 << 2) | (0 << 5), 0x02]), // len=4, offset=2
  ]);
  assert.equal(snappyDecompress(stream).toString(), "ababab");
});

test("snappyDecompress 拒绝非法长度", () => {
  assert.throws(() => snappyDecompress(Buffer.from([0x00])), /snappy 长度非法/);
});

test("snappyDecompress 拒绝越界 backref", () => {
  // 长度 4：先 literal "a"，再用 type=2 backref，offset 5 > 已输出 1 字节
  const stream = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from([0x00]), // literal len 1
    Buffer.from("a"),
    Buffer.from([0x02 | (2 << 2), 0x05, 0x00]), // type=2, copyLen=1+(2>>2)=2? 用 (tag>>>2)=1 → len 2
  ]);
  assert.throws(() => snappyDecompress(stream), /backref 越界/);
});
