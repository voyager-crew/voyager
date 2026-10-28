---
name: verify-in-browser
description: Proves a Voyager change on the live host page and shows the evidence as screenshots. Use after changing content scripts, injected CSS, MAIN-world scripts or plugin site code, when a check needs a setting or plugin switched (the dev build flips it without the popup), and when someone reports a feature missing or still old in their browser.
metadata:
  version: '2.0.0'
---

# Verify a change in the live browser

Unit fixtures prove the fixture, not today's host DOM. Run the whole loop yourself: build, load, drive the page, capture, show. The person only steps in for what no tool can do (signing in, 2FA, a CAPTCHA); say which one and why.

Copy this checklist and tick it off:

```
- [ ] Build loaded: the tab shows a marker or behavior from this change
- [ ] Workflow driven on each changed site
- [ ] Crops saved: changed element, light and dark when CSS changed
- [ ] Evidence shown: paths, or one published page when several crops
- [ ] Test residue listed; own tabs closed
```

## 1. Load the build

Pick the build by what the check proves:

- **Dev build** (every check that is not about the shipped package): the unpacked `dist_chrome_dev` of the main checkout. The person loads it once with Load unpacked in `chrome://extensions`; after that it reloads itself about a second after its build id changes (`src/pages/background/devAutoReload.ts`), so you only build: `bun run dev:chrome`, or once with the `exec` command in `nodemon.chrome.json` and `__DEV__=true`. It runs on every host in `manifest.dev.json` `host_permissions`; a plugin site missing there gets added to that list and rebuilt, which is how the dev build gains site access without a click. It compiles the catalog channel off; checks of online data build it with `VOYAGER_PLUGIN_CATALOG_REMOTE=on`.
- **From a worktree**: build there and copy the build id last, so the reload never sees a half-copied bundle (a reload mid-copy can read a partial manifest and leave the extension disabled for a permission increase): `rsync -a --delete --exclude .voyager-build-ready dist_chrome_dev/ <main checkout>/dist_chrome_dev/`, then `cp dist_chrome_dev/.voyager-build-ready <main checkout>/dist_chrome_dev/`.
- **Production build**: a release check, or a bug that reproduces only in the store or minified build. `bun run build:chrome` makes `dist_chrome`, which has neither the self-reload nor the dev settings bridge. Reload it with an extension tool when one is connected (chrome-devtools-mcp: `list_extensions`, `reload_extension`); that tool is per-machine setup that attaches to the person's own Chrome, so without it the person clicks reload in `chrome://extensions` and decides whether to install it.
- **Safari**: `update-safari-extension`.

Only the main agent loads or reloads extensions, and every extension keeps its load path; a delegated agent asks the main agent instead. When the Claude in Chrome tools report no connected browser, ask the person to run `/chrome` and choose Reconnect, then to quit and reopen Chrome if that fails.

Open your own tab, or refresh the reported one once it has no unsent draft or running response, then confirm a marker from this change before collecting evidence: an extension reload alone leaves old content scripts running in open tabs. When someone reported an old build, check their tab too. A refresh to test is not normal navigation; `AGENTS.md` keeps those rules.

## 2. Drive the page

Read the real DOM and computed styles, and compare them with the assumption under test; record the first mismatch with enough surrounding DOM to explain it. Before reasoning about a host's markup, read the site's section of [references/host-shapes.md](references/host-shapes.md).

- **Coordinates**: clicks use the frame the screenshot result reports. Compute targets in JavaScript as CSS px divided by `innerWidth / frameWidth`, then click the result.
- **Typing**: type only right after a JavaScript check shows `document.activeElement` is the Voyager input you expect (inside the section's shadow root when it has one). Enter goes only to that input. A click that opened something else gets closed before the next step.
- **Settings**: the popup and options pages are out of reach of page scripts. On the dev build, post to the dev settings bridge from the page and await its `gv-dev-settings-result` reply (`src/pages/content/devSettingsBridge.ts` has the request shape). Read the value first and restore it when done. `area: 'sync'` holds ordinary settings and the Gemini/AI Studio plugins bound in `LEGACY_ENABLE_BINDINGS` (`src/features/plugins/storage/legacyEnableBindingTable.ts`); every other plugin keeps `enabled` and settings in `gvPluginsState` with `area: 'local'`, a missing entry meaning its default (`storage/pluginDefaults.ts`). `set` replaces the whole map: `get`, change one entry, `set`. A host's plugin catalog cache entry can be read or written as `gvPluginHostCatalog:<host>` in `area: 'local'`.
- **Background tabs**: a tab opened by a tool can stay `visibilityState: 'hidden'`, where `requestAnimationFrame` never fires, so focus or layout done in a frame callback looks broken there. Check `document.visibilityState` before calling it a bug.
- **Themes**: to capture the other theme, flip the host's own theme marker on the page (the attribute or class its `site.json` theme descriptor reads), capture, and flip it back; the person's site setting stays as it was.
- **Probes**: a temporary element can test a CSS rule when the rule is new in this change; remove it afterward.
- **Test data**: name what you create "Voyager 测试" so it is easy to find; filing and unfiling are reversible. The host's own send, delete, rename and pin stay untouched.

## 3. Show the evidence

Capture the changed element with `zoom` and `save_to_disk`, cropped to the part a reviewer needs, in light and dark when CSS changed. Keep conversation content out of shared captures when it is private.

One crop: report its path. Several crops or sites: put them in one page with a caption per crop and publish it as an Artifact (or an HTML file when Artifacts are unavailable), and give the link. A page from earlier in the session gets republished to the same link.

Report each site at the level you reached (`Loaded`, `Live` in [browser-testing.md](../voyager-contribute/references/browser-testing.md)). A step you could not drive is unverified: say which and why. List anything you left behind (test folders, a stray message) so the person can decide whether to delete it, and close the tabs you opened.
