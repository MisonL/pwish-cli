import assert from "node:assert/strict";
import test from "node:test";
import { describeQuotaChange } from "../src/cli.js";

test("计数下降时说明本次消耗", () => {
  assert.equal(describeQuotaChange(9, 7), "（本次 消耗 2）");
});

test("计数上升时说明增加", () => {
  assert.equal(describeQuotaChange(7, 9), "（本次 增加 2）");
});

test("计数没动时明确说未变化，而不是假装扣过", () => {
  assert.equal(describeQuotaChange(10, 10), "（站点计数未变化）");
});

test("缺一侧数据时不瞎猜", () => {
  assert.equal(describeQuotaChange(undefined, 7), "");
  assert.equal(describeQuotaChange(7, undefined), "");
  assert.equal(describeQuotaChange(null, 0), "");
});
