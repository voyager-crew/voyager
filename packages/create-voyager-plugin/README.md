# create-voyager-plugin

Scaffold and check a [Voyager](https://voyager.nagi.fun) local plugin offline. A local plugin is a JSON manifest plus CSS that restyles a chat page on Gemini, AI Studio, ChatGPT, Claude or DeepSeek; you import it from the Voyager popup.

```sh
npx create-voyager-plugin@latest init my-plugin --site claude
npx create-voyager-plugin@latest check my-plugin
```

- `init [dir] --site <site> [--force]` writes `plugin.json`, `style.css` and an `AGENTS.md` that tells a coding agent the rules for that site. The scaffold already passes `check`. It refuses to overwrite those files unless you pass `--force`.
- `check [dir] [--json]` reads `plugin.json` and the `.css` files beside it, then runs the same checks as the popup's **Import files**. It exits 0 when the plugin would import and 1 otherwise, printing one `path: message` line per problem (`--json`: an array of `{ path, message }`).
- `skill [--out <dir>]` writes the [write-voyager-plugin skill](https://voyager.nagi.fun/skills/write-voyager-plugin/SKILL.md) for every site into `<dir>`: `SKILL.md` plus the `sites/<site>.md`, `primitives.md` and `examples.md` it links. Without `--out` it prints all of them, SKILL.md first.
- `create-pages --out <dir>` writes the page a chat AI reads before it writes a plugin, one `<site>.md` per site (served at `https://voyager.nagi.fun/create/<site>.md`).
- `--version` (`-v`) prints the Voyager version this CLI was built from and its plugin engine version; `--help` (`-h`) prints usage.

The checks are Voyager's own source, bundled into one file with no dependencies, and the package version follows the extension's. A CLI newer than your installed Voyager may accept a plugin that needs a newer engine; an older Voyager then refuses it or leaves it off until you update.

Guide: [Write your own plugin](https://voyager.nagi.fun/en/guide/write-a-plugin).

## Development

Repository contributors may use `"engine": ">=next"` for an unreleased primitive. The CLI resolves it to the released engine plus one minor before checking; local popup imports require a concrete `>=x.y.z` from the primitive reference. Catalog publishing and release stamping supply that concrete version.

From the Voyager repository root: `bun run cli:build` builds `dist/cli.mjs`; `bun run skills:build` also regenerates `docs/public/skills/write-voyager-plugin/` and `docs/public/create/`. Tests live in `test/` and run with the main suite.
