# Scripted plugins (`scripted/`)

Part of the [Plugin ecosystem overview](../README.md).

A scripted plugin is a local plugin that carries JavaScript, run through
`chrome.userScripts`, off by default and turned on only after the user reviews its
source. This folder holds the gate's types, the device-local enable state, the
planned registrations and the registrar, the availability probe, the crash
guard's transition, the prelude and the client the popup and panel use. The
background runtime that applies them is `src/pages/background/scriptedCreations/`;
the page side is `src/pages/content/scriptedGuard/`.

## The gate

- `validateManifest` refuses `tier: "scripted"` unless its caller passes
  `allowScripted`, and refuses `contributes.script` on any other tier
  (`manifest/scriptedChecks.ts`). The remote catalog, the bundled catalog,
  `plugin:check` and `create-voyager-plugin check` never pass it.
- Only `validateLocalManifest(…, { allowScripted: true })` admits one, on top of
  every local rule (`local.*` id, `matches` inside the supported sites). A
  scripted manifest contributes its script only: no styles, `domOps` (so no
  `native` ops), settings or `theme`, and at most 200,000 characters of source.
- The user's own paths pass it: `importLocalPlugin` (file, paste and a reviewed
  reply), `checkPluginReply` (the popup paste and the panel review),
  `classifyReplyBlock` (Create mode's page controls) and the My creations list.
  `LocalPluginSource` skips a scripted record without reading it, so
  `PluginHost` never mounts one and its `gvPluginsState` entry stays
  `enabled: false`: the import writes it off, `enableLocalPluginIfUnchanged`
  refuses it, and a Drive restore never switches a local plugin on. With
  `allowScripted` off the gate still lists a refused plugin's other problems.

## Enable state

- `StorageKeys.PLUGIN_SCRIPTED_STATE` (`ScriptedStateV1`, `chrome.storage.local`)
  is `device-local` in `settingsBackupPolicies.ts`: no settings file, Drive upload
  or restore reads or writes it. `PLUGIN_SCRIPTED_LOADS` is the crash guard's
  `transient` page-load record, written by the background only.
- Every import lands off, an identical re-import included, as declarative ones
  do: `saveLocalPluginRecord` drops the plugin's enable entry in the import's
  own single write, under the same lock, keeping any crash notice.
- An enable entry stores the review hash: SHA-256 of the canonical JSON of the
  plugin's `matches` and source (`scriptedReviewHash`). A plugin runs only while
  its stored content hashes to that value; content that changed by any other
  path pauses it as `needs-review`.
- `enableScriptedIfUnchanged(id, seen)` hashes the stored record under the
  plugin-storage lock and writes only when it equals `seen`.
  `disableScripted`, `setScriptedStopped` (the kill switch) and
  `removeLocalPluginRecord` (which drops the entry and any crash notice) hold
  the same lock.
- `parseScriptedState` turns anything unreadable into the empty state, which
  runs nothing. Writers refuse a state a newer build wrote (`version > 1`).

## Run state and registrations

`scriptedRunState(plugin, state, availability)` is pure: `off` without an entry
(`paused: crash-guard` when the guard left a notice), then `needs-review` on a
hash mismatch, then `unsupported`, `user-scripts-off` and `stopped-all`, else
`running`. `desiredUserScripts` returns one registration per running plugin:
its id and `matches`, `allFrames: false`, `runAt: 'document_idle'`,
`world: 'USER_SCRIPT'`, a `worldId` derived from the id, and the source. The
registrar adds the packaged prelude and the world configuration.

## Background runtime

Chrome and Edge builds only; they alone ask for the `userScripts` permission
(`vite.config.chrome.ts`). Firefox and Safari answer `gv.scripted.status` with
`unsupported` and register nothing.

- **Availability** (`availability.ts`). `unsupported` on Safari, Firefox, phones
  and Chrome before 133 (per-plugin worlds need `worldId`). Otherwise
  `getScripts()` in a try/catch: a throw, or a missing `chrome.userScripts`, is
  `toggle-off`, naming "Allow User Scripts" from Chrome 138 and Developer mode
  before it. The probe reads `chrome.userScripts` on every call, never a cached copy.
- **Registrar** (`registrar.ts`). Each pass diffs `getScripts()`
  against `desiredUserScripts`: it unregisters ids the plan lacks, updates those
  that differ and registers the missing ones, one plugin per call so one refusal
  cannot block the rest. Before registering it configures the plugin's world with
  `messaging: false` and `SCRIPTED_WORLD_CSP`; when Chrome refuses, the plugin
  is not registered (a registration it had is removed) and its status reads
  `paused: world-setup` until a later pass succeeds. Chrome keeps a world's
  configuration after its script is gone and caps how many it keeps, so each
  pass resets every configuration no remaining registration uses, whoever
  removed the script. Every registration is
  `[prelude file, source]` in that world, top frame only, at `document_idle`;
  never `MAIN`. Right before each `register` or `update` it reads the scripted
  state again, so a plugin turned off or re-imported while the pass awaited is
  not registered; the background and an extension page run the same pass.
  Passes run one at a time, and requests during a pass share one
  queued pass that reads storage when it starts. Triggers: worker start,
  `runtime.onInstalled` (an update clears user scripts), local changes to the
  manifests or the scripted state, permission changes and `gv.scripted.recheck`.
- **Prelude** (`prelude/`). The Chrome build bundles `prelude/entry.ts` alone into
  `scripted-prelude.js` at the package root. It is a Rollup asset of the Chrome
  config, not a `public/` file, so Firefox and Safari never ship it and Safari's
  Xcode resource list is unaffected. In the plugin's world only, it disconnects a
  `MutationObserver` whose callback runs more than 200 times in a second, and
  raises any `setInterval` delay below 50 ms to 50 ms.
- **Crash guard** (`crashGuard.ts`, `scriptedCreations/guard.ts`). A persisted pure
  transition over each tab's `ScriptedLoadRecord`, so a worker restart keeps it.
  A `loading` tab update records the plugins registered for that URL, each with
  the review hash of the code registered then (`loadedScriptsFor`), and an alarm
  at 30 s marks a load that is still unconfirmed `suspect`. The page's
  `gv.scripted.loaded` confirms it. A crash is any of these, and every plugin
  that ran on the load is named in it:
  - the tab loads again, or closes, at least 10 s after a load that never confirmed;
  - another tab loads one of a suspect tab's plugins;
  - the browser starts again after such a load.

  A quicker reload keeps the first load's start time, so reloading a frozen page
  every few seconds still adds up to a crash. Only the same code counts: a crash
  names each plugin with its hash, the guard unregisters only those still turned
  on with that hash, first, then `recordScriptedCrash` turns those off and stores
  a crash notice. A replacement reviewed and turned on since keeps running, and a
  re-import or removal (any change to a stored record) takes the plugin out of
  every load record.

- **Messages** (`messages.ts`, handled in `scriptedCreations/messages.ts`):
  `status`, `recheck`, `clearNotice` and `openDetails` (a `chrome://extensions/?id=`
  tab) from extension pages or our top-frame content script; `loaded` from that
  content script only, for its own tab. A content script calls
  `scriptedLoadedMessage()` `SCRIPTED_LOADED_DELAY_MS` after `readyState` is
  `complete`.

## The page

`src/pages/content/scriptedGuard/` is a permanent page service on Chrome and
Edge, top frame only, on every site creations can target. Once the document is
complete it waits `SCRIPTED_LOADED_DELAY_MS` on a timer, which fires only on a
free main thread, and sends `loaded`; it sends it again after each same-document
navigation (`navigatesuccess`, `popstate`), so a `loading` tab update Chrome
reports for an in-app navigation is confirmed too. Teardown cancels a pending
send. On start it toasts the crash notices whose URL has this page's origin,
naming each creation turned off (all of them when one freeze named several),
and asks the background to clear each. It also answers
`SCRIPTED_RELOAD_PAGE_REQUEST`, the popup's or panel's relayed "Reload this
page" click, the only reload it makes.

## Popup and panel

- **Review.** A scripted manifest's preview carries `script`, and
  `LocalPluginPreviewSummary` shows a **Runs code** badge, the sites, one
  warning (it can read everything on those pages and Voyager cannot stop it
  sending what it reads) and the full source, left to right and selectable,
  instead of changes. Voyager never summarises code. The popup paste and the
  panel review both end in **Install and turn on**: the import lands off like
  any other, then `enableScriptedWithSiteAccess` (`pages/popup/utils/`) binds
  the enable to `scriptedReviewHash` of the manifest on screen, asking for the
  site's optional host access in the same click. `changed` refreshes the review.
- **Rows.** My creations, the popup card and the group that heads the panel's
  Features tab, shows each scripted creation's run state (**On, this device
  only**, **Off** or **Paused** with its reason). One that is on turns off from
  the popup's **Turn off** or the panel row's switch; otherwise **Review and
  turn on** shows the source and warning before **Turn on**. Both reviews end in
  `ScriptedTurnOn`, the one hash-bound enable; the panel row has no switch until
  then. A paused creation is never removed.
