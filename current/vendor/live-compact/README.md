# Live Compact 固定rc.5本地修复

源自MerkyorLynn/dsh-live-compact@c50c58b00cf8545c6524272563f99bc7f2779384，MIT原许可保留。版本1.0.7-rc5.local.20261105；不是上游新发布，peer/engine仅资格化0.2.1-rc.5。目标侧应用前先读仓库CURRENT与MACHINE-HANDOFF。

修复：原生事务/flush失败、标准compact-checkpoint、完整注入来源保护、scope ancestry owner、共同容量锁/drop-new，以及真实长行命中附近的有界摘录。默认KEEP_ROUNDS=3、Thunder关闭、合作写者st_size上限256MiB。小切发生在完成turn后的idle；额外shadow不备份显式reasoning/thinking。持久化不确定先核对日志再重启Host取得fresh engine，不盲删或重试。

native-helper属于许可内固定私有实现vendoring，不是上游公共导出；来源/哈希见native-helper/PROVENANCE.md。Node-only备份测试依赖固定rc.5 peer环境；根verify-current只做公开资料的完整性/结构检查，不运行本插件或其CLI。

公开包metadata把上游commit与本地archive checkpoint分开，运行时代码保持原修复；具体变换见current/PROVENANCE.json。运行验证与适用边界见current/docs/VALIDATION.md。
