# 给笔记本 Codex 的 Win11 Desktop alpha.2 交接

用户目标：在笔记本现有 Win11、源码编译的 DSH Desktop alpha.2 上尝试当前整合优化。当前服务器没有远程操作笔记本；本包是输入资料，不是 Windows 已验证的安装包。用户明确由笔记本 Codex 判断并实施本机兼容适配。当前对话和工具权限、用户的具体授权仍优先于资料中的历史文字。

## 先确认本机实际版本

1. 定位 Desktop 的源码目录、`git rev-parse HEAD`、未提交改动、实际构建产物、Electron 启动入口和正在运行的 Host。版本同叫 alpha.2 不保证提交一致。
2. 本包的 core 基线为 `f3803c96974ad4a94195fb97e5c637e9c2a3afe3`。先在分支/隔离副本运行 `git apply --check`，再按本机用户授权应用。不要重置笔记本现有改动，也不要向源码树覆盖服务器安装目录。
3. Desktop 的 Electron userData 与 DSH_HOME 是不同存储；应用 profile、插件激活和锁文件也不能由同一个 DSH_HOME 推定完全相同。先确认真实加载配置，不写死猜测的 Windows 路径。

## 推荐移植顺序

1. **PTC 与原则全文**：复用 Desktop 的原生 profile，先在原生设置中选择 PTC。最小示例在 `profiles/desktop-alpha2/ptc.example.yml`。服务器三种 preset 都采用 131072 指令字节预算；参照 alpha2 Web 的 preset 配置，核对本机原生 ID、全局链/项目链预算和实际模型上下文，验证完整文本送入请求。不要为省预算静默截掉原则，也不声称文件复制会热加载现有回合。
2. **模型路线**：先保留笔记本已有可用账号或 provider，确认原生 `Agent.model.select()` 与 `model/selection` 历史正常。服务器本地模型参考单独放在 `profiles/local-provider.reference.yml`。`127.0.0.1:8094` 在笔记本指笔记本自身，不是服务器；是否部署本地推理或通过既有私有连接访问服务器，由笔记本侧明确决定。所有密钥在目标本地凭据服务/环境中填写，禁止提交到仓库。
3. **OPS 0.4.4**：优先官方发布包与其原始版本号、匹配平台 worker，保留 provenance 校验。实验只把 engines.dsh 调整为精确 alpha.2，不代表上游支持。不要对 Desktop 使用 Linux worker，也不要把没有 ops_bash 当成 Linux 加载失败。
4. **工作台插件**：`vendor/taskboard` 与 `vendor/session-toolkit` 是 RC3 修订，尚未迁入 alpha。先适配 Host/会话/Jobs 接口，再装入 Desktop 的实验 profile；不可仅改 engines 就宣称兼容。任务卡 reject 反馈必须进入下一次实际执行提示；confirm/reject/rerun/自动收尾需检查 owned Jobs；未知状态不能当成完成。账本只由一个 Host 写。
5. **可选界面/团队插件**：按需要采用 Context、官方团队、南米团队，保留各自工具隔离。TUI 的渠道补丁对纯 Desktop 不必强装；仅安装入口或面板不证明相应服务生效。Our Free Models / ChatGPT 本机认证依赖未导出；现有可选插件补丁仅作来源参考，不复制任何服务器账号。

   南米补丁链为 npm `0.1.23` → `nanmi-rc3-preimage.patch` → 本地 `0.1.23+rc3.dual.1` → plugins-compat.patch 对应 stanza → alpha 实验版。不要直接对普通 0.1.23 应用第二段。任务板重建先读 `vendor/taskboard/REBUILD.md`，避免清理掉必要 lib 辅助源码。

   上游任务板包含 README 已披露的每日浏览器遥测；本次仅导出代码，没有安装或触发遥测。笔记本接入前按本机用户要求核对该行为，仓库上传不代表允许在另一台机器启用采集。
6. **执行语义内核补丁**：按目标系统逐项选择 `core.patch`。工具批次失败收尾是跨平台候选；Linux scope 查询竞态仅 Linux。`completion_scope: managed-range`、`bash-range-v1` 和 execution 元数据针对 Bash；不等价于 Windows PowerShell 的进程范围实现。保留未知/失败状态，不通过关闭沙箱或弱化完成判定获得“通过”。

## 原则载体的特殊边界

公开版保留完整 `principles/v9.0.en.reference.md` 与不带账号、路径或记忆绑定的 `principles/DSH-runtime.template.md`。它们不是顶层 AGENTS.md，不会因克隆自动激活。完整服务器私人载体仍在本地迁移包中，未上传。

请按笔记本实际 DSH/Windows 能力准备本机载体。Codex 合同、服务器账号、记忆 bank、知识库数据集和历史授权不跨运行时转移；本包不提供记忆写入器或服务连接。没有原生适配的操作标记待适配，继续无关工作；本包不执行机器级原则推广。

## Desktop 专有行为

Desktop 使用自己的 Electron 壳和原生认证/IPC。服务器 Web 的 `connection/trustedHosts`、cookie、固定 3093/43934 监听等不要覆盖到 Desktop；这些条目已从导出参考配置删除，RC3 的辅助 Web 端口只供理解原工作台归属。官方 alpha.2 Desktop 默认由 OS 分配端口，保留其原有行为。

TUI `/exit` 结束 Host；Windows Desktop 关闭窗口可能隐藏到托盘、任务继续。不要把 TUI 的关闭与 tmux 操作当作 Desktop 生命周期要求。

## 最小验收与回退

- 确认实际 Host 采用目标配置、原认证与历史仍可使用；模型列表展示预期 provider，真实短任务的实际路由与选择一致。
- 在隔离目录验证 PTC 读取、写入和有意义的工具失败；确认文件产物和最终答复，不只检查菜单。
- 各测一次任务卡执行→review→检查→confirm，以及 reject 后提示真的进入下一次执行；owned Jobs 未结束/未知时不能验收。
- 验证 Desktop 关窗/托盘、切换对话、正常退出、再次启动和会话恢复；按能力覆盖取消及外层执行事实。
- 先保存原文件和未提交改动，回退仅撤销本次修改、重建并重新启动；不删除凭据、历史、锁或生产账本。

历史验证在 `docs/VALIDATION.md`。本包导出检查通过只证明资料可复核；Windows 适配、真实模型任务和用户体验由笔记本补充验收。
