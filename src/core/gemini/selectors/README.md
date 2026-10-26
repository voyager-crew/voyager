# Gemini page detection data

These Gemini profiles serve `https://gemini.google.com` and
`https://business.gemini.google` through the [shared per-site resolver](../../selectors/README.md). Its online profiles come
from the existing plugin catalog, governed by **Online updates** (on by default).
Every supported site uses that one channel. Transport, settings and cache
ownership are described in the [remote catalog README](../../../features/plugins/remote/README.md#page-locator-profiles-in-site-data).

## Catalog site data

Each Gemini host has its own `/catalog/hosts/<host>.json` file with the same
Gemini locator data.
Its optional `site.locators` section is a map of profile keys to nonempty ordered
string arrays. Missing keys use the bundle; supplied arrays replace their entire
profiles, preserving order. A newer host file with no `site.locators`, or an empty
map, withdraws the profiles on the next page load.

[`types.ts`](types.ts) owns the literal 75-key `GEMINI_SELECTOR_PROFILE_KEYS`
allowlist. The catalog publisher and site-data validator use the same contract,
checked by [`catalog-locator-publishing.test.ts`](../../../../scripts/__tests__/catalog-locator-publishing.test.ts).
The locator section retains the Gemini limits: 65,536 UTF-8 bytes, at most 32
entries per profile and 2,048 UTF-16 code units per string, with empty strings and
non-whitespace C0 controls rejected. Unknown keys and oversized sections fall back to the bundle without
invalidating the adapter, plugins or kill switch. A malformed or unparsable
locator drops only its surface’s group.

The builder reads the same selected non-`*-packaged.json` source fragments as
[`bundle.ts`](bundle.ts). Catalog publication uses the main lineage’s first-parent
commit count. The resolved remote adapter wins only if its `catalogRevision` is
strictly newer than the bundle. Cache writer-version checks, refresh, withdrawal
and account boundaries use the catalog’s existing machinery. There is no separate
fetcher, opt-in setting or selector cache.

## Groups and consumers

[`GEMINI_SELECTOR_PROFILE_GROUPS`](types.ts) defines native-syntax fallback boundaries.
One unparsable locator drops its entire group without dropping another surface.
The source directory is
[`catalog/sites/gemini/selector-data`](../../../features/plugins/catalog/sites/gemini/selector-data).

| Source fragment         | Group                                                           | Consumers                                                                                                       |
| ----------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `turn.json`             | `turn.*`                                                        | Timeline, export, highlight, fork, timestamps, reply notifications, selection toolbar and semantic turn queries |
| `sidebar.json`          | `sidebar.*`                                                     | Sidebar discovery, folder mounts and rows, navigation, auto-hide and fork sidebar discovery                     |
| `model-picker.json`     | `modelPicker.*`                                                 | Default model menu discovery, model/thinking reads and focus target                                             |
| `composer.json`         | `composer.*`                                                    | Main and inline edit inputs, draft targets, send containers and notification reads                              |
| `input-collapse.json`   | `inputCollapse.wrapper`                                         | Input collapse host                                                                                             |
| `vim.json`              | `vim.*`                                                         | Configured wrapper and candidate input resolution                                                               |
| `prompt-history.json`   | `promptHistory.candidates`                                      | Prompt capture                                                                                                  |
| `slash.json`            | `slash.candidates`                                              | Slash command input                                                                                             |
| `sent-chips.json`       | `sentChips.bubbles`                                             | Sent prompt preview hosts                                                                                       |
| `project.json`          | `project.inputs`                                                | Folder as Project input discovery                                                                               |
| `activity.json`         | `activity.inputs`                                               | Folder activity input discovery                                                                                 |
| `menu.json`             | `menu.*`                                                        | Conversation/export menu panels and content                                                                     |
| `menu-overlay.json`     | `exportOverlay.*`                                               | Canvas/composer alignment targets for the export selection bar                                                  |
| `sidebar-width.json`    | `sidebarWidth.buttons`                                          | Sidebar button hit targets                                                                                      |
| `sidebar-hover.json`    | `sidebarHover.*`                                                | Dialog/menu exclusions during sidebar hover                                                                     |
| `gems.json`             | `gems.navEntry`, separately the remaining `gems.*` catalog keys | Active Gems sidebar entry and catalog scrape                                                                    |
| `content.json`          | `content.*`                                                     | Answer/user text for export, fork, quotes and turn text                                                         |
| `context-images.json`   | `context.images`                                                | Context image collection                                                                                        |
| `response-actions.json` | `responseActions.bars`                                          | Image export action placement                                                                                   |
| `research-pack.json`    | `researchPack.actionBars`                                       | Research-pack action placement                                                                                  |
| `usage.json`            | `usage.root`                                                    | Usage display owner                                                                                             |
| `code.json`             | `code.host`                                                     | Code collapse, diagrams, copy/export and semantic diagnostics                                                   |
| `user-latex.json`       | `userLatex.lines`                                               | LaTeX paragraphs within the original user turn                                                                  |
| `image-export.json`     | `imageExport.searchHosts`                                       | Search result images in exports and fallback alt text                                                           |
| `generated-image.json`  | `generatedImage.downloadIcon`                                   | Generated image download icon within its original button                                                        |
| `canvas-code.json`      | `canvas.codePanels`                                             | Canvas code panel, binding title and content to one owner                                                       |

## Page and operation ownership

The content-script claim starts hydration before send-key coordination, PluginHost
or native features. Hydration is a `startMachine` flow with a 250 ms deadline.
Catalog settings changes during a pending read, an error or the deadline settle on the
bundle; late results cannot replace that decision. Once ready, the page snapshot
stays fixed until its claim ends. New downloads and turning the switch off take
effect after a user refresh, without automatic reload or remount.

Reads are pure until the consumer accepts a complete operation. A nonempty result
alone is insufficient. A partial collection, different DOM order, conflict with an
independent native/bundled check, or an element other than the operation's original
target falls back to the bundled read for the whole operation. No rejected read may
click, insert, send, export, download or persist anything. Checks introduced for
online data run only when that surface has remote keys, preserving the bundled
path with the switch off.

Remote turn winners never enter the legacy saved Auto selector. Unknown remote
turn spellings use the packaged conversation observer scope. Collapse scans,
mutation flushes and resize measurements each keep one accepted read session.
Vim preserves configured-wrapper-to-editable order and hidden fallback; its HUD
uses the accepted composer. Gems scraping cannot prune pins or recent Gems from a
remote list, even when that list looks complete. Usage reads must identify the
direct owner of the native usage header and all its buckets; a failed or empty read
retains the last verified cache. Route, account and operation cancellation remain
owned by the packaged flows in the [state-machine registry](../../../../.github/docs/STATE_MACHINE_PLAN.md#3-阶段-a已做的改造).

## Packaged-only boundaries

A key is published only when a repair can work on Gemini's real markup and the
page can independently prove its target. A key that can only confirm the bundled
result remains packaged. The publisher explicitly selects remote fragments,
excludes `*-packaged.json`, and limits their keys with the literal allowlist.
Some packaged fragments also have names without that suffix; they are never
selected for publication.

- Host admission, permissions, account controls/exclusions, conversation/turn/Gem
  identity, parsed-ID equality, storage formats and all destructive actions stay
  in code. So do native menu association, clone sanitizing, ARIA/focus safety,
  send/Stop/IME/disabled checks, click ordering, Quill writes and caret/selection.
- Model selected state (`selectedModel`, `selectedThinking`, `selectedNestedThinking`)
  stays in `modelPickerMetadata.ts`: an alias can only confirm the native state,
  and a disagreeing alias would unnecessarily discard a valid menu repair.
- Independent native health, model metadata, source attributes, URL/origin policy,
  MathML/KaTeX and HTML serialization, export DOM policy, Markdown mutation
  exclusions, theme and every CSS sink stay packaged. This includes chat-width
  CSS, Voyager-owned DOM and cleanup/source-preservation markers.
- Sidebar toggle/hosts/new-chat/action containers, saved/exported/printed titles,
  semantic input, send controls, attachments and related UI checks, HUD anchors,
  chip text/mounts and project insertion/removal rules remain packaged.
- `conversation.json`, `export-toolbar.json` and `canvas-entry.json` are packaged:
  their independent checks can only confirm the bundled result. Fork copy controls,
  export logo identity, usage values/reset/tier, code source/language/buttons,
  diagram parameters, formula containers and Deep Research items/reports also stay
  packaged. Formula containers already carry `data-math`; proposed Deep Research
  item/report repairs lack a proven independent boundary on real markup.
- Generated-image containers remain packaged because real generated images live
  in `button.image-button`, excluded by the independent probe. Canvas document
  editors remain packaged because Gemini's inline `.title-container` and panel
  `toolbar h2.title-text` do not prove the proposed document owner. Image algorithms,
  preview selection and document title/content locators do not move online.
- All six `generatedUi.*` keys remain packaged. Before a frame locator may become
  remote, its remote path needs a URL-parsed origin check. The current packaged
  substring match also accepts `https://wrong.example/gemini-code-immersive`; a
  loose remote locator could capture another site's frame. Online data cannot
  supply the origin policy, and this migration does not change the bundled policy.
- Dormant implementations remain dormant. Shared consumers resolve the current
  site’s own data through `core/selectors/`; Gemini fragments contain no other
  site’s composer dialect.

### MAIN-world scroll literals

The chat and sidebar scroll locators stay as literals in
`public/prevent-auto-scroll.js`. Gemini's nested chat ancestors and the fixed
sidebar exclusions already cover the independently proven targets, so no useful
remote repair is reachable. MAIN needs a fixed projection of its packaged policy;
passing identical values through the page-writable bridge adds validation and
per-event reads without changing a target. There is no selector-data copy or
runtime selector projection. The bridge, fixed Voyager exclusions, timing windows
and History behavior remain unchanged.

Thus name or structure changes can be repaired only while the underlying content,
identity and interaction protocols still hold. CSS, account, ID, model metadata,
virtualization or image-algorithm changes can still require an extension release.

## Rollback runbook

1. Revert the bad locator data on main and retain the failing DOM fixture. The new
   commit must produce a higher first-parent `catalogRevision`.
2. Run affected behavior tests and `bun run catalog:build`. Inspect both Gemini
   host files’ revision, `site.locators`, keys and byte limits before publishing.
3. Publish through the normal Pages workflow and purge the CDN entry for
   each affected `/catalog/hosts/<host>.json`. Fetch those
   exact URLs to verify the host, revision and body.
4. Enabled clients receive it on their next due or manual catalog check and
   apply the profiles after a user refresh. To withdraw all profiles, publish a
   higher-revision host file with `site.locators` omitted or `{}` while retaining
   the rest of its site data. Keep that withdrawal in subsequent publications
   until a reviewed fix restores the profiles.
5. If the channel itself is faulty, ship with `VOYAGER_PLUGIN_CATALOG_REMOTE=off`.

The local emergency path is to turn **Online updates** off and refresh Gemini.
This blocks further catalog requests, including manual checks, and restores
bundled reads without clearing folders, drafts, highlights or other user data.
The catalog cache remains on the device. Withdrawal cannot reverse an action
already completed.
