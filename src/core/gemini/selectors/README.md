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

[`types.ts`](types.ts) owns the literal `GEMINI_SELECTOR_PROFILE_KEYS`
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

| Source fragment         | Group                                                                              | Consumers                                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `turn.json`             | `turn.*`                                                                           | Timeline, export, highlight, fork, timestamps, reply notifications, selection toolbar and semantic turn queries |
| `sidebar.json`          | `sidebar.*`                                                                        | Sidebar discovery, folder mounts and rows, navigation, auto-hide and fork sidebar discovery                     |
| `model-picker.json`     | `modelPicker.*`                                                                    | Default model menu discovery, model/thinking reads and focus target                                             |
| `composer.json`         | `composer.*`                                                                       | Main and inline edit inputs, draft targets, send containers and notification reads                              |
| `input-collapse.json`   | `inputCollapse.wrapper`                                                            | Input collapse host                                                                                             |
| `vim.json`              | `vim.*`                                                                            | Configured wrapper and candidate input resolution                                                               |
| `prompt-history.json`   | `promptHistory.candidates`                                                         | Prompt capture                                                                                                  |
| `slash.json`            | `slash.candidates`                                                                 | Slash command input                                                                                             |
| `sent-chips.json`       | `sentChips.bubbles`                                                                | Sent prompt preview hosts                                                                                       |
| `project.json`          | `project.inputs`                                                                   | Folder as Project input discovery                                                                               |
| `activity.json`         | `activity.inputs`                                                                  | Folder activity input discovery                                                                                 |
| `menu.json`             | `menu.*`                                                                           | Conversation/export menu panels and content                                                                     |
| `menu-overlay.json`     | `exportOverlay.*`                                                                  | Canvas/composer alignment targets for the export selection bar                                                  |
| `sidebar-width.json`    | `sidebarWidth.buttons`                                                             | Sidebar button hit targets                                                                                      |
| `sidebar-hover.json`    | `sidebarHover.*`                                                                   | Dialog/menu exclusions during sidebar hover                                                                     |
| `gems.json`             | `gems.navEntry`, separately the remaining `gems.*` catalog keys                    | Active Gems sidebar entry and catalog scrape                                                                    |
| `content.json`          | `content.*`                                                                        | Answer/user text for export, fork, quotes and turn text                                                         |
| `context-images.json`   | `context.images`                                                                   | Context image collection                                                                                        |
| `response-actions.json` | `responseActions.bars`                                                             | Image export action placement                                                                                   |
| `research-pack.json`    | `researchPack.actionBars`                                                          | Research-pack action placement                                                                                  |
| `usage.json`            | `usage.root`                                                                       | Usage display owner                                                                                             |
| `code.json`             | `code.host`                                                                        | Code collapse, diagrams, copy/export and semantic diagnostics                                                   |
| `user-latex.json`       | `userLatex.lines`                                                                  | LaTeX paragraphs within the original user turn                                                                  |
| `image-export.json`     | `imageExport.searchHosts`                                                          | Search result images in exports and fallback alt text                                                           |
| `generated-image.json`  | `generatedImage.downloadIcon`                                                      | Generated image download icon within its original button                                                        |
| `canvas-code.json`      | `canvas.codePanels`                                                                | Canvas code panel, binding title and content to one owner                                                       |
| `extended.json`         | Titles, sidebar actions, conversation roots, research content and Gemini placement | Per-key Tier A proofs or Tier B placement; see the trust ledger                                                 |
| `placement.json`        | `exportLayout.*`, input clearance/FAB, Vim HUD/mount profiles                      | Tier B Voyager layout and insertion slots                                                                       |
| `timeline.json`         | `timeline.userText`                                                                | Tier A text belonging to the independently proved user turn                                                     |

## Page and operation ownership

