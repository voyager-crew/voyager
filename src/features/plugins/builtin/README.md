# Packaged official plugins on Gemini and AI Studio

Every optional Gemini / AI Studio feature, folders and conversation export included, is a packaged official plugin run by `PluginHost`. Feature code is a fixed-id builtin in this directory; pure CSS or a shipped public primitive is a manifest under `catalog/sites/{gemini,aistudio}/plugins/`. Ids are `OFFICIAL_PLUGIN_IDS` and owners are `FEATURE_OWNERS`, both in `sites/featureOwners.ts`. These plugins ship only in the package: never in the remote catalog or `catalog/marketplace.json`, yet listed in the docs plugin table (`docs/.vitepress/pluginsPage.ts`).

This file records the decisions and constraints of that migration that still bind new work. The step-by-step recipe is [native-migration.md](../../../../.agents/skills/create-voyager-plugin/references/native-migration.md); the popup list is [`src/pages/popup/officialPlugins/README.md`](../../../pages/popup/officialPlugins/README.md); `PluginScope` versus `startMachine` is [STATE_MACHINE_PLAN.md](../../../../.github/docs/STATE_MACHINE_PLAN.md).

## Decisions

**The old setting stays the switch.** A bound id reads its on/off from the existing sync key (`LEGACY_ENABLE_BINDINGS`, `storage/legacyEnableBindingTable.ts`) and its settings only from value bindings (`storage/legacyValueBindings.ts`); its `gvPluginsState` entry is ignored, enabled flag and settings alike. Settings and plugin state are separate Drive files restored one after the other, not atomically; with one authority per plugin, restoring them in either order cannot disagree. A feature that had no switch got a new default-on sync key (`gvCodeBlockCollapseEnabled`, `gvUserLatexEnabled`, `gvTimelineEnabled`) rather than a `gvPluginsState` entry, so it is backed up with the other settings and its backup default is `true`. Making `gvPluginsState` the authority later is a data migration of its own: schema version, field precedence, partial restores, mixed old and new installs; entries have no per-field timestamps, so "last writer wins" cannot decide it.

**Bindings repeat production exactly.** `read` is the native reading of the key, invalid values and the missing-key default included; `derive` reproduces a native decision that read several keys or decided once per page (a stored custom width implies "on"). Values pass through the same normalize the native module used (`core/utils/chatAppearanceValues.ts` and siblings). A live change the native listener ignored, such as a non-number or a removed number key, keeps the last value. Resolvers and feeds only read; write-backs a native module made go through `startLegacyWriteBack`.

**Shared keys stay shared.** Each site has its own plugin id, but where the old key served both sites the binding still does: turning off Gemini formula copy also turns off AI Studio's, and the popup says so. Per-site switches would be a product and data change, not a refactor.

**A binding gates its official id only.** A local plugin calling the same public primitive follows its own `gvPluginsState` entry; shared runtimes take resolved settings and never re-read the official switch, or "turn off the official one, turn on mine" could never work.

**Admission is where the native module started.** The content script calls `admission.admit(site, feature)` at the old start point (`runtime/officialAdmission.ts`), so a plugin inherits the Enterprise and custom-coverage early returns and the background-tab delay without `PluginHost` copying them. Admission is a time floor, not an ordering promise; whatever is still pending when initialization ends is denied for good.

**No native fallback.** Stage 7 deleted the native start paths; turning an official plugin off starts nothing in its place, and a failed mount is reported, not papered over by a second instance.

**Conflicts.** Exclusive resources exist only where one runtime per page is proven (`runtime/resourceClaims.ts`: formula copy, Vim input, send-key mode, timeline rail, folders, site check). An incumbent keeps its resources and a newly enabled rival is `blocked` with the reason shown; on a cold start free resources go to official plugins first, then by ascending id, and an official plugin not yet admitted reserves them. A plugin gets all its resources or none. Nothing takes over live, and nothing is decided by which async work finished first (`runtime/resourceArbiter.ts`). Other handlers stay composable; there is no "exclusive unless listed".

**Upgrades.** After an extension update an open Gemini page keeps its old runtime until its next normal load. There is no hot takeover, no sweep of older instances and no forced reload; this build only guarantees that its own plugins tear down completely.

**Rollback.** There is no owner switch left to flip. Rolling a feature back to native means reverting the stage 7 retirement commits (`9c2161df`, `0ae260c1`) and the removal of the `'legacy'` owner option (see the `featureOwners.ts` header). No data moved, so neither direction needs a reverse migration and an older version reads the same keys; it cannot honour a master switch it never had (an older build runs a feature that used to be always on).

**AI Studio master switch.** `gvAIStudioEnabled` overrides every plugin there, live, through `runtime/surfaceSwitch.ts`, without rewriting the per-feature choices. The content script still admits the official plugins (all but batch delete) while it is off, so switching it back on mounts them without a reload. Shared Visual effects ignores it.

