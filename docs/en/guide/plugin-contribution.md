# Plugin Contribution Guide

Voyager's plugin system is designed around declarative plugins: describe plugin metadata and DOM operations in `plugin.json`, then describe visual changes in CSS. Plugins do not run remote JavaScript; Voyager's built-in plugin engine interprets the manifest and styles.

This keeps plugins easier to review and maintain. If you want to contribute a plugin, start here first.

## Just for yourself: local plugins

A plugin you only need in your own browser does not go through this process. Make it as a local plugin and import it in the popup: no Issue, no PR, no repository checkout. The quickest way is [Create mode](./create-mode.md): one sentence, and the site's AI writes it. To hand it to a coding agent or write it by hand, see [Write your own plugin](./write-a-plugin.md), including the `create-voyager-plugin` checker and the skill for coding agents.

## Recommended path

1. Confirm that the idea fits a plugin: reading width, layout fixes, theme tweaks, hiding or marking page elements, and simple site adaptations are usually good candidates.
2. Open an Issue in the Voyager repository first. Explain the problem, target website, and difference from existing plugins; wait for explicit maintainer approval before coding or opening a PR.
3. Use `plugin.json` for metadata, site matches, settings, and contributions.
4. Put styles in `style.css` in the same plugin directory, then reference it from `contributes.styles`.
5. Test locally and include test pages, screenshots, or a short recording in the PR. Maintainers will decide whether it is ready for the official catalog.

## Directory layout

Official bundled plugins live under `src/features/plugins/catalog/`, one
directory per plugin platform:

```
src/features/plugins/catalog/
  marketplace.json                        hand-kept site plugin index, checked by a test
  sites/<site>/site.json                  the site adapter, as data
  sites/<site>/plugins/<id>/plugin.json   a declarative plugin
  sites/<site>/plugins/<id>/style.css     its styles
  sites/<site>/plugins/<id>/README.md     what it fixes and why
```

Discovery is automatic: `catalog/sites/index.ts` finds every `site.json` and
every `plugin.json` with `import.meta.glob`, so adding a site or a plugin means
adding files. There is no mapping table to edit.

`marketplace.json` is not that mapping table. It is a hand-kept index of the
site plugins, and a test keeps it in sync with discovery, so a new plugin also
needs an entry there (`bun run plugin:new` appends it for you). Its `source` is
the catalog-relative path, for example
`sites/deepseek/plugins/reading-width/plugin.json`. Plugins under `sites/gemini/`
and `sites/aistudio/` are the exception: they ship inside Voyager and stay out
of `marketplace.json`. The [All plugins](/en/guide/plugins) table reads the
manifests from disk, not this file.

A plugin's `matches` must stay inside the `matches` of the site it lives under.
A plugin that reaches outside its own site fails the build.

## Semantic selector keys

`site.json` maps a fixed vocabulary of semantic keys to site-specific CSS
selectors. The vocabulary is defined in
`src/features/plugins/sites/semanticKeys.ts`; a `site.json` may only use keys
from this list, and an unknown key is rejected.

- `userTurn`: a user message container.
- `assistantTurn`: an assistant message container.
- `thinkingBlock`: the reasoning section inside an assistant turn.
- `codeBlock`: a rendered code block.
- `composer`: the prompt input the user types into.
- `sidebar`: the conversation list or navigation rail.
- `sidePanel`: a secondary panel, such as artifacts or canvas.
- `headerActions`: the top-right action cluster of the conversation view.
- `scrollContainer`: the element that scrolls the conversation.
- `composerRoot`: the container around the prompt input and its action buttons.
- `sendButton`: the button that sends the prompt; some sites show it only once the prompt is non-empty.

A site only declares the keys it can actually provide. Plugins reference a key
instead of a raw selector by using `{ "kind": "semantic", "key": "userTurn" }` as
a DOM operation `target`, so a site redesign is a one-file fix in `site.json`.

`conversationIdPattern` is a separate `site.json` field rather than a selector:
it is a regular expression over the URL path whose first capture group is the
conversation id, such as `^/chat/([^/?#]+)`.

[Adding a new platform](./adding-a-platform.md)

## Plugin scope

Plugins should be scoped by the user problem they solve, not mechanically split by platform.

A catalog plugin lives in one site folder, and every one of its `matches` must be covered by that folder's `site.json` (`bun run plugin:check` fails otherwise), so one plugin cannot cover both Claude and ChatGPT. When the same feature fits several platforms, such as reading width, page navigation, or code block layout, ship one plugin per site folder (for example `sites/claude/plugins/reading-width` and `sites/chatgpt/plugins/reading-width`) and keep their names, settings, and descriptions consistent.

If each platform needs very different settings, DOM logic, or user-facing copy, separate plugins are clearer. Do not force unrelated behavior into one plugin just to make it "cover everything"; one plugin should solve one clear problem.

