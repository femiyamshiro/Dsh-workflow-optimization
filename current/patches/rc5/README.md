# 固定源码补丁

- `core.patch`：DeepSeek Harness上游commit `b830ec950faba0a46dda564be3e2d854afed94f1`，37文件源码差异。包括实现、测试、文档，使用MIT原许可；不能对alpha.2或其它版本盲应用。
- `ops-observation.patch`：T-Auto/dsh-ops固定commit `fc11890f7668c9912fcde1df1ca89810e1cbc031` / 0.4.4源树的显式观察修复；保留MIT许可。应在源树根目录进行apply-check并按对应上游构建，不直接patch任意已打包worker。

在独立、干净、已核对commit的checkout先做`git apply --check <补丁绝对路径>`。此命令只检查适用性，实际应用/构建仍需目标侧当前授权。源码patch通过不证明npm运行包已被替换；切勿把source tree中的共享Cordis打入单个包，构建需检查跨包内联和运行时peer身份。

上游仓库：https://github.com/deepseek-ai/deepseek-harness ，https://github.com/T-Auto/dsh-ops 。本地archive checkpoint不等于上游commit。完整来源与公开变换记录见../../PROVENANCE.json。
