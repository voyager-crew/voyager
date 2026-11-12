# Docs screenshot rig

Guide screenshots of Voyager's own UI, taken without the owner's browser or any real AI site. A throwaway Chrome for Testing loads `dist_chrome_dev` and resolves `gemini.google.com` to a local HTTPS server. That server serves `replica/`, a neutral page with only the structure Voyager's Gemini adapter reads. Every other host is unreachable. Voyager runs its real Gemini code there, and a scene stages the rest: the AI's replies, the model name and the theme.

There is no account, history or avatar to crop around, and nothing reaches a real AI.

## Run

```sh
bun run dev:chrome                   # or one build: __DEV__=true npx vite build --config vite.config.chrome.ts --mode development
bun scripts/docs-shots/run.ts &      # rig; --show for a window
bun scripts/docs-shots/createMode.ts zh
```

`createMode.ts` writes `docs/public/assets/create-mode-*-<lang>.png`. Run each language on a fresh rig (restart `run.ts`), because creations installed by one run would show as installed in the next. It needs Chrome for Testing (`npx @puppeteer/browsers install chrome@stable`, or `CHROME_BIN`): branded Chrome ignores `--load-extension`.

## Explore a scene

`do.ts` runs one step against the running rig: `setup`, `eval`/`peval` (page / panel frame), `click`, `pclick` (a panel control by text or selector), `key`, `type`, `shot`, `pshot`. Page scripts get `gv.settings(request)` over the dev settings bridge, and `__replica` stages the page:

| Call                                   | Effect                                                             |
| -------------------------------------- | ------------------------------------------------------------------ |
| `__replica.queueReply({ text, code })` | The next message sent gets this reply, `code` as a json code block |
| `__replica.exchange(user, reply)`      | Shows a finished exchange at once                                  |
| `__replica.setModel('Flash')`          | The model switch label Voyager reads                               |
| `__replica.setTheme('dark')`           | Flips the theme marker in `site.json`                              |
| `__replica.setChats([...])`            | Neutral sidebar rows                                               |

Captures are 2x (1440×900 CSS px viewport); `rig.shot(out, box, 0.5)` gives 1x, as the heroes use.

## Keep it working

The replica follows the selectors in `src/features/plugins/catalog/sites/gemini/site.json` and `selector-data/` (composer, turns, code blocks, model switch, new-chat link). When a scene finds nothing, compare the replica with the selector the feature reads; the real host page is still the proof for behavior (`verify-in-browser`). Keep the replica's look neutral: it stands behind Voyager's controls and must not imitate the site.
