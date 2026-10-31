# alpha.2 补丁使用

`core.patch` 的基线是 `base.json` 中的官方提交；该文件包含跟踪文件差异和新增 managed-range 测试，SHA 绑定见清单。先运行 `git apply --check /本包路径/patches/alpha2/core.patch`；目标不同提交需要先重新评估，不能强行忽略失败或 reset 现有改动。代码、文档和录制测试夹具共同保留，未包含生产会话。

`plugins-compat.patch` 来自插件独立副本，路径前缀为 before/ 与 after/；在包含相应插件目录的父目录使用 `git apply -p1 --check` 核对。TUI 文件为发布包 JS，不是完整上游源码分支。具体前置版本/可选项在 plugin-bases.json，版本号的实验后缀不表示正式支持。

南米插件的直接前置版本是本地 `0.1.23+rc3.dual.1`，不是普通 npm `0.1.23`。如需要此可选插件，先把 `nanmi-rc3-preimage.patch` 应用到经过 integrity 核对的 npm 0.1.23，再应用 plugins-compat.patch 的对应 stanza。该两段链已在临时副本上 forward-check 并比较最终文件与现有 alpha 副本经公开版路径脱敏后的对应内容，详见 nanmi-preimage-provenance.json；没有安装或启动插件。调试 sourcemaps 不在此补丁链更新范围，调试前需在目标侧核对。

旧补丁中 OPS 0.4.1 的 stanza 已排除。当前 OPS 0.4.4 的原始 worker 需要匹配原始包版本与 SHA；实验元数据单独参考 `ops-0.4.4.package.reference.json`，不要把旧 patch 施加到 0.4.4。

本包不自动应用任何补丁。先定位笔记本 Desktop 真正使用的核心、插件目录和输出，再由本机 Codex 做兼容、构建、验收和回退安排。
