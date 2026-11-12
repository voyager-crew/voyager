# Write Your Own Plugin

To make a plugin from one sentence, see [Create Mode](./create-mode.md): the site's AI writes it, and Voyager checks it and installs it. This page covers the other two paths, handing it to a coding agent on your computer or writing it by hand, and the rules of the plugin format.

A local plugin is a plugin you make for yourself. It changes how Gemini, AI Studio, ChatGPT, Claude, DeepSeek or Kimi looks or is laid out, it lives only in your browser, and it needs no pull request and no copy of the Voyager source.

Most plugins are declarative: a `plugin.json` manifest plus CSS that runs no code of its own. Voyager checks it on import, applies its changes, and removes every change when you turn it off. An imported plugin starts switched off, so you can review it first. When a request needs code, write a [creation that runs code](./create-mode.md#creations-that-run-code) instead.

Both paths end in **My creations**: open **More ways to add**, choose **Import files** and pick `plugin.json` and `style.css`.

## Copy for a local agent

If you use a coding agent (Claude Code, Codex, Cursor and the like), write one sentence in the panel's **Create** tab or the popup's **My creations**, choose **Copy for a local agent** and give the text to the agent. It asks the agent to follow Voyager's plugin skill:

```text
https://voyager.nagi.fun/skills/write-voyager-plugin/SKILL.md
```

The skill holds the full contract: the manifest fields, what each site declares, the primitives, and what a plugin cannot do. The agent writes `plugin.json` and `style.css`, runs `npx create-voyager-plugin@latest check` until they pass, and hands both files back for you to add with **Import files**.

To keep the skill installed, save the file as `write-voyager-plugin/SKILL.md` in your agent's skills folder (for Claude Code, `~/.claude/skills/`).

## Write it by hand

With Node.js 18 or newer:

```sh
npx create-voyager-plugin@latest init my-plugin --site claude
# edit my-plugin/plugin.json and my-plugin/style.css
npx create-voyager-plugin@latest check my-plugin
```

`init` writes a `plugin.json` and `style.css` that already pass, plus an `AGENTS.md` with the rules for that site. `--site` takes `gemini`, `aistudio`, `chatgpt`, `claude`, `deepseek` or `kimi`.

`check` runs the same checks as the popup's import, offline. It exits 0 when the plugin would import, and otherwise prints one `path: message` line per problem. Add `--json` for machine-readable output.

When it passes, import both files the same way, with **Import files** under **More ways to add**.

## What a plugin can do

- Add CSS, scoped under a `gv-` class the plugin adds to the page.
- Add a class, set a safe attribute or inline style, or hide elements. Targets are semantic anchors the site declares (`userTurn`, `assistantTurn`, `composer`, …) or CSS selectors.
- Offer settings in the popup: switches, sliders and dropdowns, whose values reach CSS through `{{key}}` tokens.
- On ChatGPT, Claude, DeepSeek and Kimi, turn on a Voyager primitive (formula copy, the timeline, Mermaid diagrams and others) and tint Voyager's own UI. On any site, the `--gv-theme-*` variables on `:root` recolour Voyager: see [Create mode](./create-mode.md#recolouring-voyager).

## What it cannot do

A declarative plugin cannot run JavaScript, react to clicks or keys, load anything from the network (fonts, images, stylesheets), read or rewrite what a message says, or run on other sites. When only code would do, write a creation that runs code instead. No creation can run on other sites or change Voyager's own settings; for a request like that, the authoring material tells the AI to say so and to build the closest version that works.

## Rules the import checks

Beyond the shared manifest checks (see [Plugin Contribution](./plugin-contribution.md)), a local plugin must:

- match only URLs inside a site Voyager supports;
- use only semantic anchors that every matched site declares;
- add exactly one class per `addClass`, starting with `gv-`;
- use boolean, number or select settings (string and color have no popup control yet);
- not use a `theme` on Gemini or AI Studio, and use only the primitives each allows: `formulaCopy`, `vimInput`, `userLatex`, `codeCollapse`, `mermaid`, `wavedrom` and `echarts`, `sendShortcut`, `draftSave`, `turnNavigator` on Gemini, `formulaCopy` and `sendShortcut` on AI Studio. They run the same code as Voyager's own settings. `formulaCopy` and `vimInput` (Formula copy and Input Vim mode) each run once per page, the built-in setting or a plugin, not both. When the page loads, or while neither is running, the built-in setting goes first; after that, whichever is already running keeps running and the other shows as paused. Turn one off to hand the feature to the other. `userLatex`, `codeCollapse`, `mermaid`, `wavedrom` and `echarts` claim the page element by element and run alongside the built-in setting: a line or code block the other already holds is left to it.

Translations (`i18n`) are optional.

### Timeline, send and draft primitives

Local `turnNavigator` now supports consumer Gemini with `params.dataBackend: "shared"` and `engine: ">=1.9.0"`. It reads and writes the same native stars and hierarchy data as the official timeline; conversation, account and turn identity parameters cannot be overridden. The official **Show Timeline** setting conflicts with it: turn that setting off before enabling the local plugin. To return to the official timeline, disable the local plugin first, then turn the setting on. Business, Enterprise and custom site coverage are not supported.

Only one send shortcut plugin runs per page on every site. While a plugin holds the send mode, another reports a conflict and stays paused. Optional `mode` (needs `"engine": ">=1.9.0"`) is `ctrlEnterSends` (default) or `enterSends`. IME confirmation does not send. Gemini and AI Studio now allow it; their supported modes are below.

Gemini now allows `sendShortcut` to replace the official Ctrl/Cmd+Enter feature: turn the official switch off, then enable the local plugin. Only `ctrlEnterSends` is supported; Enterprise stays inactive. `composerRoot` covers the main and edit inputs; `sendButton` excludes Stop.

On AI Studio, `sendShortcut` requires `params.mode: "enterSends"`. Turn off the official Enter send switch to let a local plugin take over. Ctrl/Cmd+Enter adds a newline; Shift/Alt+Enter follows the host.

On Gemini, `draftSave` shares the official `gvDraft_<full pathname>` records, including `/u/N` and Gem routes. Disabling keeps saved drafts; several plugins on the same page may use these records. Page teardown tries to save the last input, but browser closure cannot guarantee asynchronous storage completion. Writes and pruning are coordinated only on this page; switching email within one `/u/N` slot still shares stored drafts.
