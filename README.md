# DSH 优化架构与工作策略

最新资料日期：**2026-11-06**。默认入口为 [CURRENT.json](CURRENT.json)，当前方案、补丁及示例全部位于 `current/`。旧资料保留在 `archive/2026-10-31/`，不参与最新配置、校验或构建输入。

## 优化目标与方向

这套整合面向长任务、多工具调用、上下文增长以及本地主模型运行。以DSH原生能力为基础，补足可定位的可靠性缺口，并把恢复、验收和版本兼容纳入同一工作流程。

| 优化方向 | 重点解决的问题 |
|---|---|
| 工具执行可靠性 | 批次中部分工具报错后，已经完成的结果不能丢；进程退出、后台任务完成与任务成功要区分 |
| 文件操作一致性 | 编辑依赖明确读过的文件版本，避免把并发发生的未读修改当成已经观察过 |
| 长对话与上下文 | 降低已完成多turn日志的占用，保留完整工作规则，并支持压缩后有界找回原文 |
| 任务连续性与验收 | 会话可恢复，拒绝/纠正反馈进入下一轮执行，后台Jobs未结束时不提前收尾 |
| 本地模型与资源 | 优先进行本地主模型代表任务测试，给足运行时间，并观察RAM、Swap、磁盘及并行负载 |
| 迁移与多端一致性 | 固定运行底座和依赖，保留账号/会话/偏好；Web、TUI和新设备分别验证 |
| 机器读取与版本治理 | 最新资料具有唯一入口，旧档不作为配置兜底，遇到不兼容版本明确要求适配 |

## 已落地的优化内容

| 层面 | 具体改动 | 对应组件 |
|---|---|---|
| 内核执行链 | Linux scope查询采用一致观察期；工具批次异常后提交已drain的连续结果并保留首错；Bash可选managed-range贯通executor、Jobs和取消清理 | DSH rc.5本地核心补丁 |
| 文件读写 | 保留显式read/stat观察；取消成功写入后自动更新fs/observed的背书，后续编辑前重新读取 | OPS观察桥修复 |
| 压缩事务与恢复 | 修复flush错误被吞、未关闭事务、非标准checkpoint和隔离scope归属；使用标准compact-checkpoint并验证冷恢复 | Live Compact、DSH原生会话/持久化 |
| 压缩资料保留 | 保护system/developer及工作规则等注入来源；备份写者共用容量锁，满时保留原上下文；长行检索返回真实命中附近的摘录 | Live Compact备份与检索 |
| 任务工作流 | 拒绝/纠正反馈纳入执行，区分工具完成、Agent idle、Jobs settled、Review与人工Done；补足v4日志尾读、交接事实及恢复链 | TaskBoard、session-toolkit、原生Jobs |
| 运行策略 | 默认PTC，按实际SDK核对工具名/参数/返回；完整规则载入；资源分阶段观察；本地模型留足超时；切换前检查活动任务，回退保留用户数据 | 原生PTC、目标模型服务、工作流程与配置 |
| 仓库交接 | CURRENT.json固定最新内容，离线检查版本/文件/hash/包入口；拒绝归档混用、缺件和不匹配的原生版本 | 最新入口、参考profile、离线校验工具 |

Context用于观察上下文，Live Compact负责受限场景的压缩；二者职责不同。TUI负责交互，工具权限与执行能力由宿主、preset、模型及插件共同决定，不能仅由“在终端里运行”推断更强工具能力。

## 相关组件与分工

| 组件 | 当前版本/来源 | 在方案中的职责 | 本仓库的处理方式 |
|---|---|---|---|
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | 0.2.1-rc.5，固定`b830ec950faba0a46dda564be3e2d854afed94f1` | Host、会话、PTC、权限、Jobs、模型选择和界面基础 | 提供三组可靠性修复的源码补丁及验证边界 |
| [dsh-ops](https://github.com/T-Auto/dsh-ops) | 0.4.4 | 文件、Shell及PTC工具增强 | 提供显式观察桥修复补丁；保留原生读写保护 |
| [dsh-context](https://github.com/bowenliang123/dsh-context) | 0.81.2 | 上下文、缓存与来源观察 | 采用上游发布物并核对整合，不另称自研压缩算法 |
| [DSH TUI](https://github.com/ccch1mneyyy/dsh-TUI) | 0.18.0 | 终端交互、模型/工作区/会话操作入口 | 固定依赖与profile绑定，验证真实TUI；保留已有选择与偏好 |
| [Live Compact](https://github.com/MerkyorLynn/dsh-live-compact) | 本地`1.0.7-rc5.local.20261105`，基于固定`c50c58b00cf8545c6524272563f99bc7f2779384` | 完成turn后的idle小切、标准checkpoint与有界回读 | 提供本地修复源码；仅资格化固定rc.5组合 |
| [task-board-local](https://github.com/kira905/dsh-task-board-local) | 1.1.5本地修订 | 任务卡、反馈、Jobs核对和人工验收 | 保留已有runtime JS与源码；TaskBoard ledger采用单写者 |
| [session-toolkit](https://github.com/kira905/dsh-session-toolkit) | 0.1.1本地修订 | 原生v4会话尾读、交接事实和恢复链工具 | 提供源码；不把会话交接等同于自动记忆同步 |
| [ops-handoff-design](https://github.com/kira905/ops-handoff-design) | 设计参考 | 工作台接力、恢复和验收方案的参考来源 | 链接设计来源；它不是DSH/OPS/TUI的统一运行时 |
| 目标侧模型服务 | 由使用者已有环境决定 | 实际推理与工具选择 | 提供通用参考，不打包权重、账号或服务器连接配置 |

组件协作顺序是：用户请求进入DSH，由PTC组织实际工具调用，OPS增强执行，原生会话记录结果、Jobs记录后台状态，Context观察上下文，Live Compact在合适的idle边界做小切。工作台再按Jobs状态和人工验收推进任务卡。压缩卡片和交接事实不产生新的权限，也不替代原始证据。

## 阅读与机器校验

```bash
node tools/verify-current.mjs
```

这个命令仅校验仓库内的最新清单、版本与引用，不安装依赖、不访问网络或账号、不启动DSH，也不会读取归档来补全配置。需要Node 22.19或24及以上；Node版本要求来自固定DSH/插件组合，并非Python环境要求。

先读[架构](current/docs/ARCHITECTURE.md)、[工作策略](current/docs/STRATEGIES.md)、[验证范围](current/docs/VALIDATION.md)，接入时遵循[机器与笔记本交接](current/docs/MACHINE-HANDOFF.md)。**读取最新方案不等于已安装或适配成功。** 这套运行证据来自Linux与固定rc.5；Win11 Desktop alpha.2可读取方案，但须单独适配，不能直接套用rc.5配置或把版本门禁当作可忽略警告。

## 验证与适用边界

受控多turn历史曾得到约29%的**上下文估算量**下降，并完成压缩后回读与冷恢复检查；这不能换算为账单、速度或质量的普遍提升。xhigh也未被证明普遍优于off。Live Compact不解决持续单长turn的全部压力，资源观测不等于自动优化物理Swap。具体场景、失败样本和未验证项见[验证范围](current/docs/VALIDATION.md)。

本仓库是公开源码/参考配置和验证摘要，不是完整运行时、自动安装器或个人数据同步包。没有凭据、会话、记忆库、生产MCP配置、原始请求日志、模型权重或本机启动器。第三方许可见[说明](THIRD-PARTY-NOTICES.md)，各目录保留原许可证。
