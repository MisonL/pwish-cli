import assert from "node:assert/strict";
import test from "node:test";
import { resolveTask, taskImageUrls } from "../src/tasks.js";

/** 极简假 client：按 path 返回预置响应，模拟三种任务来源。 */
function fakeClient(routes) {
  return {
    async request(path) {
      const key = Object.keys(routes).find((k) => path.startsWith(k));
      if (!key) throw new Error(`unexpected path ${path}`);
      const route = routes[key];
      if (route.throw) throw new Error(route.throw);
      return { status: 200, data: route.data };
    },
  };
}

test("resolveTask 忽略批量接口对未知 id 返回的 15021 占位对象", async () => {
  const client = fakeClient({
    "tasks/login/image-messages/batch": {
      data: { items: { abc: { state: 15021, message_id: "", task_id: "", answer: null } } },
    },
    "tasks/login/suite/": { throw: "TASK_EXPIRED" },
    "image/conversations/": { throw: "not found" },
  });
  assert.equal(await resolveTask(client, "abc"), null);
});

test("resolveTask 能识别对话式任务", async () => {
  const client = fakeClient({
    "tasks/login/image-messages/batch": {
      data: { items: { t1: { message_id: "t1", state: 1, answer: [{ file: "https://cdn.example.com/a.png" }] } } },
    },
  });
  const resolved = await resolveTask(client, "t1");
  assert.equal(resolved.kind, "image");
  assert.deepEqual(taskImageUrls(resolved), ["https://cdn.example.com/a.png"]);
});

test("resolveTask 能识别套图/详情图任务并按场景取图", async () => {
  const client = fakeClient({
    "tasks/login/image-messages/batch": { throw: "not an image task" },
    "tasks/login/suite/": {
      data: {
        state: 1,
        items: {
          poster: { answer: [{ file: "https://cdn.example.com/p.png" }] },
          feature: { answer: [{ file: "https://cdn.example.com/f.png" }] },
        },
      },
    },
  });
  const resolved = await resolveTask(client, "s1");
  assert.equal(resolved.kind, "suite");
  assert.deepEqual(taskImageUrls(resolved), ["https://cdn.example.com/p.png", "https://cdn.example.com/f.png"]);
});

test("resolveTask 回退到会话并平铺取图", async () => {
  const client = fakeClient({
    "tasks/login/image-messages/batch": { throw: "not an image task" },
    "tasks/login/suite/": { throw: "expired" },
    "image/conversations/": {
      data: { items: [{ answer: [{ file: "https://cdn.example.com/c1.png" }] }, { answer: [{ file: "https://cdn.example.com/c2.png" }] }] },
    },
  });
  const resolved = await resolveTask(client, "conv1");
  assert.equal(resolved.kind, "conversation");
  assert.equal(taskImageUrls(resolved).length, 2);
});