- **Availability.** `ScriptedSetupCard` shows the one-time steps for
  `toggle-off` (open the details page through `openDetails`, the address as
  selectable text when the browser refuses; **Allow User Scripts**, or Developer
  mode before Chrome 138; **I turned it on**) and, for `unsupported`, that this
  browser cannot run them and to ask the AI for a version that only restyles.
  No install is offered there.
- **Kill switch.** `ScriptedStopAll` closes My creations (in the panel, only
  while the group lists a creation that runs code). It calls
  `setScriptedStopped`, shows the stopped state with **Resume**, and right
  after a stop says open pages keep running them until reloaded, with **Reload
  this page** (the popup reloads the active tab, the panel relays the request).
- **The toggle flip.** Chrome exposes `chrome.userScripts` only to contexts
  created after the user allowed user scripts, so the worker that was running
  may not see it. `createScriptedClient` (`client.ts`) probes in the popup or
  panel itself; when this page sees the API and the background does not, it
  runs the registrar from here and reports this page's status. The background's
  pass returns while its API is missing, so the two never write together, and
  a restarted worker takes over. The panel frame may itself predate the flip,
  so **I turned it on** in the panel also loads the panel page again in a
  hidden child frame (`pages/panel/create/scriptedProbe.ts`), which probes,
  reconciles and posts its status back. Until the worker restarts, its crash
  guard sees no registrations, so a freeze in that window is not caught.