Quick rule:

- Same user goal, same settings, only different selectors: make one plugin per site folder, with consistent names and settings.
- Same theme, but platform behavior differs a lot: split it, while keeping names and descriptions related.
- Different goals: do not merge them.

## Avoid duplicate plugins

Before submitting, check the existing official plugins in [All plugins](/en/guide/plugins). If a good plugin already exists, improve it instead of creating a similar one.

A duplicate plugin is only worth accepting when it has a clear improvement, such as:

- It supports an important platform the original plugin does not cover.
- It fixes a compatibility issue the original plugin cannot solve.
- It has clearly better performance, accessibility, or maintainability.
- It offers a different and meaningful user experience, not just a renamed or lightly restyled copy.

This keeps the plugin list lean and helps users choose.

## Minimal example

Start from the scaffold instead of an empty directory: `bun run plugin:new <id-segment> --site <site>` creates `catalog/sites/<site>/plugins/<id-segment>/` with a `plugin.json`, a `style.css` and a `README.md`, and appends the `marketplace.json` entry for you. What it writes is a starting point, not an approval; the manifest you fill in has this shape:

```json
{
  "$schema": "https://voyager.nagi.fun/plugin.schema.json",
  "id": "your-name.example-plugin",
  "name": "Example Plugin",
  "version": "1.0.0",
  "description": "A short description of what this plugin improves.",
  "author": "your-name",
  "category": "readability",
  "license": "MIT",
  "engine": ">=1.0.0",
  "tier": "declarative",
  "matches": ["https://claude.ai/*"],
  "contributes": {
    "styles": [{ "file": "style.css" }],
    "domOps": [
      {
        "op": "addClass",
        "target": "body",
        "className": "gv-plugin-example"
      }
    ]
  }
}
```

The `$schema` line is optional and only for your editor: it points at the manifest JSON Schema so the file is validated and completed as you type. A `site.json` has its own at `https://voyager.nagi.fun/site.schema.json`.

`style.css` can use normal CSS, but plugin styles should be scoped under your own `gv-plugin-*` class:

```css
.gv-plugin-example .some-target {
  max-width: 880px;
}
```

## Manifest notes

- Use a reverse-domain style or author prefix for `id`, such as `your-name.reading-width`, to avoid collisions.
- Keep `matches` narrow. Match only the websites where the plugin really needs to run.
- A plugin's `matches` may list several hosts only when its site's `site.json` covers all of them (for example chatgpt.com and chat.openai.com); to cover another site, add a plugin in that site's folder.
- Recommended `category` values: `render-fix`, `theme`, `layout`, `readability`, `productivity`, `integration`, or `other`.
- Set `engine` to the lowest Voyager version the plugin needs. Official plugins can be used as examples.
- Add `i18n` for Chinese, English, and other common languages when possible.

## CSS and resource limits

Declarative plugins are validated as untrusted input, so keep resources self-contained:

- Do not use `@import`.
- Do not reference remote images, external fonts, or remote CSS.
- You may use normal CSS, custom properties, and Voyager setting value substitutions.
- Prefix plugin classes with `gv-plugin-` to avoid leaking styles into the host website or Voyager itself.

If your plugin needs settings, start with numeric settings when possible. For example, a reading-width plugin can write a setting value into a CSS variable and let CSS consume it.

[DOM operation boundaries](./dom-operation-boundaries.md)

## When not to use a regular plugin

If a feature must execute JavaScript, intercept network requests, read or write Voyager internal data, or depend on complex runtime logic, it is not a good fit for a regular declarative plugin.

Open an Issue first and describe the need. If it truly requires built-in capability, we may consider implementing it in the Voyager repository as a builtin/native plugin, like Formula Copy.

## Before opening a PR

Run `bun run plugin:check <plugin dir>` and paste its output in the PR. It reports every problem at once, from the manifest and CSS to site containment, primitives, semantic keys, the ten locales and the README, and CI runs the same check over every bundled plugin.

- The plugin is disabled by default and users enable it themselves.
- You checked that there is no nearly identical plugin; if there is, improve the existing plugin first.
- You tested light and dark themes on the target website.
- `matches` does not cover unrelated sites.
- There are no remote resources.
- The plugin directory includes `plugin.json`, required CSS files, and a short README.
- For an official plugin, the directory sits under `catalog/sites/<site>/plugins/<id>/`, its `matches` stay inside the site's `matches`, and `catalog/marketplace.json` lists it (except Gemini and AI Studio plugins, which ship with Voyager).
- The PR describes test pages, screenshots or recordings, and affected page areas.

Keep it simple, focused, and reversible. A plugin that solves one clear problem is much easier to merge and maintain.
