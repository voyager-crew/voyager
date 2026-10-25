# 显式状态机：改造范围与插件路线

日期：2026-10-16；更新：2026-10-17。状态：阶段 A 已在 main 实现，并对 `verbs/`、`builtin/`、`src/pages/content/` 做过全量审计；之后 Gemini 与 AI Studio 的批量删除迁成官方插件时也用上了同一运行时，见 §3。阶段 B 未启动，启动条件见 §4。

**结论：先在包内 TypeScript 里给有生命周期的功能提供一套状态机运行时，并用四个真实模块验证（之后又有两站批量删除共六个）；暂不让插件 JSON 表达状态。** 这套运行时已经承担了「按状态拥有和清理效果、事件串行、过期回调失效」这些最难的部分。以后如果真要让插件用 JSON 组合有状态的行为（阶段 B），只需要把 JSON 转移表编译成同一个 `transition` 签名，再补齐来源感知和约束修订。scripted tier（`chrome.userScripts`）被 AMO 政策挡住，不作为状态化插件的出路。

## 1. 为什么做

状态分散在多个 boolean、timer 和可空字段里时，字段之间会出现非法组合，异步回调也可能在功能已经进入下一阶段后才回来。审计找到四个有实际问题或修复历史的模块（导出选择、默认模型锁定、草稿恢复、回复通知），改造与修掉的问题见 §3。

审计后决定不改的：

