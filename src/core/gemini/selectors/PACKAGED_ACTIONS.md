# Gemini locator trust ledger (5/5)

Part of the [complete trust ledger](../../selectors/PACKAGED_DATA.md). A = action/data/identity proof; B = trusted Voyager UI placement; §6 = packaged protocol. `bundle copy` preserves baseline literals for the named online counterpart. `legacy adapter` retains the pre-branch override path, including OFF semantics. Keys refer to this site’s selector-data fragments or semantic site fields; duplicate source copies share one row.

Parts: [1](PACKAGED_DATA.md), [2](PACKAGED_SURFACES.md), [3](PACKAGED_CONTENT.md), [4](PACKAGED_INPUT.md), [5](PACKAGED_ACTIONS.md).

| Key                       | Tier / delivery | Reason                                                                                                                                                |
| ------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sidebar.notebooks`       | B / online      | Only chooses the Voyager folder-panel or notebook-anchor-toggle insertion slot.                                                                       |
| `sidebar.openHost`        | A / online      | Also governs host sidebar state/selection; independent native ownership must agree.                                                                   |
| `sidebar.overflow`        | A / online      | Also scopes conversation rows used by folders; native sidebar/row ownership must agree.                                                               |
| `sidebar.pageTitle`       | A / online      | Supplies persisted/exported title; title must equal the sidebar link for the current conversation ID.                                                 |
| `sidebar.recents`         | B / online      | Only chooses the Voyager folder-panel or notebook-anchor-toggle insertion slot.                                                                       |
| `sidebar.row`             | A / online      | Scopes saved conversation IDs, titles or navigation; complete native URL/row identity must agree.                                                     |
| `sidebar.rowContainer`    | B / online      | Only chooses the Voyager folder-panel or notebook-anchor-toggle insertion slot.                                                                       |
| `sidebar.scroller`        | A / online      | Drives host history pagination; must independently own the proved conversation rows.                                                                  |
| `sidebar.section`         | B / online      | Only chooses the Voyager folder-panel or notebook-anchor-toggle insertion slot.                                                                       |
| `sidebar.title`           | A / online      | Supplies saved conversation titles; native title evidence and row identity must agree.                                                                |
| `sidebar.titleFallback`   | A / online      | Supplies saved conversation titles; native title evidence and row identity must agree.                                                                |
| `sidebar.toggleButton`    | A / online      | Clicks the host sidebar toggle; aria-controls/expanded must bind it to the proven sidenav.                                                            |
| `sidebar.visibilityHost`  | A / online      | Also governs host sidebar state/selection; independent native ownership must agree.                                                                   |
| `sidebarHover.dialogs`    | A / online      | Controls host sidebar interaction timing; independent native dialog/menu ownership must agree.                                                        |
| `sidebarHover.menus`      | A / online      | Controls host sidebar interaction timing; independent native dialog/menu ownership must agree.                                                        |
| `sidebarWidth.buttons`    | B / online      | Geometry probes place Voyager width UI; native click targets are proved separately.                                                                   |
| `sidebarWidth.candidates` | B / online      | Geometry candidates only place Voyager width UI; native click targets are proved separately.                                                          |
| `sidenav`                 | §6 / packaged   | Native sidenav grammar supplies independent toggle and sidebar ownership evidence.                                                                    |
| `slash.candidates`        | A / online      | Receives expanded saved prompts; independent native editor ownership proves the input.                                                                |
| `timeline.userText`       | A / online      | Supplies stored timeline text; normalized text must belong to the proved user turn.                                                                   |
| `title.active`            | A / online      | Supplies saved active title; must equal the sidebar title for the current conversation ID.                                                            |
| `title.activeExport`      | A / online      | Supplies exported active title; must equal the sidebar title for the current conversation ID.                                                         |
| `title.activeResearch`    | A / online      | Supplies saved research title; must equal the sidebar title for the current conversation ID.                                                          |
| `title.export`            | A / online      | Supplies exported title; must equal the sidebar title for the current conversation ID.                                                                |
| `titleEvidence`           | §6 / packaged   | Native Gem URL/row/source evidence or exclusion supplies independent Gem ownership proof.                                                             |
| `toggleButton`            | A / bundle copy | Clicks the host sidebar toggle; aria-controls/expanded must bind it to the proven sidenav. Online counterpart: `sidebar.toggleButton`.                |
| `toggleHost`              | A / packaged    | Scopes host sidebar toggle clicks; independent ARIA association must prove its control.                                                               |
| `toggleIcon`              | §6 / packaged   | Native toggle-icon vocabulary is independent state/action evidence.                                                                                   |
| `toggleLegacyHost`        | §6 / packaged   | Native legacy toggle fallback is independent action evidence.                                                                                         |
| `topNav`                  | §6 / packaged   | Native Gem URL/row/source evidence or exclusion supplies independent Gem ownership proof.                                                             |
| `turn.assistant`          | A / online      | Binds stored/exported content to turn identity; complete native membership/order must agree.                                                          |
| `turn.assistantFallback`  | A / online      | Binds stored/exported content to turn identity; complete native membership/order must agree.                                                          |
| `turn.assistantWithHosts` | A / online      | Binds stored/exported content to turn identity; complete native membership/order must agree.                                                          |
| `turn.user`               | A / online      | Binds stored/exported content to turn identity; complete native membership/order must agree.                                                          |
| `turn.userWithHosts`      | A / online      | Binds stored/exported content to turn identity; complete native membership/order must agree.                                                          |
| `turns`                   | B / bundle copy | Turn-shaped layout probe only places Voyager export UI; it supplies no turn data. Online counterpart: `exportLayout.turns`.                           |
| `usage.root`              | A / online      | Supplies cached usage figures; native header/bucket evidence proves the complete owner.                                                               |
| `userLatex.lines`         | A / online      | Transforms user formula content; independent native user-turn/source evidence is required.                                                            |
| `userTurn`                | A / packaged    | Native semantic evidence stays independent; specific turn/composer/code profiles repair consumers, while another semantic source cannot prove itself. |
| `vim.candidates`          | A / online      | Selects the editor changed by Vim; requires native editor ownership.                                                                                  |
| `vim.configuredComposer`  | A / online      | Selects the editor changed by Vim; native composer ownership must agree.                                                                              |
| `vim.crossSiteEdit`       | §6 / packaged   | Native cross-site edit exclusion remains independent of repairs.                                                                                      |
| `vim.editActions`         | §6 / packaged   | Save/cancel action grammar identifies an edit session.                                                                                                |
| `vim.editForm`            | §6 / packaged   | Native inline-edit form association is the write protocol.                                                                                            |
| `vim.editInputs`          | §6 / packaged   | Native inline-edit grammar governs focus and keyboard ownership.                                                                                      |
| `vim.editable`            | §6 / packaged   | Native editable grammar governs keyboard and write behavior.                                                                                          |
| `vim.host`                | B / online      | Composer host only mounts the Voyager Vim HUD.                                                                                                        |
| `vim.hud`                 | B / packaged    | Baseline Tools-button decoration and ordered fallbacks cannot use the shared non-interactive mount rule.                                              |
| `vim.inputFallback`       | B / online      | Only the matched node’s parent is used as a HUD mount.                                                                                                |
| `vim.mountChatInput`      | B / online      | Chat-input probe only chooses a Voyager HUD mount.                                                                                                    |
| `vim.mountChatRoot`       | B / online      | Chat-root probe only chooses a Voyager HUD mount.                                                                                                     |
| `vim.mountInput`          | B / online      | Input-relative probe only chooses a Voyager HUD mount.                                                                                                |
| `vim.mountRoot`           | B / online      | Root-relative probe only chooses a Voyager HUD mount.                                                                                                 |
| `vim.sendTarget`          | §6 / packaged   | Native send/save control grammar is an interaction protocol.                                                                                          |
| `weekly`                  | A / packaged    | Cached weekly usage uses native value/label grammar; arbitrary numbers cannot prove this metric.                                                      |
| `widthButtons`            | B / bundle copy | Button geometry only places Voyager width UI; host action proof remains separate. Online counterpart: `sidebarWidth.candidates`.                      |
| `widthIcon`               | §6 / packaged   | Native toggle-icon identity is fixed host interaction protocol.                                                                                       |
