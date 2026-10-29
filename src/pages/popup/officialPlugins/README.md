# Popup official plugin list

Every packaged Gemini / AI Studio official plugin (`featureOwners.ts`) is one row in a popup topic
card, and that row is its only switch. The list is presentation only: whether a plugin runs and
which storage holds its switch belong to `featureOwners.ts` and the legacy bindings
(`src/features/plugins/storage/legacySettingBindings.ts`, `legacyEnableBindingTable.ts`,
`legacyValueBindings.ts`).

| File                                               | Owns                                                                                                                                                                                   |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `officialPluginEntries.ts`                         | `OFFICIAL_PLUGIN_ENTRIES`: the rows, in display order within each topic card                                                                                                           |
| `officialPluginRegistry.ts`                        | `OfficialPluginEntry` and its fields, `OFFICIAL_PLUGIN_TOPICS`, `OfficialPluginContext`, panel keys (`OFFICIAL_PANEL_KEYS`), `POPUP_LEGACY_SNAPSHOT_KEYS`, `SWITCHED_BY_SETTINGS_CARD` |
| `useOfficialPluginList.ts`                         | Rows resolved from the snapshot, the switch and settings writes, search targets                                                                                                        |
| `useLegacyPreferenceWrites.ts`                     | The optimistic overlay over the snapshot                                                                                                                                               |
| `OfficialPluginCards.tsx`, `OfficialPluginRow.tsx` | Topic cards, one row, the undo offer after a flip                                                                                                                                      |
| `officialPluginPanels.tsx`, `*Panel.tsx`           | Options a manifest cannot declare                                                                                                                                                      |
| `officialPluginSearch.ts`                          | Settings-search targets for the listed rows and their topic cards                                                                                                                      |
| `PluginSiteOfficialRows.tsx`                       | The same rows inside a plugin site's card (Visual effects)                                                                                                                             |

## Principles

- One feature, one switch, and the switch is the row. No second copy in any other card. Official
  plugins whose switch is still an older settings card's are in `SWITCHED_BY_SETTINGS_CARD` and get
  no row: Gemini's and AI Studio's folders follow the Folders card.
- Order is fixed; flipping a switch never moves a row. Topic cards are plain `CardTitle` cards,
  not collapsible, with no icons, counts or badges. Search, not nesting, finds a row.
- A row stays compact while off. Its settings, sliders and panel show directly under it only while
  it is on; a panel mounts only while on, so its polling and timers end with the switch.
- A row shows the **stored preference**, not what the current page decided. What the page is doing
  differently (paused by a local plugin, waiting) shows as the note under the row, from the
  statuses the tab reports.
- A row's name is the manifest name. The retired settings row's label and the card it sat in stay
  as search words (`searchKeys`, `formerSectionTitle`).
