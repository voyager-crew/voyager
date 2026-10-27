# Gemini page detection data

These profiles serve Gemini and Gemini Enterprise. The [shared resolver
invariants](../../selectors/README.md#invariants) define the online channel, OFF
compatibility, site isolation, trust tiers and packaged boundaries; transport and
cache details live in the [remote catalog README](../../../features/plugins/remote/README.md).

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
non-whitespace C0 controls rejected. Oversized sections are omitted without invalidating other site data. Unknown-key handling follows the shared invariants. A malformed or unparsable
locator drops only its surface’s group.

The builder reads the same selected non-`*-packaged.json` source fragments as
[`bundle.ts`](bundle.ts). Catalog publication uses the main lineage’s first-parent
commit count. The resolved remote adapter wins only if its `catalogRevision` is
strictly newer than the bundle. Cache writer-version checks, refresh, withdrawal
and account boundaries use the catalog’s existing machinery.

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
| `context-text.json`     | `context.users`, `context.responses`                                               | Context dialogue body capture                                                                                   |
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

The content-script claim starts hydration alongside PluginHost. The first
consumer follows the shared [startup readiness rule](../../selectors/README.md#startup-readiness)
before reading its frozen page view. New downloads and turning the switch off
take effect after a user refresh, without automatic reload or remount.

Operation acceptance and mount rejection follow the [shared invariants and
mount rule](../../selectors/README.md#tier-b-mount-rule). Gemini's model
stars retain their validated native picker-row decoration exception; Vim HUD
candidates remain packaged because the baseline list includes a Tools button.

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

The [shared invariants](../../selectors/README.md#invariants) and per-key ledger
own the packaged boundary. Gemini model selected-state metadata remains in
`modelPickerMetadata.ts`, separate from star decoration placement.

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
