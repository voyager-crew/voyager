# 显式状态机：改造范围与插件路线

日期：2026-10-16；更新：2026-10-26。状态：阶段 A 已在 main 实现，并对 `verbs/`、`builtin/`、`src/pages/content/` 做过全量审计；之后 Gemini 与 AI Studio 的批量删除迁成官方插件时也用上了同一运行时，见 §3。阶段 B 未启动，启动条件见 §4。

**结论：先在包内 TypeScript 里给有生命周期的功能提供一套状态机运行时，并用四个真实模块验证（后续接入见 §3）；暂不让插件 JSON 表达状态。** 这套运行时已经承担了「按状态拥有和清理效果、事件串行、过期回调失效」这些最难的部分。以后如果真要让插件用 JSON 组合有状态的行为（阶段 B），只需要把 JSON 转移表编译成同一个 `transition` 签名，再补齐来源感知和约束修订。scripted tier（`chrome.userScripts`）被 AMO 政策挡住，不作为状态化插件的出路。

## 1. 为什么做

状态分散在多个 boolean、timer 和可空字段里时，字段之间会出现非法组合，异步回调也可能在功能已经进入下一阶段后才回来。审计找到四个有实际问题或修复历史的模块（导出选择、默认模型锁定、草稿恢复、回复通知），改造与修掉的问题见 §3。

审计后决定不改的：

| 模块                                          | 理由                                                                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/features/timeline/TimelineNavigation.ts` | `isScrolling`（程序滚动动画）和 `isNavigating`（导航队列锁）彼此正交，可以同时为真；已有 `scrollAnimationGeneration` 丢弃过期回调          |
| `src/pages/content/chatInput/vimMode.ts`      | 三个字段正交，由 `reconcileListener` 统一；模式 union 已在 `vimCommands.ts`                                                                |
| `src/features/plugins/runtime/PluginHost.ts`  | 已有 generation、opChain、ReleaseLedger，换成单一 phase 会丢信息                                                                           |
| `GoogleDriveSyncService`、`DataBackupService` | `SyncState` 部分字段会持久化，属于受保护格式；备份服务是带版本号的写队列，不是阶段流程                                                     |
| `src/features/folder/owner/`                  | 已是 command + 纯 reducer（`applyFolderOp.ts`），并由 background 作为唯一写入方                                                            |
| `src/features/plugins/verbs/` 其余 primitive  | 只是挂载/拆除加去抖，或状态本就写在 DOM 属性上（`userLatex`）。图表绘制后续接入的两阶段机器见 §3；DOM 连接和跨 activation 所有权仍独立检查 |
| `src/pages/content/` 其余模块                 | 挂载/拆除、正交的开关，或已有 generation/revision 守卫。`sidebarAutoHide`、`timestamp` 的计时器每次事件都要重新计时，不适合                |
| `builtin/` 其余官方插件、`usageStatus`        | 句柄都由 `scope.effect` 管理；`chatgptTemporaryHandoff` 是三条正交的轴；`claudeUsage` 已退役                                               |

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

阶段 A 之后接入的模块（下列内容脚本路径相对于 `src/pages/content/`）：

| 模块                                                                                        | 状态                                                                                                  | 用途                                                                                                                       | 关键测试                                                                                                                                   |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Gemini 批量删除：`batchDelete/geminiSelection.ts`                                           | `idle \| selecting \| confirming{ids} \| deleting{ids}`                                               | 关闭插件时撤掉选择 UI 和尚未接受的确认；已接受的确认冻结目标集合，删除阶段独立于选择 UI 的卸载收尾；账号或页面变化作废确认 | `invalidates a confirmation when dragging makes another chat the only selected row`、`stops account scans after confirmation is cancelled` |
| AI Studio 批量删除：`folder/aistudioLibrarySelection.ts`                                    | `idle \| selecting \| confirming \| deleting`                                                         | 同上，用于 `/library` 行；确认与删除阶段监视路由和账号上下文                                                               | `folder/__tests__/aistudioLibraryBatchDeleteReload.test.ts`                                                                                |
| 在线目录检查：`src/features/plugins/remote/hostCatalogCheckMachine.ts` / `hostCatalogCheck` | `preparing \| fetching{context} \| committing{write} \| recording{context,reason} \| settled{result}` | OFF 取消准备/拉取并丢弃迟到响应；超时中止拉取并记录失败；已开始的缓存写入收尾后释放 host，保留共享缓存                     | `src/features/plugins/remote/hostCatalogCancellation.test.ts`                                                                              |
| 站点定位数据的页面启动加载：`src/core/selectors/hydration.ts` + `service.ts`                | `reading \| settled{by, view} \| retired{view}`                                                       | 读取 catalog site data 期间更新设置变化或到截止时间，直接用内置定位数据就绪；离开页面后迟到的读取不再生效                  | `src/core/selectors/__tests__/service.test.ts`                                                                                             |

各独立页面操作及跨站点定位流程见[页面操作登记表](STATE_MACHINE_PAGE_FLOWS.md)。

`runtime.test.ts` 里「旧对话迟到的选择结果不能停掉新对话的循环」那条测试原来依赖 tick 重叠才出现第 3 次调用，现在改为先让新循环自己的选择返回，再断言循环仍在继续。

使用中发现的边界：运行时只在 `status` 变化时重启 effect。需要「同一状态重新计时」的场景（每次输入重启的去抖、重新布防的发送意图）不适合放进同一台机器；草稿恢复的做法是每个对话起一台新机器。

## 4. 阶段 B：插件 JSON 状态机（暂不启动）

启动条件、前置工作、政策判断及不走 scripted tier 的理由见[插件状态机路线](STATE_MACHINE_PLUGIN_PLAN.md)。阶段 A 的包内运行时不授权插件 JSON 表达状态或控制流。