- A device that cannot run a plugin (its manifest's `requires.formFactors` is `["desktop"]` on a phone)
  shows the row off and greyed with `UNAVAILABLE_ON_THIS_DEVICE`, and keeps the stored choice for
  the user's other devices. An entry's `requires` greys the switch the same way while a
  prerequisite setting is unmet (batch delete needs folders).

## Reading: one live snapshot

```
gvPluginsState (local) ─┐
legacy sync keys ───────┤ usePopupPlugins: pluginState + legacySettings
                        │ (subscribe first, then read; live; the only owner)
                        ▼
  effectivePluginView(manifest, state, legacy)          ← the one resolver
    enabled  = resolveEffectiveEnabled(state, legacy, id)
    settings = bound ? deriveLegacyValueSettings(id, legacy)
                     : resolveEffectiveSettings(manifest, state)
                        │
       ┌────────────────┼─────────────────────┐
  diagnostics      list rows, panels,     PluginHost resolves with
  export           notification control   the same functions
```

- `usePopupPlugins` owns the snapshot: it subscribes to `subscribeLegacySettings` before
  `loadLegacySettingSnapshot(POPUP_LEGACY_SNAPSHOT_KEYS)`, so a change during the first read is not
  lost. The key set is `legacyBindingKeys()` plus the panels' own keys (`OFFICIAL_PANEL_KEYS`).
  Panel keys are for the UI only and never become runtime value bindings.
- Rows render only after the first read lands (`legacyLoaded`), so a default never flashes over a
  stored choice.
- Older hooks keep only actions: permission flows, button actions and transient state (a
  notification request in flight). They hold no copy of a persisted value: a copy read once goes
  stale after a restore.
- The popup resolves without `wasChangedLive`, so it does not guess the page's history. The page
  can differ: a page that first read width 70 with the switch missing, then saw only the width
  change live to 90, stays off while the popup derives on (`chatAppearanceValues.ts`); a removed
  value key keeps its last value on the page and reads as the default in the popup. Tests assert
  that a row equals the stored preference, never the page state.

## Writing

Every listed plugin is legacy-bound (the registry contract test holds it), so the list never writes
`gvPluginsState` for it and copies nothing into it. That keeps the bindings' promise that restoring
the settings backup and the plugins backup in either order cannot disagree.

| Write                                 | How                                                                                                                    |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Switch                                | `legacyEnableWrite(id, enabled)`, or the entry's `enableWrite(enabled, shown)` when one key is not enough (NanoBanana) |
| Manifest setting with a value binding | `legacyValueWrite(id, key, value)`, the old key with the normalized value                                              |
| Manifest setting without one          | Not allowed: the registry contract test fails                                                                          |
| Panel-owned key                       | The panel writes it through `writePanel`, the same overlay                                                             |

- All writes go through `writePopupSyncChangesChecked` (`utils/popupStorage.ts`), which reports
  whether the write landed and removes a key written as `undefined`: putting back a key that was
  never stored leaves it unstored, which a binding can read differently from any stored value.
- A setting is offered only while the row is on, so a never-stored derived switch is stored as
  shown with its first setting write, unless an open page seeing that write arrive live would
  still read it on (`setSettings`). Gemini's width switches are stored with the width; AI Studio's
  sidebar switch follows the folders switch, so its width goes alone.
- Sliders save on commit (`onValueCommit`, pointer release or keyboard), not on a debounce with a
  flush at close: the popup closes without a React cleanup, so a flush is unreliable.
- A flip offers an undo (`flipEnabled`) that writes back exactly what the flip replaced, key by
  key; the offer is withdrawn once any of those keys changes again.
- Outside the list, `pluginEnablement.ts`'s `writeEnabled` routes a bound id the same way: it
  writes the old key and never prompts for host permissions, since statically injected sites
  need none.

### The optimistic overlay

`useLegacyPreferenceWrites` shows a picked value at once and settles it per storage key and per
write revision, against both the write's result and the live snapshot:

1. A failed write drops the value; the stored one shows again.
2. A landed write drops it once the snapshot holds it, at once for a no-op write that raises no
   change event.
3. Otherwise a landed write gives way to the snapshot as soon as the key has changed since the
   write started (a restore, another window, even back to the old value), whether that change came
   before or after the write's receipt.
4. A newer write to the same key supersedes an older one still in flight; the older settlement is
   ignored.

When an external restore and an unsettled local write collide, the latest snapshot wins.

## Declaring a row's controls

| Control                                                                                                    | Declared as                                                                                                       | Examples                                                                       |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| A scalar the runtime takes as a plugin setting (its handler has `updateSettings`, or a restart is fine)    | Manifest `contributes.settings` plus a value binding; booleans write at once, numbers through `sliders` on commit | Chat / edit input width, font size, line height, Gems sidebar count            |
| A value the runtime reads from storage itself, an enum the schema cannot express, a note, an action button | `panel` (below the settings) or `inlinePanel` (in place of the manifest's settings)                               | Timeline, formula copy format, highlight markers, Context Sync, Visual effects |
| A switch that is not a plain write (a permission flow)                                                     | `control`; the popup supplies it                                                                                  | Response notification                                                          |

Highlight markers are a panel, not a value binding: the runtime reads that key live and its handler
has no `updateSettings`, so a binding would push a settings change on every flip and the engine
would tear the plugin down and activate it again. Timeline is the same.

Special cases:

- **Formula copy**: two ids, one switch and one format, shared across Gemini and AI Studio. Each
  site lists its own row with the same panel, which says that turning it off on one site turns it
  off on both.
- **Response notification**: the control reads `enabled` from the snapshot and calls the original
  flow synchronously, with no `await` before it: Firefox needs the permission request to be the
  gesture's first await, Chrome hands the intent to the background first, Safari keeps its native
  permission path and wording. The undo wrapper calls the control first for the same reason.
- **NanoBanana**: two rows, one per split key; either switch writes both split keys and clears the
  legacy `geminiWatermarkRemoverEnabled` (`watermarkWrite`), resolved by
  `core/utils/watermarkSettings.ts`.
- **Context Sync**: the panel probes the local server only once it is on screen
  (`IntersectionObserver`), not whenever the popup is open.
- **Visual effects**: one enum binding shared across sites; each site lists its own row, and plugin
  sites show it through `PluginSiteOfficialRows`.

## Browser differences

- Safari: Safari Enter fix is listed only where `eligible` holds (`isSafariBrowser`), and its
  binding's `derive` checks `isSafari()` too. `usageHint` may depend on the browser (the Safari
  notification hint). Icons use `lucide-react`; add no Material Symbols.
- Firefox: no `await` before a permission request; a bound switch requests no permission.
- Chrome / Edge: the popup may close during a permission prompt; the notification control has
  already persisted the intent.

## Search and placement

- Each listed row is a search target `<topicId>:<pluginId>`, and each topic card with a row is one
  section target (`POPUP_SECTION_SEARCH_SETTING_ID`) keyed by `pluginsTitle`,
  `pluginsNativeDescription` and the topic title, not its short table-of-contents label (a word
  like "Chats" would pull a whole card into common queries). Targets come from the listed rows
  only, through the same eligibility check, so search never finds a plugin this tab does not
  list. The corpus is every locale's manifest name and description plus `searchKeys`,
  `formerSectionTitle` and `searchAliases`.
- The eight topic ids (`OFFICIAL_PLUGIN_TOPIC_IDS`, `nativeSiteCapabilities.ts`) are popup sections:
  they reorder, hide in a search and anchor the table of contents like any card. A topic with no
  row on this tab is invisible and skipped when reordering. A saved order holding the retired
  `officialPlugins` slot expands it in place (`usePopupSections`). AI Studio's allowlist names all
  eight topics, and its rows still filter by manifest matches.
- A plugin blocked by an official switch points at it by manifest row name plus its topic card's
  title (`pluginBlockedNote.ts`, `officialPluginEntry`, `officialPluginTopic`,
  `pluginBlockedByOfficialSetting`).

## Accessibility and RTL

- A row switch is labelled by the plugin name (`<label htmlFor>`) and described by the description,
  plus the requirement note when one disables it. A topic card is a titled card with a `<ul>`
  labelled by its title; rows are list items with no rules between them, spaced like other cards.
- The options under a row are `role="group"` with a unique `aria-label` naming the plugin
  (`pluginRowOptionsFor`). When a search filters out the focused row, focus stays in the search box.
- The table of contents (`PopupToc`) is a `<nav>` of `<button>`s with a visible focus ring. A jump
  leaves room for the fixed header, scrolls without smoothing under `prefers-reduced-motion`, and
  moves focus to the target card's title (`preventScroll`). Its trailing fade mask sits on the left
  in RTL.
- Segmented choices (timeline style, scroll mode) use `SegmentedControl` as a `radiogroup`, so
  selection is not told by colour alone; the formula format is a `radiogroup` too.
- The popup sets no direction, so each topic card and `PluginSiteOfficialRows` set `dir="rtl"` for
  RTL languages. Rows and panels use logical properties only (`ps-*`, `ms-*`, `text-start`), never
  a computed physical `left`.

## Backup, restore, cloud sync

- The old keys live in `chrome.storage.sync` and travel with the settings backup and Drive's
  settings file. The list follows them live, so a restore while the popup is open updates the rows.
- `gvPluginsState` has its own Drive file; for a bound id it is ignored and never written, so the
  two files restore in any order without contradiction.
- The settings export carries only the keys present in storage, so a never-touched switch stays
  missing; a restoring device that has not set it either derives it from the restored inputs (a
  custom width with the switch missing still reads on there). Files from v2.2.1 and earlier carry
  every `BACKUPABLE_SYNC_SETTINGS_DEFAULTS` value, and restoring one writes them; the registry
  contract test checks, for every listed id, that such a default keeps a never-touched switch the
  way it was.
- The list adds no storage keys. A feature with no old key gets a default-on sync key plus a
  binding, so every Gemini / AI Studio official plugin is settled by sync and `gvPluginsState`
  serves only local plugins and plugin sites. Downgrade is safe: no data moves, and an older
  version reads the same keys.

## Adding a row

The runtime side of a migration follows
[native-migration.md](../../../../.agents/skills/create-voyager-plugin/references/native-migration.md);
this is the popup side, done in the same change that removes the old settings row.

1. Add the entry to `OFFICIAL_PLUGIN_ENTRIES` in `officialPluginEntries.ts`, at its position in its
   topic card. Carry over the old row's `searchKeys` / `searchAliases` from
   `utils/popupSettingsSearchIndex.ts`, plus `formerSectionTitle`. Add `eligible`, `experimental`,
   `usageHint`, `requires`, `panel` / `inlinePanel`, `control`, `enableWrite` or `sliders` only when
   the control table above calls for it; `OfficialPluginEntry` lists every field.
2. If it needs a panel, add it to `officialPluginPanels.tsx` and its keys to `OFFICIAL_PANEL_KEYS`:
   reuse the old card's JSX, take `enabled` from the row and persisted values from the snapshot,
   and follow the accessibility rules above.
3. Remove the old UI: the card row or `wrapSection` call, hook state, `*_STORAGE_DEFAULTS` keys,
   the section id and AI Studio allowlist entry in `nativeSiteCapabilities.ts`, and its search
   entry.
4. Strings: delete only keys used solely by the removed row and not kept as `searchKeys` or as a
   manifest's `messageKeys`, in all 10 locales; run `bun run i18n:check`.
5. Tests: add the id to `MOVED_SWITCHES` (`__tests__/officialPluginListSwitches.ts`: missing,
   false, true) and move the old card's assertions; `officialPluginRegistry.test.ts` covers the
   rest of the contract.
6. Docs: every locale's guide page for the feature names the popup path as
   "**topic card title** → **manifest row name**", in that locale's actual strings.
