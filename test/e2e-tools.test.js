import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { main } from "../src/cli.js";
import { UserError } from "../src/config.js";
import { setSink } from "../src/output.js";
import { resetFetch, setFetch } from "../src/net.js";

const TOKEN = "v2,10000001,482,0123456789abcdef0123456789abcdef";
const OSS_HOST = "https://picwishsz.oss-cn-shenzhen.aliyuncs.com";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function json(obj, status = 200) {
  return {
    ok: status < 400,
    status,
    text: async () => JSON.stringify(obj),
    arrayBuffer: async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength),
  };
}

function png(url) {
  return {
    ok: true,
    status: 200,
    text: async () => "png",
    arrayBuffer: async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength),
  };
}

/** 假接口：上传授权、OSS PUT、工具建任务/轮询、结果下载、额度查询。 */
function fakeApi({ answerFor = () => "out.png", onCreate } = {}) {
  const calls = [];
  let uploadSeq = 0;

  const impl = async (url, init = {}) => {
    const u = String(url);
    const method = init.method || "GET";
    calls.push({ url: u, method, body: init.body && typeof init.body === "string" ? safeJson(init.body) : init.body });

    if (u.includes("vips/all-free-counts")) {
      return json({ status: 200, data: { cutout_num: "50", product_restore: "50", vip: "0" } });
    }
    if (u.includes("authorizations/oss")) {
      const body = safeJson(init.body);
      const objects = {};
      for (const name of body.filenames || []) objects[name] = `pub/${name}-${++uploadSeq}`;
      return json({
        status: 200,
        data: {
          bucket: "picwishsz",
          endpoint: "oss-cn-shenzhen.aliyuncs.com",
          objects,
          credential: { access_key_id: "id", access_key_secret: "sec", security_token: "tok" },
        },
      });
    }
    if (u.startsWith(`${OSS_HOST}/`)) {
      const key = u.slice(OSS_HOST.length + 1);
      return json({ data: { resource_id: `rid-${key}` } });
    }
    if (method === "POST" && /tasks\/login\/(external\/gem-image-edit|segmentation)$/.test(new URL(u).pathname)) {
      const body = safeJson(init.body);
      onCreate?.({ path: new URL(u).pathname, body });
      return json({ status: 200, data: { task_id: `task-${calls.length}` } });
    }
    const pollMatch = u.match(/tasks\/login\/(external\/gem-image-edit|segmentation)\/(task-\d+)/);
    if (pollMatch) {
      return json({
        status: 200,
        data: { task_id: pollMatch[2], state: 1, progress: 100, answer: [{ file: `${OSS_HOST}/${answerFor()}` }] },
      });
    }
    if (u.startsWith(`${OSS_HOST}/out`)) return png(u);
    throw new Error(`假接口没有模拟：${method} ${u}`);
  };

  return { impl, calls };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-e2e-tools-"));
  const outDir = path.join(dir, "out");
  const a = path.join(dir, "product.png");
  const b = path.join(dir, "ref.png");
  fs.writeFileSync(a, PNG);
  fs.writeFileSync(b, PNG);
  t.after(() => {
    resetFetch();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { dir, outDir, a, b };
}

/** 复刻 bin/pwish.js 的错误映射，这样在进程内也能断言退出码。 */
/** 复刻 bin/pwish.js 的错误映射，结果行通过 output 的 sink 收集（不改 process.stdout）。 */
async function capture(fn) {
  let out = "";
  setSink((chunk) => {
    out += chunk;
  });
  try {
    const code = await fn();
    return { code: code ?? 0, out };
  } catch (err) {
    out += `${err.message}\n`;
    if (err instanceof UserError) return { code: err.code === "NO_TOKEN" ? 3 : 2, out };
    return { code: 1, out };
  } finally {
    setSink(null);
  }
}

function withEnv(env, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  return Promise.resolve(fn()).finally(restore);
}

test("whitebg 端到端：上传 2 张图 → 建任务 → 轮询 → 下载（本地假接口）", async (t) => {
  const { outDir, a, b } = setup(t);
  const created = [];
  const api = fakeApi({ answerFor: () => "restored.png", onCreate: (x) => created.push(x) });
  setFetch(api.impl);

  const res = await withEnv({ PWISH_TOKEN: TOKEN, PWISH_API_BASE: "http://127.0.0.1:1/api" }, () =>
    capture(() => main(["whitebg", "-i", a, "-i", b, "-o", outDir, "--json"])),
  );

  assert.equal(res.code, 0);
  const payload = JSON.parse(res.out);
  assert.equal(payload.tool, "whitebg");
  assert.equal(payload.images.length, 1);
  assert.equal(payload.files.length, 1);

  const create = created.find((c) => c.path.endsWith("/tasks/login/external/gem-image-edit"));
  assert.ok(create, "应该调用商品还原接口");
  assert.equal(create.body.source_resource_ids.length, 2, "必须上传两张图并一起提交");
  assert.equal(create.body.from, "product-restore");
  assert.equal(create.body.template_type, 1);

  const files = fs.readdirSync(outDir);
  assert.equal(files.length, 1);
  assert.ok(files[0].includes("whitebg"), `文件名应带工具名：${files[0]}`);
  assert.equal(fs.statSync(path.join(outDir, files[0])).size, PNG.length);
});

test("whitebg 只给一张图：退出码 2 且不发任何请求", async (t) => {
  const { outDir, a } = setup(t);
  const api = fakeApi();
  setFetch(api.impl);

  const res = await withEnv({ PWISH_TOKEN: TOKEN, PWISH_API_BASE: "http://127.0.0.1:1/api" }, () =>
    capture(() => main(["whitebg", "-i", a, "-o", outDir])),
  );

  assert.equal(res.code, 2);
  assert.match(res.out, /正好 2 张图/);
  assert.equal(api.calls.length, 0, "参数校验必须在联网前完成");
});

test("batch cutout --json --concurrency 2：并发执行、JSON 可解析、逐项成功", async (t) => {
  const { dir, outDir } = setup(t);
  const batchDir = path.join(dir, "batch");
  fs.mkdirSync(batchDir);
  for (const name of ["a.png", "b.png", "c.png"]) fs.writeFileSync(path.join(batchDir, name), PNG);

  let inFlight = 0;
  let maxInFlight = 0;
  const api = fakeApi();
  // 并发统计要在「建任务」前后留下窗口
  const base = api.impl;
  setFetch(async (url, init) => {
    const isCreate = (init?.method || "GET") === "POST" && /tasks\/login\/segmentation$/.test(new URL(String(url)).pathname);
    if (isCreate) {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 60));
    }
    try {
      return await base(url, init);
    } finally {
      if (isCreate) inFlight -= 1;
    }
  });

  const res = await withEnv({ PWISH_TOKEN: TOKEN, PWISH_API_BASE: "http://127.0.0.1:1/api" }, () =>
    capture(() => main(["batch", "cutout", batchDir, "-o", outDir, "--json", "--concurrency", "2"])),
  );

  assert.equal(res.code, 0);
  const payload = JSON.parse(res.out);
  assert.equal(payload.total, 3);
  assert.equal(payload.ok, 3);
  assert.equal(payload.results.filter((r) => r.ok).length, 3);
  assert.ok(maxInFlight >= 2, `应该真的并发（实测最大并发 ${maxInFlight}）`);
  assert.ok(maxInFlight <= 2, `并发不应超过 --concurrency 上限（实测 ${maxInFlight}）`);
  assert.equal(fs.readdirSync(outDir).length, 3);
});

test("batch 遇到未知工具：退出码 2，且不发请求", async (t) => {
  const { dir, outDir } = setup(t);
  const api = fakeApi();
  setFetch(api.impl);

  const res = await withEnv({ PWISH_TOKEN: TOKEN, PWISH_API_BASE: "http://127.0.0.1:1/api" }, () =>
    capture(() => main(["batch", "not-a-tool", dir, "-o", outDir])),
  );

  assert.equal(res.code, 2);
  assert.match(res.out, /未知工具|可用工具/);
  assert.equal(api.calls.length, 0);
});
