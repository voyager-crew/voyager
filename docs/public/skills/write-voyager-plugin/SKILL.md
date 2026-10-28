---
name: write-voyager-plugin
description: "Voyager plugin authoring: write and check a local plugin (a JSON manifest plus CSS) for the Voyager browser extension. Use when the user wants to change how Gemini, AI Studio, ChatGPT, Claude, DeepSeek or Kimi looks or is laid out through Voyager; to add a small feature Voyager ships as a primitive (copy button, word count, collapse, diagrams, draft save, Ctrl+Enter send, timeline); or to check or fix a plugin that fails to import."
---

# Write a Voyager plugin

Voyager is a browser extension for AI chat sites. A local plugin is a declarative JSON manifest (plugin.json) plus CSS that restyles or rearranges a chat page through reversible page changes. It runs no code of its own: Voyager checks it strictly on import, applies it, and removes every change when the plugin is turned off.

This skill is generated from Voyager’s plugin engine 1.10.0. The latest copy is at https://voyager.nagi.fun/skills/write-voyager-plugin/SKILL.md.

## Files to read

This skill is split into files. The links below are relative to this SKILL.md; when a file is not beside it (you read this over the web, or only SKILL.md was saved), fetch it from https://voyager.nagi.fun/skills/write-voyager-plugin/<path>.

- Before you write or fix a plugin, read the site file of every site it targets. It has the URL patterns "matches" must use, the semantic anchors the site declares, which primitives run there and the site’s caveats:
  - Gemini: [sites/gemini.md](sites/gemini.md)
  - AI Studio: [sites/aistudio.md](sites/aistudio.md)
  - ChatGPT: [sites/chatgpt.md](sites/chatgpt.md)
  - Claude: [sites/claude.md](sites/claude.md)
  - DeepSeek: [sites/deepseek.md](sites/deepseek.md)
  - Kimi: [sites/kimi.md](sites/kimi.md)
- Read [primitives.md](primitives.md) when the request needs behavior that CSS and the four page changes cannot give: copy buttons, counters, collapsing long content, diagrams (Mermaid, ECharts, WaveDrom), saving drafts, send shortcuts, a conversation timeline, formula copy, Vim input or rendering the user’s own LaTeX. Always read it before answering NOT POSSIBLE.

## Workflow

1. Find out which site the change is for and what should change. Then scaffold a folder:
   `npx create-voyager-plugin@latest init my-plugin --site <site>` (site: gemini, aistudio, chatgpt, claude, deepseek, kimi) writes plugin.json, style.css and an AGENTS.md with this contract for that site. Without Node, write the two files by hand from the examples below.
2. Edit plugin.json and style.css for the request. Give the plugin its own "id", "name" and class names.
3. Run `npx create-voyager-plugin@latest check my-plugin`. It runs the same checks as Voyager’s popup import, offline, and exits 0 only when the plugin would import. Fix every `path: message` line it prints and run it again. `--json` prints the issues as a JSON array of { path, message }, empty when it imports.
4. Hand over to the user: open the target site, open the Voyager popup, find the "Local plugins" card (on Gemini and AI Studio it sits right below Cloud Sync, and the "Jump to" links at the top lead to it), choose Import files and pick plugin.json together with style.css. The plugin lands switched off; the user turns it on in the plugin list. Re-importing the same "id" replaces the installed version (raise "version" when you change it).
5. Ask the user to look at the page in both light and dark theme. If a selector matches nothing, see "Finding selectors".

## Manifest contract

- Required non-empty string fields: id, name, version, description, author, category, license, engine. Also "tier": "declarative", "matches" (see the site files, sites/<site>.md) and "contributes".
- "id": a short lowercase reverse-dotted slug such as "me.short-name" (a-z, 0-9, ".", "_", "-"). Voyager stores it as "local.<id>"; you do not add that prefix.
- "version": "1.0.0"; raise it when you change the plugin. "author": "me". "license": "MIT".
- "engine": ">=1.0.0", or ">=" the sinceEngine of every primitive the plugin uses. This build's plugin engine is 1.10.0.
- "category": one of render-fix, theme, layout, readability, productivity, integration, other.
- Write "name" and "description" in the language of the user. "i18n" translations are optional for a local plugin.
- Optional: "$schema": "https://voyager.nagi.fun/plugin.schema.json" lets an editor check the file as you type. The import gate is stricter than the schema; `check` is the authority.

## Styles

