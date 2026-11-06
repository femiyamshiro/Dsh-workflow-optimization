# DSH 工作台整合配置与适配补丁

这是现有 Ubuntu DSH 整合成果的迁移资料包，供 Win11 上源码编译的 Desktop alpha.2 继续适配。它保留两条版本线，不把 RC3 已通过的工作台验收算成 alpha.2 或 Windows 的验收。

| 版本线 | 内容 | 已有验证 | 当前边界 |
|---|---|---|---|
| 日常 RC3 工作基准 | DSH 0.2.1-rc.3、TUI 0.17.0、OPS 0.4.1、taskboard 1.1.5 和 session-toolkit 0.1.1 本地修订；默认 PTC | Linux 真 TUI、工具执行、SID 恢复、看板持久化、原则全文进入请求 | 不是 Desktop 安装包 |
| alpha.2 源码实验 | 官方提交 `f3803c96974ad4a94195fb97e5c637e9c2a3afe3` 加内核、插件适配，OPS 0.4.4 | Linux 定向测试、完整构建、Web/TUI 烟测和确定性路由 | 未做 Windows Desktop 验收、真实模型完整工程或工作台插件移植 |

先读 [Win11 Desktop 交接](HANDOFF-WIN11-DESKTOP.md)，再看 [优化来源与差异](docs/ARCHITECTURE.md) 和 [验证范围](docs/VALIDATION.md)。本版为公开脱敏资料包；个人机器载体与详细主机报告未公开。来源版本和文件校验在 `SOURCE-SNAPSHOT.json` 与 `MANIFEST.sha256.json`。

克隆后可运行 `node tools/verify-manifest.mjs` 核对文件完整性；它只读取本仓库，不访问账号、网络或系统配置。

## 目录

- `vendor/taskboard`、`vendor/session-toolkit`：服务器实际采用的本地修订，保留上游源码、可用构建产物、许可证与 NOTICE，不含 node_modules。
- taskboard 的补充构建参考来自固定上游 blob；导出未重建。必要辅助 JS 与目标侧构建限制见 `vendor/taskboard/REBUILD.md`。
- `patches/alpha2/core.patch`：基于固定官方提交的完整源码差异，包含新增定向测试与上游测试夹具的必要变更。
- `patches/alpha2/plugins-compat.patch`：TUI 原生模型切换、独立偏好目录及插件实验兼容声明；不包含已过时的 OPS 0.4.1 修改。
- `patches/alpha2/ops-0.4.4.package.reference.json`：当前实验 OPS 的元数据参考；worker 与发布物不在此重编或改版本。
- `profiles/*/*.reference.*`：配置参考，保留 YAML 标签；目标路径需本机适配。不是可覆盖到 Desktop 的安装文件。
- `profiles/desktop-alpha2`：最小 PTC 示例，不更改桌面认证或固定监听端口。
- `principles`：完整通用原则参考与无主机绑定的 DSH 运行示例；服务器专用载体、账号与记忆合同不公开，也不自动加载。
- 历史验证的有界摘要在 `docs/VALIDATION.md`；详细主机报告留在本地迁移包，本次导出不重跑历史模型测试。
- `docs`：TUI 手册与文字原生 SVG 速查壁纸。Desktop 快捷键、关闭行为以 Desktop 自身实现为准。

## 使用边界

本仓库不包含账号凭据、私钥、生产会话、任务账本、原始运行日志、模型权重、MCP 配置或记忆写入器。没有迁移账号/对话、启用跨设备记忆、启动服务或开放网络端口的脚本。模型地址中的 `127.0.0.1` 指运行应用的那台机器；克隆到笔记本不会自动连接服务器模型。

不要把 `.reference` 文件直接覆盖现有 profile，也不要将服务器 `DSH_HOME` 或 Electron userData 整目录同步到笔记本。恢复使用目标机器已有 Git/备份，并只撤销本次差分；禁止删除会话锁来强开同一会话。

## 来源

底座来自 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。工作台参考 [kira905/ops-handoff-design](https://github.com/kira905/ops-handoff-design)，采用其任务板与会话工具包并做有界本地修订。OPS 来自 [T-Auto/dsh-ops](https://github.com/T-Auto/dsh-ops)，TUI、Context 与团队插件来源见 [第三方说明](THIRD-PARTY-NOTICES.md)。各目录保留自己的许可证，本仓库不把第三方代码统一改授为另一许可证。
