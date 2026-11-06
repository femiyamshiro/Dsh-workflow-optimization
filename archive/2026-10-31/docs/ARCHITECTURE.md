# 整合来源与版本差异

## 采用的开源组件

官方 DSH 提供会话、原生工具、PTC、权限、Jobs、模型选择和 GUI/CLI 基础。kira905 的复刻手册及设计资料用于工作台接力/验收方案，实际采用 task-board-local 与 session-toolkit。OPS 是另一个上游项目 T-Auto/dsh-ops，不能把它、官方 DSH 或第三方 TUI 都归为 kira905 作者。

工作台本地修订把 reject/correction 反馈纳入真实执行提示；在人工验收和自动收尾之前核对 owned Jobs；对 session.v4.jsonl.zstd 读取加入原生文件名词汇、有界尾读和恢复链。具体源代码与构建产物位于 vendor；其行为证据见 docs/VALIDATION.md。工具回执、会话 idle、卡片 review、Jobs settled 和验收是不同状态。

## alpha.2 复用原生能力

alpha.2 原生 `Agent.model.select()` 已接管模型/effort 选择与持久化通知；实验 TUI 移除旧的请求阶段覆盖，并增加独立偏好目录。新增原生 executor、全局/项目指令预算分链等能力优先复用。

本地 core 补丁补足：工具批次失败后收尾和首次错误保存、Linux scope 查询竞态、Bash managed-range 明确完成/取消范围，以及外层 shell execution 元数据。它不宣称流水线中每个程序都成功，也不以直接进程退出推断所有子进程已结束。

alpha.2 实验的 OPS 已更新为 0.4.4；taskboard/session-toolkit 仍留在 RC3 工作台，尚未完成 alpha/Windows Desktop 迁移。历史验证摘要见 docs/VALIDATION.md；详细主机报告保留在本地迁移包中。

## 保留的边界

固定内存阈值加 flock 的资源 guard 已退役，不在本包安装或接入。独立资源观测和足够测试时间仍适用，不能把模型上下文压缩当成物理 RAM/Swap 调度。

原生 TUI 安全菜单重试可能回落普通 profile。RC3 启动参考仅保存其已知边界；新设备应验证实际 Host profile，不只看入口名称或继承的环境变量。

本包不包含服务器公共入口、反向代理、密钥或账户同步功能；共享 DSH_HOME 可原生共享登录，不等于跨设备配置或凭据自动同步。
