import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeUrl } from "../src/tasks.js";

test("assertSafeUrl 只放行 https + 白名单域名", () => {
  const ok = "https://picwishsz.oss-cn-shenzhen.aliyuncs.com/pub/x.png?Expires=1";
  assert.equal(assertSafeUrl(ok), ok);
  assert.ok(assertSafeUrl("https://qncdn.aoscdn.com/a.png"));
  assert.throws(() => assertSafeUrl("http://picwishsz.oss-cn-shenzhen.aliyuncs.com/a.png"), /https/);
  assert.throws(() => assertSafeUrl("https://evil.example.com/a.png"), /白名单/);
  assert.throws(() => assertSafeUrl("https://aliyuncs.com.evil.com/a.png"), /白名单/);
  assert.throws(() => assertSafeUrl("not-a-url"), /不合法/);
});

test("downloadImage 带超时信号，且拒绝白名单外的地址", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { downloadImage } = await import("../src/tasks.js");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-dl-"));
  let seenSignal = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => {
    seenSignal = opts?.signal;
    return {
      ok: true,
      arrayBuffer: async () => {
        const b = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
      },
    };
  };
  try {
    const out = await downloadImage(
      "https://picwishsz.oss-cn-shenzhen.aliyuncs.com/a.png",
      dir,
      "../../escape",
    );
    assert.ok(seenSignal, "必须传 AbortSignal 兜住卡住的下载");
    // 文件名被消毒：不能跳出目标目录
    assert.equal(path.dirname(out.file), dir);
    assert.equal(path.basename(out.file), "escape.png");
  } finally {
    globalThis.fetch = realFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }

  await assert.rejects(
    () => downloadImage("https://evil.example.com/a.png", dir, "x"),
    /白名单/,
  );
});

test("downloadImage 遇到 HTTP 200 的 XML 错误体不会落盘", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { downloadImage } = await import("../src/tasks.js");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-dl2-"));
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => "",
    arrayBuffer: async () => {
      const s = '<?xml version="1.0"?><Error><Code>AccessDenied</Code></Error>';
      return new TextEncoder().encode(s).buffer;
    },
  });
  try {
    await assert.rejects(
      () => downloadImage("https://picwishsz.oss-cn-shenzhen.aliyuncs.com/a.png", dir, "x"),
      /下载结果不是图片.*AccessDenied/,
    );
    assert.deepEqual(fs.readdirSync(dir), [], "错误体不能被写成图片文件");
  } finally {
    globalThis.fetch = realFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
