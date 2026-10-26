# 页面操作的状态机

这些流程使用[状态机运行时契约](STATE_MACHINE_PLAN.md#2-运行时契约)，路径相对于 `src/pages/content/`。

| 模块 / machine id                                                             | 状态                                                   | 责任与退出条件                                                                 | 行为测试                                                                                            |
| ----------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `prompt/promptPageScope.ts` / `promptScopedRead`                              | `reading \| ready{value} \| retired`                   | 提示词读取只交给发起操作的页面；路由、已知账号或调用方取消后丢弃结果           | `prompt/__tests__/promptPageScope.test.ts`、`promptHistory/__tests__/captureCancellation.test.ts`   |
| `prompt/promptPageScope.ts` / `promptSendReplay`                              | `waiting \| retired`                                   | 发送重放保持原来的零延时顺序；导航或 destroy 清掉待执行 timer                  | `prompt/__tests__/promptPageScope.test.ts`                                                          |
| `prompt/scopedTemplateFill.ts` / `promptTemplateFill`                         | `open \| submitted{value} \| closed`                   | 模板打开时才监听账号与路由；提交、关闭后释放监听，防止空闲页面扫描             | `prompt/__tests__/slashAccountScanning.test.ts`                                                     |
| `folder/gemini/activityLifetime.ts` / `folderActivitySend`                    | `pending \| complete`                                  | 等 native handler 接受事件后记录 activity；route/account 变化不继承旧发送      | `folder/__tests__/activityCancellation.test.ts`                                                     |
| `folder/gemini/activityLifetime.ts` / `folderActivityTracking`                | `loading \| active \| idle{reason}`                    | 初始化可被页面退出取消；失败等待显式重试，迟到结果不重新挂 listener            | `folder/__tests__/activityCancellation.test.ts`、`folder/__tests__/activityStartup.test.ts`         |
| `folderProject/pendingSend.ts` / `folderProjectPendingSend`                   | `idle \| pending`                                      | 首次发送意图最多保留 60 秒；新意图先 clear，页面或账号退出时清除               | `folderProject/__tests__/folderProject.session.test.ts`                                             |
| `folderProject/pickerWork.ts` / `folderProjectPickerWork`                     | `running \| complete`                                  | picker mount/load 绑定 route/account；取消后停止等待挂点，旧结果不能恢复 UI    | `folderProject/__tests__/pickerCancellation.test.ts`                                                |
| `export/menuLifetime.ts` / `onlineConversationMenuAction`                     | `open \| ended`                                        | remote 菜单绑定原 trigger、对话、账号和按钮；关闭时移除按钮                    | `export/__tests__/onlineMenuActionLifetime.test.ts`                                                 |
| `export/menuLifetime.ts` / `conversationMenuInjection`                        | `waiting \| running \| ended`                          | 每次延迟插入独占 timer；关闭菜单或退出后不向复用的 panel 插入                  | `export/__tests__/onlineMenuActionLifetime.test.ts`、`export/__tests__/onlineMenuQueryWork.test.ts` |
| `gemsSidebar/pinRead.ts` / `gemsPinRead`                                      | `reading \| applying{pinned} \| done \| failed{error}` | 读取 pins 后只更新原账号页面；同账号导航保留结果，停止或异常完成调用方 Promise | `gemsSidebar/__tests__/pinReadLifetime.test.ts`                                                     |
| `src/features/plugins/verbs/codeBlockDiagramDraw.ts` / `codeBlockDiagramDraw` | `preparing \| rendering \| settled`                    | 库加载与渲染分阶段；teardown 使旧结果失效，DOM owner 另行校验                  | `src/features/plugins/verbs/codeBlockDiagramOnline.test.ts`                                         |

## 跨站点定位流程

| 模块 / machine id                                                                        | 状态                                              | 责任                                                             |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------- |
| `src/features/plugins/verbs/folders/aistudio/panelAnchorWait.ts` / `aistudioPanelAnchor` | `waiting \| settled{anchor}`                      | 等待导航挂点与 panel 生命周期绑定，退出后不接受迟到挂点。        |
| `researchPack/receiverMachine.ts` / `researchPackReceiver`                               | `peeking \| waitingComposer \| claiming \| ended` | pack 只插入发起交接的页面和 composer，离页或取消后丢弃迟到结果。 |
| `src/features/plugins/sends/pendingSend.ts` / `catalogUserSend`                          | `pending \| ended{sent}`                          | 发送观察窗口属于原对话；离页、超时或取消后不记录后续对话的消息。 |
