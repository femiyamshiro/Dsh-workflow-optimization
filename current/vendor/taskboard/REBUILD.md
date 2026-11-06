# Runtime与重建边界

本目录保留实际rc.5本地修订的runtime JS与源码。公开派生package.json删除了不存在的lib/types声明入口，以及尚未资格化的build/watch/typecheck脚本；只保留JS入口和check:syntax。没有伪造声明文件。TypeScript消费者需要在自己的目标环境生成/适配类型。

build-reference/中的原公开上游参考配置与运行包分开：tsdown.config.ts来源Git blob fee418f31cfab0afbc97e0a33f96eddabadd0139，tsconfig.json来源9fd75f51b0ffb8111762652aa4fe15789be21138，均来自kira905/dsh-task-board-local。它们没有在此次公开包中执行或证明rc.5/Win11可复现构建，不能从archive自动补全。

重建前保留lib/local-workflow.js与lib/host-adapter.js及已验收JS。核对目标API、类型生成、客户端注册ID、外部依赖和clean:false语义，再在独立副本建立自己的构建配置和验证；不要先清空lib或将缺失types解释为已验证声明。
