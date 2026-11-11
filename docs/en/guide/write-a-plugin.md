# Write Your Own Plugin

Create mode turns one sentence into a plugin. You say what should change, an AI writes the plugin, and Voyager checks it before it runs. Create mode is the **Create** tab of the Voyager panel and the **My creations** card of the Voyager popup, and what it makes is a local plugin.

A local plugin is a plugin you make for yourself. It changes how Gemini, AI Studio, ChatGPT, Claude, DeepSeek or Kimi looks or is laid out, it lives only in your browser, and it needs no pull request and no copy of the Voyager source.

Most creations are declarative: a `plugin.json` manifest plus CSS that runs no code of its own. Voyager checks it on import, applies its changes, and removes every change when you turn it off. An imported plugin starts switched off, so you can review it first. When a request needs code, the AI can write a creation that runs code instead, described below.

## Create on the page

The quickest way runs on the AI site the plugin is for. Open the [Voyager panel](./panel.md) there and choose **Create**.

1. Write one sentence under **What should change?** and choose **Create on this page**.
2. Voyager opens a new chat on that site and puts the request in the message box. Read it, then send it yourself: Voyager never presses send. If the message box already holds text, Voyager leaves it alone and says so.
3. The AI reads Voyager's page for the site and replies with one JSON code block. Under the block, Voyager adds **Preview and install**.
4. Choose it. The panel opens on a review: the sites the plugin runs on, each change, its CSS in full and anything to check first. Choose **Install and turn on**, and it applies right away.

To change the plugin, tell the AI in the same chat. Under its new reply Voyager offers **Preview update**, and the older block reads **Earlier version**. When Voyager can't install a reply, it offers **Send the problems back to the AI** instead: the problems go into the message box, below anything you typed, for you to send.

Voyager reads replies only in a chat where your message links Voyager's create page, which the request from **Create on this page** always does. In any other chat nothing appears under the replies; use the popup ways below. The **Create** tab also has **Copy for a local agent**.

## Three more ways

Each way ends in **My creations**. On Gemini and AI Studio it is a settings card, right below **Cloud Sync** unless you move it, and **Jump to** at the top of the popup links to it. On ChatGPT, Claude, DeepSeek and Kimi it sits under the plugin list. **Create your own**, at the end of the plugin list, takes you to its first field.

The first two ways start from one sentence. Write it under **What should change?** ("Make my messages narrower and hide the sidebar"). The **Site** below it starts as the site of your current tab; change it if the plugin is for another site.

### Copy for this chat

1. Choose **Copy for this chat** and paste the message into the AI chat on that site.
2. The AI reads Voyager's page for the site, such as `https://voyager.nagi.fun/create/claude.md`, and replies with one JSON code block. The AI needs to be able to open links.
3. Paste the whole reply under **Paste the AI’s reply** and choose **Check reply**.
4. Voyager shows what the plugin changes in plain language. Choose **Import**, then turn the plugin on in the plugin list. On Gemini and AI Studio its switch appears right below the card.

Voyager sends nothing itself. You paste the message, and you carry the reply back.

### Copy for a local agent

If you use a coding agent (Claude Code, Codex, Cursor and the like), choose **Copy for a local agent** and give the text to the agent. It asks the agent to follow Voyager's plugin skill:

```text
https://voyager.nagi.fun/skills/write-voyager-plugin/SKILL.md
```

The skill holds the full contract: the manifest fields, what each site declares, the primitives, and what a plugin cannot do. The agent writes `plugin.json` and `style.css`, runs `npx create-voyager-plugin@latest check` until they pass, and hands both files back. In **My creations**, open **More ways to add**, choose **Import files** and pick both files.

To keep the skill installed, save the file as `write-voyager-plugin/SKILL.md` in your agent's skills folder (for Claude Code, `~/.claude/skills/`).

### Write it by hand

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
- On ChatGPT, Claude, DeepSeek and Kimi, turn on a Voyager primitive (formula copy, the timeline, Mermaid diagrams and others) and tint Voyager's own UI.

## What it cannot do

A declarative plugin cannot run JavaScript, react to clicks or keys, load anything from the network (fonts, images, stylesheets), read or rewrite what a message says, or run on other sites. When only code would do, the AI writes a creation that runs code, described below. No creation can run on other sites or change Voyager's own settings; for a request like that, the authoring material tells the AI to say so and to build the closest version that works.

## Creations that run code

When CSS and page changes can't do what you asked, such as counting your messages or reacting to a click, the AI can write a creation that runs JavaScript. Voyager runs it through Chrome's user scripts, only on the sites it lists, and only after you have read it.