The content-script claim starts hydration alongside PluginHost, before native
feature mounts. Hydration is a `startMachine` flow with a 250 ms deadline.
Native features do not wait for it: after their existing setting reads, the first
mount fixes the snapshot already available. A pending cache read then settles on
the bundle; a subsequent page load can try again. A timely eligible cache can
supply the first mount. Catalog settings changes during a pending read, an error
or the deadline also settle on the bundle; late results cannot replace that
decision. Once ready, the page snapshot stays fixed until its claim ends. New downloads and turning the switch off take
effect after a user refresh, without automatic reload or remount.

Tier A reads are pure until the consumer accepts a complete operation. A nonempty
result alone is insufficient for an action, stored/exported content or operation identity. A partial collection, different DOM order, conflict with an
independent native/bundled check, or an element other than the operation's original
target falls back to the bundled read for the whole operation. No rejected read may
click, insert, send, export, download or persist anything. Checks introduced for
online data run only when that surface has remote keys, preserving the bundled
path with the switch off.

Tier B reads only place or avoid Voyager UI. The official catalog is trusted for
these keys without independent page proof. No match falls back for that operation;
mounts inside host editable regions also fall back. Export layout, Vim HUD mounts,
input clearance, project picker placement and chip insertion share this rule.
Literal allowlists, groups, size limits and unparsable-value rejection still apply.
A locator also used for host actions or data stays Tier A, or gets a separate
placement-only key with the action/source proof kept independent.

Remote turn winners never enter the legacy saved Auto selector. Unknown remote
turn spellings use the packaged conversation observer scope. Collapse scans,
mutation flushes and resize measurements each keep one accepted read session.
Vim preserves configured-wrapper-to-editable order and hidden fallback; its HUD
uses Tier B placement while input writes keep their Tier A composer proof. Gems scraping cannot prune pins or recent Gems from a
remote list, even when that list looks complete. Usage reads must identify the
direct owner of the native usage header and all its buckets; a failed or empty read
retains the last verified cache. Route, account and operation cancellation remain
owned by the packaged flows in the [state-machine registry](../../../../.github/docs/STATE_MACHINE_PLAN.md#3-阶段-a已做的改造).

## Packaged-only boundaries

The [complete trust ledger](PACKAGED_DATA.md) lists every profile, packaged
fragment key and native semantic key, with its Tier A, Tier B or §6 classification.
Stored data, titles, timeline text and export roots are always Tier A. The ledger
states a separate reason for every retained source or action locator.

The publisher selects literal keys from named fragments. Baseline copies in
`*-packaged.json` preserve values and ordering where an online counterpart now
exists. A fragment's filename alone does not determine its trust tier.

- Host admission, permissions, account controls/exclusions, parsed IDs, storage
  formats and destructive action protocols remain packaged. So do native menu
  association, clone sanitizing, ARIA/focus safety, send/Stop/IME/disabled checks,
  click ordering, Quill writes and caret/selection.
- Model selected state (`selectedModel`, `selectedThinking`, `selectedNestedThinking`)
  stays in `modelPickerMetadata.ts`. Native metadata supplies evidence for repaired
  model-menu targets; placement of Voyager stars does not redefine model identity.
- Independent native health, source attributes, URL/origin policy, MathML/KaTeX
  and HTML serialization, Markdown mutation exclusions, theme and every CSS sink
  stay packaged. A remote mount cannot change these source or interaction rules.
- Compatibility copies do not create a second online channel. Dormant code stays
  dormant. Shared consumers resolve only their current site's profiles; bundled
  input, HUD and mount candidates retain their historical values and order.

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
This stops automatic catalog requests; manual checks remain available. It restores
bundled `site.locators` profiles without clearing folders, drafts, highlights or
other user data. Semantic adapter reads retain their baseline behavior, including
cached overrides; the new contract proofs apply only with updates on. Cached
plugins and site-adapter data remain usable. The catalog cache remains on the
device. Withdrawal cannot reverse an action
already completed.
