import assert from "node:assert/strict";
import test from "node:test";
import { pollTask } from "../src/tasks.js";

const fast = { intervalMs: 1, timeoutMs: 2000 };

test("pollTask 在 state=1 时返回结果", async () => {
  let n = 0;
  const data = await pollTask(
    {},
    async () => {
      n += 1;
      return n < 3 ? { state: 0, progress: 10 } : { state: 1, progress: 100, image: "x.png" };
    },
    fast,
  );
  assert.equal(data.state, 1);
  assert.equal(n, 3);
});

test("pollTask 容忍偶发查询失败", async () => {
  let n = 0;
  const data = await pollTask(
    {},
    async () => {
      n += 1;
      if (n < 3) throw new Error("socket hang up");
      return { state: 1, progress: 100 };
    },
    fast,
  );
  assert.equal(data.state, 1);
});

test("pollTask 连续失败到上限后抛出原始错误", async () => {
  await assert.rejects(
    () =>
      pollTask(
        {},
        async () => {
          throw new Error("网络请求失败");
        },
        { ...fast, maxConsecutiveErrors: 2 },
      ),
    /网络请求失败/,
  );
});

test("pollTask 遇到 state<0 立即失败并带原因", async () => {
  await assert.rejects(() => pollTask({}, async () => ({ state: -1, error: "task failed" }), fast), /任务失败（state=-1）：task failed/);
});

test("pollTask 超时给出可执行提示", async () => {
  await assert.rejects(
    () => pollTask({}, async () => ({ state: 0, progress: 5 }), { intervalMs: 2, timeoutMs: 30 }),
    /等待超时.*pwish task/,
  );
});

test("pollTask 把已用时长透传给 onProgress", async () => {
  const seen = [];
  await pollTask(
    {},
    async () => ({ state: 1, progress: 100 }),
    { ...fast, onProgress: (p) => seen.push(p) },
  );
  assert.equal(seen.length, 1);
  assert.equal(typeof seen[0].elapsedMs, "number");
});