### Turning one on

The review marks such a creation with a **Runs code** badge.

- **Read it**: the review lists the sites it runs on and shows its full source. It can read everything on those pages, and Voyager cannot stop it from sending what it reads elsewhere, so install only code you trust.
- **Install and turn on**: turns on exactly the code you read. If its code or sites change later, it pauses until you review it again, and the switch never syncs to your other devices.
- **One-time switch**: Chrome lets an extension run such code only after you allow it. Choose **Open Voyager's details page**, turn on **Allow User Scripts** there (before Chrome 138, **Developer mode** at the top of `chrome://extensions`), then come back and choose **I turned it on**.
- **Browsers**: desktop Chrome or Edge 133 or newer. On Safari, Firefox and phones it stays installed but paused; ask the AI for a version that only changes how the page looks.

### Staying in control

In **My creations**, each one shows **On, this device only**, **Off**, or **Paused** with the reason.

- **Stop all**: **Stop all creations that run code**, in **My creations** or the panel's **Create** tab, stops every one at once; **Resume** starts them again.
- **Open pages**: a page that is already open keeps running them until it reloads. **Reload this page** does that for the current tab.
- **Freezes**: if a page stops responding after these creations ran on it, Voyager turns them off and names them in a notice the next time the page loads. Once the creation is fixed, review it in **My creations** and turn it back on.

## Rules the import checks

Beyond the shared manifest checks (see [Plugin Contribution](./plugin-contribution.md)), a local plugin must:

- match only URLs inside a site Voyager supports;
- use only semantic anchors that every matched site declares;
- add exactly one class per `addClass`, starting with `gv-`;
- use boolean, number or select settings (string and color have no popup control yet);
- not use a `theme` on Gemini or AI Studio, and use only the primitives each allows: `formulaCopy`, `vimInput`, `userLatex`, `codeCollapse`, `mermaid`, `wavedrom` and `echarts`, `sendShortcut`, `draftSave`, `turnNavigator` on Gemini, `formulaCopy` and `sendShortcut` on AI Studio. They run the same code as Voyager's own settings. `formulaCopy` and `vimInput` (Formula copy and Input Vim mode) each run once per page, the built-in setting or a plugin, not both. When the page loads, or while neither is running, the built-in setting goes first; after that, whichever is already running keeps running and the other shows as paused. Turn one off to hand the feature to the other. `userLatex`, `codeCollapse`, `mermaid`, `wavedrom` and `echarts` claim the page element by element and run alongside the built-in setting: a line or code block the other already holds is left to it.

Local `turnNavigator` now supports consumer Gemini with `params.dataBackend: "shared"` and `engine: ">=1.9.0"`. It reads and writes the same native stars and hierarchy data as the official timeline; conversation, account and turn identity parameters cannot be overridden. The official **Show Timeline** setting conflicts with it: turn that setting off before enabling the local plugin. To return to the official timeline, disable the local plugin first, then turn the setting on. Business, Enterprise and custom site coverage are not supported.

Translations (`i18n`) are optional.

## Sharing it

A local plugin stays in your browser. To move it elsewhere, choose **Export** on it in the **My creations** list, then import the JSON file there. If it would help everyone, propose it for the official catalog: [Plugin Contribution](./plugin-contribution.md) describes that path.

Only one send shortcut plugin runs per page on every site. While a plugin holds the send mode, another reports a conflict and stays paused. Optional `mode` (needs `"engine": ">=1.9.0"`) is `ctrlEnterSends` (default) or `enterSends`. IME confirmation does not send. Gemini and AI Studio now allow it; their supported modes are below.

Gemini now allows `sendShortcut` to replace the official Ctrl/Cmd+Enter feature: turn the official switch off, then enable the local plugin. Only `ctrlEnterSends` is supported; Enterprise stays inactive. `composerRoot` covers the main and edit inputs; `sendButton` excludes Stop.

On AI Studio, `sendShortcut` requires `params.mode: "enterSends"`. Turn off the official Enter send switch to let a local plugin take over. Ctrl/Cmd+Enter adds a newline; Shift/Alt+Enter follows the host.

On Gemini, `draftSave` shares the official `gvDraft_<full pathname>` records, including `/u/N` and Gem routes. Disabling keeps saved drafts; several plugins on the same page may use these records. Page teardown tries to save the last input, but browser closure cannot guarantee asynchronous storage completion. Writes and pruning are coordinated only on this page; switching email within one `/u/N` slot still shares stored drafts.
