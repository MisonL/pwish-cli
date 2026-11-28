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

test("同一文件在一次进程内只上传一次，不同前缀各自独立", async (t) => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { uploadFile } = await import("../src/upload.js");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-up-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "a.png");
  fs.writeFileSync(file, "fake-png-bytes");

  let authCalls = 0;
  let putCalls = 0;
  const client = {
    request: async () => {
      authCalls += 1;
      return {
        data: {
          bucket: "b",
          endpoint: "oss-cn-shenzhen.aliyuncs.com",
          objects: { "a.png": "k/a.png" },
          credential: { access_key_id: "id", access_key_secret: "sec", security_token: "tok" },
        },
      };
    },
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    putCalls += 1;
    return { ok: true, text: async () => JSON.stringify({ data: { resource_id: "rid-1" } }) };
  };
  try {
    const [first, second] = await Promise.all([
      uploadFile(client, file),
      uploadFile(client, file),
    ]);
    assert.equal(first.resourceId, "rid-1");
    assert.equal(second.resourceId, "rid-1");
    assert.equal(authCalls, 1, "并发两次也只申请一次授权");
    assert.equal(putCalls, 1, "只 PUT 一次");

    await uploadFile(client, file, "pub/tasks/input/image_translate");
    assert.equal(authCalls, 2, "不同前缀不复用");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("上传授权返回非阿里云 OSS 域名时拒绝，避免把文件 PUT 到任意主机", async (t) => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { uploadFile } = await import("../src/upload.js");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-up2-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "b.png");
  fs.writeFileSync(file, "bytes");

  const client = {
    request: async () => ({
      data: {
        bucket: "b",
        endpoint: "evil.example.com",
        objects: { "b.png": "k/b.png" },
        credential: { access_key_id: "id", access_key_secret: "sec", security_token: "tok" },
      },
    }),
  };
  await assert.rejects(() => uploadFile(client, file), /意外的 OSS 域名/);
});

test("上传缓存有上限，长跑批量任务不会无限增长", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { uploadFile } = await import("../src/upload.js");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-up3-"));
  let seq = 0;
  // 授权接口按请求里的 filenames 回 objects（每个文件的名字不同）
  const client = {
    request: async (_path, opts) => {
      const names = opts?.body?.filenames || [];
      const objects = {};
      for (const n of names) objects[n] = `pub/${++seq}.png`;
      return {
        data: {
          bucket: "picwishsz",
          endpoint: "oss-cn-shenzhen.aliyuncs.com",
          objects,
          credential: { access_key_id: "id", access_key_secret: "sec", security_token: "tok" },
        },
      };
    },
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ data: { resource_id: "rid" } }) });

  try {
    // 造 210 个不同文件，超过 200 的上限
    const files = [];
    for (let i = 0; i < 210; i += 1) {
      const f = path.join(dir, `f${i}.png`);
      fs.writeFileSync(f, `bytes-${i}`);
      files.push(f);
    }
    for (const f of files) await uploadFile(client, f);

    // 再传一次第一个文件：已被淘汰，应当重新上传（seq 继续增长）
    const before = seq;
    await uploadFile(client, files[0]);
    assert.ok(seq > before, "被淘汰的缓存项应重新上传，而不是无限保留");
  } finally {
    globalThis.fetch = realFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