- "contributes.styles": [{ "file": "style.css" }] with the CSS in style.css beside plugin.json. The popup’s Import files takes exactly one .json file: the user picks plugin.json and its .css files, nothing else. Paste JSON only takes inlined CSS ([{ "css": "..." }]).
- CSS may not load anything, not even from the same site: no @import, image-set(), image(), cross-fade() or src(), and url() only with a #fragment or a png, jpeg, gif, webp or avif data: URI (never SVG). No web fonts, no remote images.
- Scope every rule under a class your plugin adds (see addClass), so nothing else changes. Site styles often win on specificity: add !important where a rule does not apply.
- Light or dark only rules: scope them with html[data-gv-scheme='dark'] or html[data-gv-scheme='light'], never with the site's own theme classes.

## Page changes

- "contributes.domOps": reversible page changes. Allowed "op" values: addClass, setAttribute, setStyle, hide, and "native" where the site allows primitives. Voyager applies them to every match, again as the page changes, and removes them when the plugin is turned off. One example of each:
  - addClass: { "op": "addClass", "target": { "kind": "semantic", "key": "userTurn" }, "className": "gv-plugin-my-change" }
  - setAttribute: { "op": "setAttribute", "target": { "kind": "semantic", "key": "userTurn" }, "name": "data-gv-plugin", "value": "my-change" }
  - setStyle: { "op": "setStyle", "target": { "kind": "semantic", "key": "userTurn" }, "styles": { "max-width": "960px" } }
  - hide: { "op": "hide", "target": { "kind": "semantic", "key": "userTurn" } }
- "target": prefer { "kind": "semantic", "key": <anchor> } with an anchor the target site declares. Use a plain CSS selector string only for something no anchor names; it breaks on a redesign.
- addClass "className": exactly one class that starts with "gv-"; use "gv-plugin-<plugin-name>". Then style that class in "contributes.styles".
- setAttribute "name" must be one of: title, role, lang, dir, hidden, tabindex, draggable, spellcheck, translate, style, data-*, aria-*. Never href, src, on*, class or id. Values may not contain an external URL.
- setStyle "styles": CSS property -> value, custom properties (--gv-…) included; values may not load anything either. A value may end in !important; engines before 1.9.0 drop such a value, so require engine ">=1.9.0" when the plugin relies on it.

## Settings (optional)

- "contributes.settings": { "<key>": { "type", "label", "default", … } }. Types: boolean, number, select. string and color settings are refused: the popup has no control for them yet.
- number: the popup shows a slider from "min" to "max" (0 and 100 when omitted), with optional "minLabel" and "maxLabel" at its ends.
- select: "options": [{ "value": "…", "label": "…" }] with at least one option and unique values, and a "default" that is one of the values.
- Optional "enabledBy": "<booleanKey>" keeps a number, select or boolean control visible but disabled unless that other boolean setting of the same plugin resolves to true. That boolean has no enabledBy of its own (one level only). It changes only the popup control, so gate page behavior with the boolean too. It needs no higher engine floor: engine 1.7.0 just leaves the control enabled.
- Use a setting through a {{key}} token in CSS text, a setStyle value or a setAttribute value; Voyager substitutes the current value (the default until the user changes it). A common pattern: setStyle sets a custom property from the setting, and the CSS reads var(...).
- A boolean renders as "true" or "false": set data-gv-… to "{{key}}" with setAttribute and style [data-gv-…='true'].

## Local plugin rules

- "matches" may only use the URL patterns of a site Voyager supports (see the site files, sites/<site>.md).
- Every semantic key the plugin relies on must be declared by every site its "matches" cover.
- On Gemini and AI Studio: no "theme", and a "native" op only for the primitives listed for that site (Voyager runs its other features there itself).
- "theme": { "brand": "#rrggbb" } optionally recolors Voyager’s own UI on Claude, ChatGPT, DeepSeek or Kimi. "requires" is optional: native ops already imply "requires.handlers". "requires.formFactors" defaults to ["desktop", "mobile"]; write ["desktop"] only for a plugin that cannot work on a phone.
- The site-check route fields ("routeWords", "accountSlots", "conversationRoutes") and the Prompt Manager "prompt" section come only from Voyager’s packaged site.json, so a local plugin cannot set them.
- An import lands switched off; the user reviews it and turns it on in the popup.

## Finding selectors

