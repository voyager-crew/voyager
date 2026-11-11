# Scripted plugins (`scripted/`)

Part of the [Plugin ecosystem overview](../README.md).

A scripted plugin is a local plugin that carries JavaScript, meant to run through
`chrome.userScripts`, off by default and turned on only after the user reviews its
source. This folder holds the gate's types, the device-local enable state and the
registrations a later registrar applies. Nothing runs a script yet: no build calls
`chrome.userScripts`, asks for its permission or shows a scripted plugin.

## The gate

- `validateManifest` refuses `tier: "scripted"` unless its caller passes
  `allowScripted`, and refuses `contributes.script` on any other tier
  (`manifest/scriptedChecks.ts`). The remote catalog, the bundled catalog,
  `plugin:check` and `create-voyager-plugin check` never pass it.
- Only `validateLocalManifest(…, { allowScripted: true })` admits one, on top of
  every local rule (`local.*` id, `matches` inside the supported sites). A
  scripted manifest contributes its script only: no styles, `domOps` (so no
  `native` ops), settings or `theme`, and at most 200,000 characters of source.
- Import, paste, Create mode replies, `LocalPluginSource` and the popup list use
  the default gate, so a stored scripted plugin is invisible to the declarative
  path and its `gvPluginsState` entry stays `enabled: false`: the import writes it
  off, `enableLocalPluginIfUnchanged` refuses it, and a Drive restore never
  switches a local plugin on. With `allowScripted` off the gate still lists a
  refused plugin's other problems.

## Enable state

- `StorageKeys.PLUGIN_SCRIPTED_STATE` (`ScriptedStateV1`, `chrome.storage.local`)
  is `device-local` in `settingsBackupPolicies.ts`: no settings file, Drive upload
  or restore reads or writes it. `PLUGIN_SCRIPTED_LOADS` is the crash guard's
  `transient` page-load record; nothing writes it yet.
- An enable entry stores the review hash: SHA-256 of the canonical JSON of the
  plugin's `matches` and source (`scriptedReviewHash`). A plugin runs only while
  its stored content hashes to that value, so a re-import that changes either
  pauses it as `needs-review` in the import's own single write.
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
