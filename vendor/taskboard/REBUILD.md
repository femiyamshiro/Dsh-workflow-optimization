# 构建参考与当前产物

本目录的 src、lib、package.json 来自服务器实际采用的 1.1.5 本地修订，未在导出时重新构建。原发布包没有携带构建配置；本次补充下列可核验的上游文件，供笔记本 Codex 保留正确的浏览器包装、外置依赖与注册 ID 后适配。

- `tsdown.config.ts`：kira905/dsh-task-board-local Git blob `fee418f31cfab0afbc97e0a33f96eddabadd0139`。
- `tsconfig.json`：同仓 Git blob `9fd75f51b0ffb8111762652aa4fe15789be21138`。

来源是 GitHub 原始不可变 blob，内容未经执行。包装 ID 为 `@kira905/dsh-task-board-local`，外置 host-adapter.js，`clean:false`。构建参考的加入不证明其已在本地修订、alpha.2 或 Windows 上构建通过。

本地修订在 src 中导入 `../lib/local-workflow.js`，另有 `lib/host-adapter.js` 运行时辅助文件；它们是本包中的必要源码，不要在重建前清空 lib。先保存已验证产物，再在独立副本核对 package scripts、TypeScript 类型、依赖及客户端加载 ID。依赖安装和构建采用目标平台原生工具，不复用 Linux node_modules。

本次没有执行 npm/pnpm install 或 build。缺少 d.ts 生成规则、目标 API 类型适配或打包规则时，应明确补齐并验证，不以现存构建脚本就推断可复现构建。保留原许可证及 NOTICE。
