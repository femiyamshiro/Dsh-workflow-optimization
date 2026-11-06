# 机器与笔记本交接

## 唯一默认入口

读取根CURRENT.json，运行`node tools/verify-current.mjs`，按entryPoints读取current文档。归档只是历史证据，没有自动回退或“找到哪个配置就用哪个”的机制。CURRENT与清单不一致应停止应用，先核对仓库是否完整；不用归档填补缺件。

## Win11 Desktop alpha.2

该环境可以读取完整架构与策略，但**当前rc.5原生补丁、peer门禁及profile不能原样覆盖Desktop alpha.2**。交给目标侧编码助手：确认实际commit/版本与桌面profile发现方式；对照公开源码找对应API；单独适配工具/模型选择、会话投影、插件peer、桌面启动/关闭与持久化。版本声明修改、菜单出现或解析成功均不代替实际测试。

可以运行`node tools/verify-current.mjs --dsh-version 0.2.1-alpha.2`得到明确的adaptation_required（退出2）；这表示原生应用不匹配，不影响读取设计。对固定rc.5运行同一检查应退出0。Windows本身不从本仓库获得Linux运行验收。

## 固定rc.5的接入顺序

1. 保留目标侧原生备份与账号，不复制服务器DSH_HOME、OAuth或Electron userData。记录当前会话writer/ledger writer与进行中任务。
2. 根据PROVENANCE取得固定官方源码b830ec…，先在干净checkout上`git apply --check current/patches/rc5/core.patch`；按官方构建流程形成自己的独立runtime。OPS补丁应用于其固定上游源，说明见patches/rc5/README.md。此仓库没有预编译全运行时，也不自动安装。
3. 仅把profiles下.reference文件作为合成参考，保留自己的模型、MCP、认证及自定义字段。示例模型地址需要填写，key通过已有环境/凭据服务提供。保证所有present framework peers解析到同一runtime，不能从旧安装借另一个Cordis。
4. 版本/配置/模块载入通过后，使用独立合成workspace检查PTC工具、完整规则、Web鉴权/流连接、TUI和多turn压缩回读。分别验证当前Host和重启后恢复。
5. 目标自己完成验收后，才让其日常入口指向新release。不得把参考资料加载成功标成部署完成。

## 文件说明

- `profiles/rc5-web`：保留Web与上下文/OPS/压缩层，不再增加第二个TaskBoard writer。
- `profiles/rc5-tui`：工作台TUI、其辅助Web与单写者TaskBoard。
- `vendor/live-compact`：可审阅的本地修复源码及许可，固定rc.5，未发布为新上游版本。
- `vendor/taskboard`、`vendor/session-toolkit`：固定本地修订；完整许可证与源文件保留，不包含node_modules或业务数据。TaskBoard只提供已有runtime JS和审阅源码；缺失的类型入口/未资格构建脚本已移除，重建边界见vendor/taskboard/REBUILD.md。

默认示例不带可直接覆盖账号的文件，不启动服务、不开端口、不调用模型，也不运行旧版CLI归档工具。
