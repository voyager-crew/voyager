# 开发环境设置

## 安装依赖

```bash
bun install
```

## 可用命令

| 命令                  | 描述                                                                     |
| --------------------- | ------------------------------------------------------------------------ |
| `bun run dev`         | 启动 Chrome 开发模式（自动重新构建，扩展自行重载；不重载已打开的标签页） |
| `bun run dev:firefox` | 启动 Firefox 开发模式                                                    |
| `bun run dev:safari`  | 启动 Safari 开发模式（仅 macOS）                                         |
| `bun run build`       | Chrome 生产构建                                                          |
| `bun run build:edge`  | Edge 独立构建与打包                                                      |
| `bun run build:all`   | Chrome + Firefox + Safari 构建                                           |
| `bun run lint`        | 运行 oxlint 并自动修复                                                   |
| `bun run typecheck`   | 运行 TypeScript 类型检查                                                 |
| `bun run test`        | 运行测试套件                                                             |
| `bun run verify:pr`   | 标准本地 PR 自动验证                                                     |

## 加载扩展

1. 运行 `bun run dev` 启动开发构建
2. 打开 Chrome，访问 `chrome://extensions/`
3. 启用"开发者模式"
4. 点击"加载已解压的扩展程序"，选择 `dist_chrome_dev` 文件夹

---
