import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const BIN = path.join(import.meta.dirname, "..", "bin", "pwish.js");
const TOKEN = "v2,10000001,482,0123456789abcdef0123456789abcdef";

/**
 * 本地假服务：把生成链路（建任务 → 批量查询）截住，
 * 这样 CLI 的端到端行为（参数、payload、轮询、输出、退出码）都能在零网络下验证。
 */
async function startFakeApi({ tasks = "ok" } = {}) {
  const calls = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      calls.push({ method: req.method, path: url.pathname, body: body ? JSON.parse(body) : null, query: Object.fromEntries(url.searchParams) });
      const send = (obj) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(obj));
      };

      // gen 前会先建一个会话（拿 conversation_id）
      if (url.pathname === "/image/conversations" && req.method === "POST") {
        return send({ status: 200, data: { conversation_id: "conv-1" } });
      }
      if (url.pathname === "/tasks/login/image-messages" && req.method === "POST") {
        return send({ status: 200, data: { task_id: `t-${calls.length}` } });
      }
      if (url.pathname === "/tasks/login/image-messages/batch") {
        const ids = (url.searchParams.get("task_ids") || "").split(",").filter(Boolean);
        const items = {};
        for (const id of ids) {
          items[id] =
            tasks === "fail"
              ? { task_id: id, state: -1, progress: 100, error: "生成失败" }
              : { task_id: id, state: 1, progress: 100, answer: [{ file: `https://picwishsz.oss-cn-shenzhen.aliyuncs.com/${id}.png` }] };
        }
        return send({ status: 200, data: { items } });
      }
      send({ status: 404, message: `未模拟的路径 ${url.pathname}` });
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    close: () =>
      new Promise((resolve) => {
        // fetch 的 keep-alive 连接会让 server.close() 一直等；先掐掉再关（Node 24 上尤其明显）
        server.closeIdleConnections?.();
        server.closeAllConnections?.();
        server.close(resolve);
      }),
  };
}

function runCLI(args, env) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pw-e2e-"));
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, "cfg"), PWISH_TOKEN: TOKEN, NO_COLOR: "1", ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => {
      fs.rmSync(home, { recursive: true, force: true });
      resolve({ code, stdout, stderr });
    });
  });
}

test("gen --json 走完整链路：建 N 个任务、轮询、输出 URL、退出码 0", async (t) => {
  const api = await startFakeApi();
  t.after(() => api.close());

  const res = await runCLI(["gen", "白底商品图", "-n", "2", "--no-download", "--json"], { PWISH_API_BASE: api.url });
  assert.equal(res.code, 0, res.stderr);

  const out = JSON.parse(res.stdout);
  assert.equal(out.images.length, 2);
  assert.equal(out.failed.length, 0);
  assert.ok(out.images.every((img) => img.url.endsWith(".png") && img.taskId));
  assert.equal(out.model, "gemini-3");

  const creates = api.calls.filter((c) => c.path === "/tasks/login/image-messages" && c.method === "POST");
  assert.equal(creates.length, 2, "count=2 应该建两个任务");
  assert.ok(creates[0].body.prompt.includes("白底商品图"));
  assert.equal(creates[0].query.product_id, "482");
});

test("gen 任务失败时退出码非 0，且错误信息可见", async (t) => {
  const api = await startFakeApi({ tasks: "fail" });
  t.after(() => api.close());

  const res = await runCLI(["gen", "测试", "--no-download"], { PWISH_API_BASE: api.url });
  assert.notEqual(res.code, 0);
  assert.match(`${res.stdout}${res.stderr}`, /生成失败|无图片返回|失败/);
});

test("gen -n 超范围在发起请求前就被拦下", async (t) => {
  const api = await startFakeApi();
  t.after(() => api.close());

  const res = await runCLI(["gen", "测试", "-n", "99"], { PWISH_API_BASE: api.url });
  assert.equal(res.code, 2);
  assert.match(res.stderr, /一次最多 10 张/);
  assert.equal(api.calls.length, 0, "参数不合法时不应发出任何请求");
});

test("waitForTasks：state<0 即使带 progress=100 与 answer 也算失败", async (t) => {
  const api = await startFakeApi();
  t.after(() => api.close());

  // 覆盖批量查询：第一次回「失败 + 100% + 有图」，看 CLI 是否会误判成功
  const { waitForTasks } = await import("../src/tasks.js");
  const fakeClient = {
    request: async () => ({
      data: {
        items: {
          "t-fail": {
            task_id: "t-fail",
            state: -1,
            progress: 100,
            error: "渲染失败",
            answer: [{ file: "https://picwishsz.oss-cn-shenzhen.aliyuncs.com/x.png" }],
          },
        },
      },
    }),
  };
  const done = await waitForTasks(fakeClient, ["t-fail"], { intervalMs: 1, timeoutMs: 2000 });
  assert.equal(done.get("t-fail").failed, true);
});