**Kept outside plugins.** Permanent page services stay in `NATIVE_FEATURES` (`src/pages/content/nativeFeatures.ts`), among them the account context bridge, the history timestamp service and the Safari MAIN-world bridges; a plugin consumes them and its switch never stops them. Rendered quote styling stays in core regardless of the Quote switch.

**Local plugins on these sites.** A `native` op is allowed only for a public primitive an owner entry lists in `handlers` (`sites/hostPolicy.ts`), checked per target site. `folders` is never opened to local plugins (`sites/packagedFoldersPolicy.ts`). The fixed Gemini timeline opens `turnNavigator` with the shared data backend; the terms are in the [local plugin README](../local/README.md). `theme` is refused: these pages keep Voyager's accent.

**Phones.** A packaged plugin runs on desktops and phones unless its `requires.formFactors` is `["desktop"]`; then a phone shows it disabled with `needs-form-factor`, and the popup greys its row. Start paths that serve a plugin outside `PluginHost` (Folder-as-Project, a feature's coachmark, the watermark fetch interceptor) ask `runtime/packagedFormFactor.ts`, so the manifest switches them together.

## Constraints

### User data

Only execution moved; no stored data did.

| Data                                                       | Contract kept                                                                                                                             |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Old sync settings                                          | Same key, storage area, missing-key default, explicit `false` and enum values; sync-backed keys stay in `SettingsBackupService`           |
| `gvPluginsState`                                           | Stays in `chrome.storage.local`; content scripts change it through the background's locked writes, never a whole-map read-modify-write    |
| Gemini drafts                                              | `gvDraft_<full pathname>`, content and timestamp format, `stripInstructionBlock`, the existing pruning; turning drafts off deletes none   |
| Stars and Library                                          | One background writer, canonical identity, hydration readiness, account annotation and the current read policy                            |
| Timeline hierarchy, positions, timestamps                  | `geminiTimeline*` keys, account-scoped hierarchy, legacy localStorage adoption, the history timestamp policy                              |
| Highlights, folders, Gems, prompts, fork/research transfer | Existing services, stores and serialization; turning a plugin off removes UI and listeners only, never records or pending data operations |

Gemini draft slots are per pathname, not per account; the catalog draft primitive's `gvDraft:<site>:…` keys were not adopted for Gemini, because stripping `/u/N/` would merge accounts' new-chat drafts and lose the old ones. Account-level draft isolation would be a separate migration. A cloud restore may turn a local plugin off but never on (`clampLocalPluginsEnabled`, `storage/pluginState.ts`).

### Catalog page data

Consumer Gemini can receive page-locator fixes through the single online catalog
(D14 in [remote/DECISIONS.md](../remote/DECISIONS.md)). The shared **Online updates**
setting governs requests; OFF blocks automatic and manual checks. Its host file
carries `site.locators`, while official plugins, CSS, identity and interaction
protocols stay packaged. Gemini Enterprise and AI Studio remain catalog-ineligible.
The page takes one resolved profile snapshot at startup; new fixes or disabling
updates apply after a user refresh, without automatic reload or native remount.

### Accounts and navigation

- Canonical conversation identity is not the navigation URL: normalizing to `gemini:conv:<id>` never licenses dropping `/u/<index>/`, including `/u/N/gem/<gemId>/<id>`.
- `/u/N` is a session slot an email can reuse. Scope through `AccountIsolationService` (email first, route fallback, `buildScopedStorageKey`), never by plugin or site id.
- The account bridge runs outside every optional plugin. On a route or account change, pending reads, draft restores and highlight lookups go stale; an accepted write keeps the scope it captured and never lands in the new account.
- Navigation uses Gemini's in-app links, then History API and router events; a plugin remount never triggers `location.assign`, `location.href` or `location.reload`.

### Browsers and permissions

- Gemini and AI Studio stay statically injected (`manifest.json` content scripts and `host_permissions`), with no optional grant or dynamic registration.
- Safari's MAIN-world hooks (fetch, usage, history, response completion, prevent auto-scroll, KaTeX) stay static at `document_start`, one entry per file; a plugin switch controls what consumes a bridge, never its injection.
- No `<all_urls>`, remote JS or `userScripts`. New `public/` resources come from the build and top-level Safari ones are registered in the Xcode project.

### Lifecycle and performance

- A disabled optional feature keeps no DOM observer or periodic scan; a settings subscription may stay.
- Off then on returns listener and observer counts to baseline; every handler's stop is complete and idempotent, and a cancelled start never mounts UI.
- Startup keeps the native scheduling through admission; heavy renderer libraries stay lazily imported, and manifest validation stays out of DOM code.
- Turning a plugin off is not a page teardown: account change, route change and sidebar remount keep their own lifetimes.