| 模块                                               | 理由                                                                                                                                                                                                                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/timeline/TimelineNavigation.ts`      | `isScrolling`（程序滚动动画）和 `isNavigating`（导航队列锁）彼此正交，可以同时为真；已有 `scrollAnimationGeneration` 丢弃过期回调                                                                                                                                   |
| `src/pages/content/chatInput/vimMode.ts`           | 三个字段正交，由 `reconcileListener` 统一；模式 union 已在 `vimCommands.ts`                                                                                                                                                                                         |
| `src/features/plugins/runtime/PluginHost.ts`       | 已有 generation、opChain、ReleaseLedger，换成单一 phase 会丢信息                                                                                                                                                                                                    |
| `GoogleDriveSyncService`、`DataBackupService`      | `SyncState` 部分字段会持久化，属于受保护格式；备份服务是带版本号的写队列，不是阶段流程                                                                                                                                                                              |
| `src/features/folder/owner/`                       | 已是 command + 纯 reducer（`applyFolderOp.ts`），并由 background 作为唯一写入方                                                                                                                                                                                     |
| `src/features/plugins/verbs/` 其余 14 个 primitive | 只是挂载/拆除加去抖，或状态本就写在 DOM 属性上（`userLatex`）。最接近的 `codeBlockDiagram.draw()` 有 6 道 await 后检查，换成状态机只能删掉 2–3 道，其余要查 DOM 连接和跨 activation 的所有权                                                                        |
| `src/pages/content/` 其余 20 个模块                | 挂载/拆除、正交的开关，或已有 generation/revision 守卫。`sidebarAutoHide`、`timestamp` 的计时器每次事件都要重新计时，不适合                                                                                                                                         |
| `src/pages/content/researchPack/receiver.ts`       | 最接近改造：peek → 等 composer → claim → insert 的一次性流程。同类修复都在上线前同一天，之后两周没有复发，改造只省 30–40 行守卫。再出现「离开新对话页后迟到的 timer/promise 仍在动作」这类修复时，按 `peeking \| waitingComposer \| claiming \| ended{reason}` 改造 |
| `builtin/` 其余官方插件、`usageStatus`             | 句柄都由 `scope.effect` 管理；`chatgptTemporaryHandoff` 是三条正交的轴；`claudeUsage` 已退役                                                                                                                                                                        |

## 2. 运行时契约

实现与契约（纯 `transition`、按 `status` 建表的 effects、事件串行、离开状态即作废 `stay.send` / `stay.signal`、只有 `status` 变化才重启 effect、`stop()` 等待全部拆除）写在 `src/features/plugins/runtime/stateMachine.ts` 的文件头，测试在 `stateMachine.test.ts`，以代码为准，这里不再重复。

何时用哪一个：

- 功能只是挂载与拆除（样式、observer、监听、去抖），`PluginScope` 足够，关闭即整体拆除。
- 功能有一个异步结果可能比所在阶段活得更久，而且关闭或换阶段时要按阶段决定这个结果的去留，用 `startMachine`，每个阶段一个 scope，离开阶段即作废迟到的回调。例子：批量删除（确认中、执行中）、导出选择、默认模型锁定。
- 只给真正有阶段、会被打断的那条轴建状态机。彼此正交的维度（例如草稿的「恢复」「保存去抖」「发送意图」）不要强行合并成一个 union。

## 3. 阶段 A：已做的改造

| 模块                                                                            | 状态                                                                                                   | 修掉的问题                                                                                                                                                      | 关键测试                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 导出选择：`exportSelectionMachine.ts` + `exportSelectionSession.ts`（只管 DOM） | `selecting \| resolvingRoles{role} \| confirming \| exporting \| ended{reason}`                        | 等待截图权限期间第二次点 Export 不再启动第二次导出；点 Export 后选择被冻结；`onConfirm` 不取选择就返回时也会先移除 UI；刷新不再把已解析的 role 覆盖回 `unknown` | `second Export click during the permission wait does not start a second export`、`checkbox clicks after Export do not change the exported selection`、`done does not resolve while the selection bar is still mounted` |
| 默认模型锁定：`autoApplyMachine.ts` + `autoApply.ts`                            | `idle \| checking \| locking{attempt, failures, pick, model, thinking} \| satisfied \| gaveUp{reason}` | 改为上一个 tick 结束后才排下一个，tick 不再重叠，#761 的连续拒绝计数不会被清零；所有计数只在 transition 里改                                                    | `an overlapping lock tick does not reset the rejected-switch back-off`、`a slow menu does not let two lock ticks run at once`                                                                                          |
| 草稿恢复：`draftSessionMachine.ts` + `session.ts`                               | 每个对话一台：`waiting \| loading{touched} \| writing{retriesLeft} \| settled{outcome}`                | 6 参数守卫换成状态和 `touched` 事件；重试耗尽成为可区分的 `settled{exhausted}`。保存去抖和发送意图是正交的两条轴，保持原样                                      | `a late draft load does not refill a composer cleared after it started`、`exhausted restore retries leave the session settled`                                                                                         |
| 回复通知：`completionMachine.ts`，Gemini 与 ChatGPT 的 `run.ts` 共用            | 每轮生成一台：`streaming \| notifying \| deferred \| showing \| ended{reason}`                         | 开新一轮就停掉上一台，旧的回退 toast、stop 和网络已处理标记随之失效；删掉 `notifyEpoch`、两个 flush 函数和常驻 focus 监听。检测逻辑留在各自的 run 里            | `a deferred fallback toast does not fire once the next generation has started`、`a prompt sent right after stop is not silenced`、`a page-only generation after a network-owned one still notifies`                    |

阶段 A 之后接入的模块（两站批量删除、Gemini 在线修复）：

| 模块                                                               | 状态                                                                                                                          | 用途                                                                                                                       | 关键测试                                                                                                                                   |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Gemini 批量删除：`batchDelete/geminiSelection.ts`                  | `idle \| selecting \| confirming{ids} \| deleting{ids}`                                                                       | 关闭插件时撤掉选择 UI 和尚未接受的确认；已接受的确认冻结目标集合，删除阶段独立于选择 UI 的卸载收尾；账号或页面变化作废确认 | `invalidates a confirmation when dragging makes another chat the only selected row`、`stops account scans after confirmation is cancelled` |
| AI Studio 批量删除：`folder/aistudioLibrarySelection.ts`           | `idle \| selecting \| confirming \| deleting`                                                                                 | 同上，用于 `/library` 行；确认与删除阶段监视路由和账号上下文                                                               | `folder/__tests__/aistudioLibraryBatchDeleteReload.test.ts`                                                                                |
| Gemini 在线修复的后台检查：`geminiSelectorFixes/checkMachine.ts`   | `idle \| preparing{force} \| fetching{attemptedAt} \| committing{file, withdrawn} \| recording{result} \| reporting{outcome}` | 关闭开关或超时退出 preparing/fetching，迟到的响应被丢弃；committing 中关闭只记下 withdrawn，写完再删缓存，检查时间照样记下 | `does not cancel the check a quick OFF then ON started when the OFF event arrives late`                                                    |
| Gemini 选择器的页面启动加载：`core/gemini/selectors/hydration.ts`  | `reading \| settled{by, view} \| retired{view}`                                                                               | 读缓存期间授权变化或到截止时间，直接用内置选择器就绪；离开页面后迟到的读取不再生效                                         | `does not adopt an old ON read if consent changed while storage was pending`                                                               |
| Gemini 在线修复的弹窗：`popup/hooks/geminiSelectorFixesMachine.ts` | `loading{checkAfter} \| idle \| checking{force} \| saving{enabled}`                                                           | 每个来源标签页一台；其他弹窗关掉开关后，迟到的 ON 读取不再显示或触发检查                                                   | `does not show or check a stale ON read answered after another popup turned it off`                                                        |

`runtime.test.ts` 里「旧对话迟到的选择结果不能停掉新对话的循环」那条测试原来依赖 tick 重叠才出现第 3 次调用，现在改为先让新循环自己的选择返回，再断言循环仍在继续。

使用中发现的边界：运行时只在 `status` 变化时重启 effect。需要「同一状态重新计时」的场景（每次输入重启的去抖、重新布防的发送意图）不适合放进同一台机器；草稿恢复的做法是每个对话起一台新机器。

## 4. 阶段 B：插件 JSON 状态机（暂不启动）

做法：允许打包官方插件和用户本地导入插件声明 `states` / `events` / `transitions`；action 只能引用可逆的 `domOps` 和已有 primitive，guard 只能引用具名谓词。JSON 表编译成 §2 的 `transition` 签名，复用同一个运行时。

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
- 能成立的只有「用户自行导入 JS，仅支持 Chrome/Edge」这一种形态，粗估 14–20 工程日，用户门槛高，目前没有需求证据。