- Use a semantic anchor whenever one names the element. Otherwise ask the user to open the site, press F12 and inspect the element in the Elements panel.
- Have them test a selector in the Console: document.querySelectorAll('<selector>').length should count what you expect (for example one per message); 0 means it is wrong.
- Prefer data-testid, aria-*, role and stable element names. Avoid generated class names (hashes such as css-1x2y3z): they change with every site deploy.
- Do not guess selectors you cannot verify: tell the user which ones to check.

## What a plugin cannot do

- It cannot run JavaScript or any code of its own: no event handlers, clicks, timers or keyboard shortcuts.
- It cannot make network requests or load anything: remote images, fonts, stylesheets or scripts.
- It cannot read, rewrite or translate what a message says, or store and sync data beyond its own settings.
- It cannot add buttons or links that do something, open pages, download or copy (CSS ::before and ::after can add fixed text).
- It cannot decide by message content: logic, conditions or counting beyond what CSS selectors such as :has() and :nth-child() express.
- It cannot run on sites other than those listed, or change Voyager’s own settings.

These limits are on the plugin’s own fields and CSS. A primitive in [primitives.md](primitives.md) runs Voyager’s code and may provide one of them (a copy button, a count, a saved draft, a quote into the composer…): read that list before answering NOT POSSIBLE, and use the primitive when the target site declares the keys it reads.
If the request needs any of this, do not invent fields or ops: the import refuses them. Start your reply with one line "NOT POSSIBLE: <what and why>", then build the closest version this contract allows and say what it leaves out.
When nothing declarative helps, stop there and write no files.

## Examples (for ChatGPT; on another site use the "matches" and anchors from its site file)

### A class on an anchor, styled by CSS

plugin.json:

```json
{
  "id": "me.rounded-turns",
  "name": "Rounded turns",
  "version": "1.0.0",
  "description": "Round the corners of each message",
  "author": "me",
  "category": "readability",
  "license": "MIT",
  "engine": ">=1.0.0",
  "tier": "declarative",
  "matches": ["https://chatgpt.com/*", "https://chat.openai.com/*"],
  "contributes": {
    "styles": [{ "file": "style.css" }],
    "domOps": [
      {
        "op": "addClass",
        "target": { "kind": "semantic", "key": "userTurn" },
        "className": "gv-plugin-rounded-turn"
      }
    ]
  }
}
```

style.css:

```css
.gv-plugin-rounded-turn { border-radius: 16px; }
html[data-gv-scheme='dark'] .gv-plugin-rounded-turn { outline: 1px solid #ffffff22; }
```

### A setting the user adjusts in the popup

plugin.json:

```json
{
  "id": "me.turn-accent",
  "name": "Turn accent",
  "version": "1.0.0",
  "description": "A left border on each message, with an adjustable width",
  "author": "me",
  "category": "readability",
  "license": "MIT",
  "engine": ">=1.0.0",
  "tier": "declarative",
  "matches": ["https://chatgpt.com/*", "https://chat.openai.com/*"],
  "contributes": {
    "styles": [{ "file": "style.css" }],
    "settings": {
      "width": {
        "type": "number",
        "label": "Border width (px)",
        "default": 3,
        "min": 1,
        "max": 8,
        "minLabel": "Thin",
        "maxLabel": "Bold"
      }
    },
    "domOps": [
      {
        "op": "addClass",
        "target": { "kind": "semantic", "key": "userTurn" },
        "className": "gv-plugin-turn-accent"
      },
      {
        "op": "setStyle",
        "target": { "kind": "semantic", "key": "userTurn" },
        "styles": { "--gv-plugin-turn-accent-w": "{{width}}px" }
      }
    ]
  }
}
```

style.css:

```css
.gv-plugin-turn-accent { border-left: var(--gv-plugin-turn-accent-w, 3px) solid #8888; }
html[data-gv-scheme='dark'] .gv-plugin-turn-accent { border-left-color: #fff6; }
```

### A Voyager primitive (formula copy)

```json
{
  "id": "me.formula-copy",
  "name": "Formula copy",
  "version": "1.0.0",
  "description": "Click a formula to copy its LaTeX",
  "author": "me",
  "category": "readability",
  "license": "MIT",
  "engine": ">=1.3.0",
  "tier": "declarative",
  "matches": ["https://chatgpt.com/*", "https://chat.openai.com/*"],
  "contributes": { "domOps": [{ "op": "native", "handler": "formulaCopy", "params": {} }] }
}
```
