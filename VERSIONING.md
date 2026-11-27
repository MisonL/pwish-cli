# 版本与发布管理

## 版本格式

遵循 [Semantic Versioning 2.0.0](https://semver.org/lang/zh-CN/)：`MAJOR.MINOR.PATCH`。

| 变化类型 | 规则 | 例子 |
|---|---|---|
| PATCH | 向后兼容的 bug 修复 | 0.2.0 → 0.2.1 |
| MINOR | 向后兼容的新功能 | 0.2.0 → 0.3.0 |
| MAJOR | 不兼容的 API/行为变更 | 0.2.0 → 1.0.0 |

当前阶段所有版本均 < 1.0.0，表示接口非官方、可能随站点变化。

## 发布流程

1. **改代码**，确保 `npm run verify` 全绿（自检 + 格式 + 全部测试）。
2. **更新 CHANGELOG.md**：把改动写入 `[Unreleased]` 之上的新版本段落，标注日期。
3. **升版本号**：`npm version patch|minor|major`（会自动改 package.json 并打 git tag `vX.Y.Z`）。
4. **同步 skill 安装副本**（如本地有）：`cp -R skill/pwish ~/.agents/skills/pwish`。
5. **推送**：`git push && git push --tags`。
6. **发布**：`npm publish`（`prepublishOnly` 会自动再跑一遍 verify）。

## 禁止事项

- 不要把 token、用户 ID、本机绝对路径（`/Users/...`、`C:\Users\...`）写进代码、测试或文档。
  测试用例里的 token 必须是明显占位符（如 `v2,10000001,482,deadbeef`）。
- 不要在文档里描述接口获取方式的实现细节。
- 不要跳过 `verify`；CI（Node 20 / 22）会重复该检查。

## 已发布版本

见 CHANGELOG.md 或 `npm view pwish-cli versions`。
