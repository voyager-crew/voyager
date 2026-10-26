# 插件 JSON 状态机与 scripted tier

[运行时契约和已实现流程](STATE_MACHINE_PLAN.md#2-运行时契约)记录在主计划中。本文件保留尚未启动的阶段 B 方案及政策判断。

## 4. 阶段 B：插件 JSON 状态机（暂不启动）

做法：允许打包官方插件和用户本地导入插件声明 `states` / `events` / `transitions`；action 只能引用可逆的 `domOps` 和已有 primitive，guard 只能引用具名谓词。JSON 表编译成[运行时契约](STATE_MACHINE_PLAN.md#2-运行时契约)的 `transition` 签名，复用同一个运行时。

**启动条件（满足其一）**：

- 有具体的用户或作者需求，要求不发版就能组合现有积木做出带条件、多步骤的行为。2026-10-15 搜索 issue 和讨论没有这类需求，最接近的 #322（排队输入）已以 `NOT_PLANNED` 关闭。
- 三个以上官方 primitive 出现同构的状态流程，用数据描述比各写一份 TS 更清楚。

**前置工作（阶段 A 不会顺带完成）**：

1. 来源感知：`PluginHost` 通过 `listPluginManifests`（`sources/defaultSources.ts`）取清单，它把 `listPluginManifestsWithSources` 带出的 `sourceId` 丢掉了，`PluginHost` 和 `DeclarativeEngine.mount` 都拿不到来源。需要把来源传到校验和挂载阶段。
2. 远程覆盖：远程目录在生产构建中默认开启（`vite.config.base.ts` 的 `VOYAGER_PLUGIN_CATALOG_REMOTE`），`mergePluginRecords` 会让兼容的同 id 远程记录替换打包的 catalog 版，而 `validateManifest` 只拷贝已知字段、静默丢弃未知字段。带状态机的插件必须禁止被远程覆盖，否则状态机会悄悄消失。
3. 修订 [remote/DECISIONS.md](../../src/features/plugins/remote/DECISIONS.md) 的 C1，并同步本地导入 gate 的原则「the remote catalog's gate plus local-only rules, never a weaker one」（`local/validateLocalManifest.ts` 文件头）。
4. engine 改为按状态记账：现在 ledger 按插件释放（`DeclarativeEngine.releasePlugin`），`reapplyNow` 会重放全部 op，health monitor（`trackHealth` / `healthSample`）会把停在空闲态的插件误报为无效果。
5. action 白名单只收可逆操作。允许 click、send、navigate 会破坏 `DomOperation` 的可逆契约（`types.ts` 里该类型的注释），与来源无关。

**政策判断**：

- Chrome：禁止的是「Building an interpreter to run complex commands fetched from a remote source, even if those commands are fetched as data」（https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements ）。打包的 JSON 随代码一起提交，问题不大；本地导入没有明确豁免，存在「full functionality … easily discernible from its submitted code」的解释风险。远程目录一律拒绝。
- Firefox AMO：要求「self-contained and not load remote code for execution」，审核即拒表里没有解释器条目（https://extensionworkshop.com/documentation/publish/add-on-policies/ ）。
- Safari：App Store Review Guidelines 2.5.2 禁止下载、安装、执行会引入或改变功能的代码，本地导入有解释空间，未验证。
- 先例：Automa（JSON workflow 导入，带条件和循环，MV3 在架）、UI.Vision RPA（宏支持 if/while）、uBO Lite（本地自定义过滤放开，远程收紧）。

## 5. 不走 scripted tier 的原因

- AMO 原文：「Usage of the `userScripts` API is allowed for user script managers only」，并且「cannot be used to extend or modify the functionality of the user script manager itself」。Voyager 不是脚本管理器。
- Chrome：只允许运行用户自己提供的脚本，不能通过目录分发第三方 JS。Chrome 138 起需要用户为每个扩展单独打开「Allow User Scripts」开关；Safari 没有等价 API。
- 能成立的只有「用户自行导入 JS，仅支持 Chrome/Edge」这一种形态，粗估 14 至 20 工程日，用户门槛高，目前没有需求证据。
