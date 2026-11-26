import assert from "node:assert/strict";
import test from "node:test";
import { summarizeQuota, preflight, hasCredits, modelRemain, toolRemainOf } from "../src/quota.js";

const sample = {
  vip: 0,
  free_point: 0,
  all_free_point: 0,
  vip_detail: { license_type: "free", expired_at: 1, remained_seconds: 0 },
  local_vip_quota: { is_vip: 0, gemini_remain: 0 },
  llm_chat_num_gm30: 0,
  llm_chat_num_banana21: 2,
  llm_chat_suite: 0,
  llm_chat_detail: 1,
  image_edit_free_num: 3,
  segmentation_login_num: 10,
  segmentation_used_free_num: 2,
  watermark_image_free_num: 3,
};

test("summarizeQuota 归类模型 / 设计任务 / 工具", () => {
  const q = summarizeQuota(sample);
  assert.equal(q.membership.isVip, false);
  assert.equal(q.membership.licenseType, "free");
  assert.equal(modelRemain(q, "gemini-3"), 0);
  assert.equal(modelRemain(q, "nano-banana-pro"), 2);
  assert.equal(q.designer.suite, 0);
  assert.equal(q.designer.detail, 1);
  assert.equal(toolRemainOf(q, "cutout"), 10);
  assert.equal(q.tools.cutout.used, 2);
  assert.equal(toolRemainOf(q, "colorize"), undefined);
});

test("会员身份与算粒", () => {
  const vip = summarizeQuota({
    ...sample,
    vip: 1,
    local_vip_quota: { is_vip: 1, gemini_remain: 12 },
    vip_detail: { license_type: "premium", expired_at: 1800000000 },
  });
  assert.equal(vip.membership.isVip, true);
  assert.equal(vip.credits.vipGeminiRemain, 12);
  assert.equal(hasCredits(vip), true);
  assert.equal(hasCredits(summarizeQuota(sample)), false);
});

test("preflight 在额度为 0 时拦截并给出替代模型", () => {
  const q = summarizeQuota(sample);
  const blocked = preflight(q, { kind: "model", modelKey: "gemini-3" });
  assert.equal(blocked.level, "block");
  assert.match(blocked.message, /nano-banana-pro/);
  const ok = preflight(q, { kind: "model", modelKey: "nano-banana-pro" });
  assert.equal(ok.level, "ok");
  assert.equal(ok.remain, 2);
});

test("preflight 对套图 / 工具给出与功能对应的提示", () => {
  const q = summarizeQuota(sample);
  assert.equal(preflight(q, { kind: "design", modelKey: "suite" }).level, "block");
  assert.equal(preflight(q, { kind: "design", modelKey: "detail" }).level, "ok");
  assert.equal(preflight(q, { kind: "tool", modelKey: "cutout" }).level, "ok");
  // 未知字段不误判为 0
  assert.equal(preflight(q, { kind: "tool", modelKey: "colorize" }).level, "ok");
});
