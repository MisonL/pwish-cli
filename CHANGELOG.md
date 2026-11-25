# Changelog

本项目所有重要变更均记录于此。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.1.0] - 2026-11-25

首个公开版本。

### Added

- **本机登录页**：`pwish login` 在 `127.0.0.1` 起临时授权服务并打开自建登录页，
  支持微信扫码与手机号/邮箱 + 密码两种方式，视觉对齐佐糖官网登录页；
  登录凭据经本机服务调用官方账号接口换取登录态，密码不落盘
- OAuth 2.0 授权码 + PKCE(S256) 回环流程（state 防 CSRF、授权码一次性 60 秒、Host 校验防 DNS rebinding）
- 一句话出图 `pwish gen`：参考图上传、模型/比例/清晰度/张数/经济与稳定模式
- 电商套图 `pwish suite`：AI 按场景写提示词后批量出图（白底主图、核心卖点、卖点、材质、模特）
- 结果管理：`task`、`history`、`show`、`download`、`queue`、`quota`、`models`
- agent skill `skill/pwish/SKILL.md`
- 跨平台支持：macOS / Linux / Windows 的浏览器授权链接打开与剪贴板读取
- 工程化：静态自检、格式检查、CI（Node 20 / 22）、44+ 单元测试

### 说明

- 套图支持 5 个场景；「场景展示图」「多场景拼图」暂不支持
- 电商详情图、电商视频暂不支持
- `--mode stable` 参数可下发，出图效果与计费差异未经实测
- 免费额度生成的图片带水印，去水印需按站点规则升级
