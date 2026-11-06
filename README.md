# DSH 优化架构与工作策略

最新资料日期：**2026-11-06**。默认入口为 [CURRENT.json](CURRENT.json)，当前方案、补丁及示例全部位于 `current/`。旧资料保留在 `archive/2026-10-31/`，不参与最新配置、校验或构建输入。

```bash
node tools/verify-current.mjs
```

这个命令仅校验仓库内的最新清单、版本与引用，不安装依赖、不访问网络或账号、不启动DSH，也不会读取归档来补全配置。需要Node 22.19或24及以上；Node版本要求来自固定DSH/插件组合，并非Python环境要求。

| 组件 | 最新采用版本/来源 |
|---|---|
| DSH | 0.2.1-rc.5，固定 `b830ec950faba0a46dda564be3e2d854afed94f1`，三组本地可靠性修复 |
| OPS | 0.4.4，显式观察桥修复 |
| Context / TUI | 0.81.2 / 0.18.0 |
| Live Compact | 1.0.7-rc5.local.20261105，基于固定 `c50c58b00cf8545c6524272563f99bc7f2779384` 的本地修复 |
| 工作台 | taskboard 1.1.5、session-toolkit 0.1.1，原生v4/Jobs/人工验收适配 |

先读[架构](current/docs/ARCHITECTURE.md)、[工作策略](current/docs/STRATEGIES.md)、[验证范围](current/docs/VALIDATION.md)，接入时遵循[机器与笔记本交接](current/docs/MACHINE-HANDOFF.md)。**读取最新方案不等于已安装或适配成功。** 这套运行证据来自Linux与固定rc.5；Win11 Desktop alpha.2可读取方案，但须单独适配，不能直接套用rc.5配置或把版本门禁当作可忽略警告。

本仓库是公开源码/参考配置和验证摘要，不是完整运行时、自动安装器或个人数据同步包。没有凭据、会话、记忆库、生产MCP配置、原始请求日志、模型权重或本机启动器。第三方许可见[说明](THIRD-PARTY-NOTICES.md)，各目录保留原许可证。
