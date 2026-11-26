import assert from "node:assert/strict";
import test from "node:test";
import { describeStatus } from "../src/passport.js";

test("describeStatus 覆盖常见登录错误码", () => {
  assert.match(describeStatus(11000), /账号不存在/);
  assert.match(describeStatus(11211), /邮箱未注册/);
  assert.match(describeStatus(11212), /手机号未注册/);
  assert.match(describeStatus(11216), /未设置密码/);
  assert.match(describeStatus(11317), /安全验证/);
});

test("describeStatus 未收录的状态码回落到服务端文案", () => {
  assert.equal(describeStatus(99999, "服务端说不行"), "服务端说不行");
  assert.match(describeStatus(99999), /99999|失败/);
  assert.match(describeStatus(undefined, ""), /失败|未知/);
});
