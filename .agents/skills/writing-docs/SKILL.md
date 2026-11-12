---
name: writing-docs
description: Sets the standard for Voyager's guide pages and their screenshots. Use when editing or adding a page under docs/guide/ or any locale's docs/<lang>/guide/, or when taking or replacing a docs screenshot.
metadata:
  version: '1.0.0'
---

# Writing a guide page

Voyager runs on several AI sites and gains more. A page describes a feature once, with the site differences carried by data, so a new site needs no prose edit. `docs/guide/folders.md` is the reference page.

## Shape

1. One page per feature, never per platform. Open with one or two plain sentences on what it does for the person.
2. Right after the intro, `<SiteSupport feature="<id>" :labels="{ … }" />` (`docs/.vitepress/theme/components/SiteSupport.vue`). Its rows and ticks come from shipped code through `docs/.vitepress/siteSupport.ts`: the feature's own row from the plugin table (`pluginsPage.ts` `featureRows`), then the capability rows in `FEATURE_CAPABILITIES`. The page only supplies row labels; an unlabelled row shows its id.
3. A capability that differs by site gets a row in `FEATURE_CAPABILITIES`, derived from code data (plugin manifests, `catalog/sites/<site>/site.json`, popup allowlists). Trace where it is wired before adding one. When no data can say it, add a footer row by hand, `:only="[{ id: 'move-menu', sites: ['gemini', 'claude'] }]"` with its label in `:labels` (`**…**` bolds a UI label), and say so in your report. Nothing else is hand-ticked.
4. Sections by operation (filing, nesting, import/export, …), not by platform. Short sentences, no marketing filler, no em-dash asides. An operation is a lead sentence, then 3 to 5 bullets that each open with a bold trigger word and stay within two lines; longer asides go in `<GuideNote>`.
5. Every claim is checked against code before it is written. Quote UI labels from `src/locales/<lang>/messages.json` exactly. Drop or fix anything stale rather than carrying it over.
6. Zh (`docs/guide/`) and en are written natively. The other 8 locales are translated naturally from en with the same structure, links to their own locale's pages, and the same images.

## Layout blocks

Registered in `docs/.vitepress/theme/index.ts`, styled in `theme/guide.css` (`gvg-` classes). Markdown inside a block needs a blank line after the opening tag and before the closing one; a one-line form breaks hydration.

```
<GuideHero src="/assets/x-light.png" dark="/assets/x-dark.png" alt="…">

Where it is, as the caption.

</GuideHero>

## Operation heading

<GuideOp side="end">

<GuideShot src="/assets/x-nested-zh.png" alt="…" :width="240" />

Lead sentence.

- **Trigger**: what it does.

</GuideOp>
```

- Page order: intro, `<SiteSupport>`, `<GuideHero>` (no "where is it" heading; its sentence is the caption), then `##` sections. The hero is full width at 16:10; without `dark` the light image serves both themes.
- `<GuideShot>`: `width` is always set, in CSS px (half the 2x asset). `kind="crop"` (default) is a Voyager element on a soft backdrop; `kind="panel"` is a popup or window region in a card frame. The slot, if any, is the caption.
- `<GuideOp side="end">` moves its shot beside the text in a 288px column once the section is 600px wide, and puts it first below that. Use it for tall crops (width/height ≤ 1.2) up to 256px wide; a wide crop goes in a plain `<GuideOp>` after the text, with a `width` up to the column (about 640). Text-only sections still use `<GuideOp>`. One crop per operation; split into an `###` with its own `<GuideOp>` for a second one.
- Small related facts: their own `##`, then `<GuideFacts>` holding `<GuideFact title="…">` cards (2-up). A card's "read more" is a markdown link as its last paragraph, so the build checks it; a shot inside is capped at 160px.
- Procedures: `<GuideSteps>` with one `<GuideStep>` per step (numbered by CSS); a `kind="panel"` shot may sit inside a step.
- No inline `style`/`width` on images and no bare `<img>` in guide pages. Headings get space, not rules, on these pages.

## Screenshots

```
- [ ] Exactly one `<GuideHero>` answering "where is it": light and dark, about 1380×860 (sidebar plus some of the page, demo folders only)
- [ ] At most one element-only crop per operation, of Voyager's own component
- [ ] Taken live from the dev build, light theme, about 2x: on the Gemini replica ([scripts/docs-shots](../../../scripts/docs-shots/README.md)) when a scene can be staged there, else on the real site (verify-in-browser)
- [ ] Saved under docs/public/assets/ with a descriptive name; -zh and -en variants when the crop has text
- [ ] zh and zh_TW use -zh, every other locale uses -en
- [ ] Privacy check passed (below); images no page references are removed
```

For 2x clarity, set `document.documentElement.style.zoom = '2'` before `zoom` + `save_to_disk`; floating menus may then render off-screen, so move the menu with inline `inset` and put a temporary white backdrop behind it. Undo both afterwards.

**Privacy, a hard rule.** These images are public and the browser is the owner's real account. A crop shows no real conversation titles, account names, avatars or emails. Crop tightly to the Voyager component. Where a crop needs folders, use a site whose folder bucket you can save and restore, write demo folders with neutral names ("Research", "Writing", "Travel"; "研究", "写作", "旅行" for zh), show folder rows only, never chat rows, then restore the original bucket exactly and confirm it. Never file, rename, delete, pin or send anything of the host's. Restore every setting you changed through the dev settings bridge, including `language`. If an image cannot be taken without private content, keep the existing asset or skip it and say so.

## Verify

`bun run docs:build` (it fails on dead links), `bunx oxfmt --check` on changed files, and the `docs/.vitepress/*.test.ts` tests when `siteSupport.ts` changes. Then run `bun run docs:dev`, open the zh and en pages, and capture the rendered page in light and dark (VitePress theme toggle) at 1280px, plus zh at 375px, so the owner sees the real site. Check `ar` once for RTL when a block changes.
