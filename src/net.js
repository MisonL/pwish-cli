/**
 * HTTP 出口。
 *
 * 生产环境就是 Node 内置 `fetch`；测试可以 `setFetch()` 注入本地实现，
 * 这样端到端用例能覆盖「上传 → 建任务 → 轮询 → 下载」整条链路而不碰真实网络。
 * 除测试外不要在业务代码里替换它。
 */
const realFetch = (...args) => globalThis.fetch(...args);

let impl = realFetch;

export function netFetch(url, init) {
  return impl(url, init);
}

/** 仅测试使用：注入假的 fetch。传 null 恢复正常实现。 */
export function setFetch(fn) {
  impl = typeof fn === "function" ? fn : realFetch;
}

export function resetFetch() {
  impl = realFetch;
}
