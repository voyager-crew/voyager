# In-Product Changelog Template (10 locales)

## Contents

- Locale order (exact 10 required)
- Section headers per locale
- Where the note is published
- Platform logo markers
- Commit → entry filtering rules
- Style guide
- Opening quote (every release)
- Template skeleton (copy-ready)
- Authoring order — Chinese first
- Reality check before saving

---

The note is the folder `src/pages/content/changelog/notes/{VERSION}/`, one file per locale (`en.md`, `zh.md`, …), and is **shown to end users in-product** and on the site's changelog pages. It is separate from the GitHub release body (see `release-body.md`).

## Locale order (must be exactly these 10)

`en` → `zh` → `zh_TW` → `ja` → `fr` → `es` → `pt` → `ar` → `ko` → `ru`

This order matches the project's i18n convention. Each locale is its own file, `{VERSION}/{lang}.md`, holding only that locale's body; the in-product viewer and the site pick the file for the reader's language and fall back to `en.md`. One file per locale keeps every file under the commit size gate however long a release gets.

## Section headers per locale

| Locale | Highlights               | New              | Fixes              |
| ------ | ------------------------ | ---------------- | ------------------ |
| en     | `### Highlights`         | `### New`        | `### Fixes`        |
| zh     | `### 亮点`               | `### 新增`       | `### 修复`         |
| zh_TW  | `### 亮點`               | `### 新增`       | `### 修復`         |
| ja     | `### ハイライト`         | `### 新機能`     | `### 修正`         |
| fr     | `### Points forts`       | `### Nouveautés` | `### Corrections`  |
| es     | `### Destacados`         | `### Novedades`  | `### Correcciones` |
| pt     | `### Destaques`          | `### Novidades`  | `### Correções`    |
| ar     | `### أبرز التحديثات`     | `### الجديد`     | `### الإصلاحات`    |
| ko     | `### 주요 변경사항`      | `### 새 기능`    | `### 수정`         |
| ru     | `### Основные изменения` | `### Новое`      | `### Исправления`  |

These are the headers of 1.9.0 through 2.0.1. Highlights holds the one to three changes worth reading first, each led by an emoji (`- 🎛️ **{Title}**: …`); leave out a section with nothing in it (1.8.1 and 1.8.2 had only Fixes). Notes up to 1.8.0 used `### What's New` / `### 新功能` instead of New; match the immediately prior release unless you have reason to deviate.

## Where the note is published

- **In-product**: the bundled note is shown after the extension updates.
- **Site**: `docs/.vitepress/changelog.ts` (since 17d391f8) builds one changelog page per locale (`/changelog` for zh, `/en/changelog`, `/ja/changelog`, …) from the same files, a `## v{VERSION}` heading per release. A version appears once `package.json` reaches it, and `deploy-docs.yml` runs on any `main` push that touches the notes or `package.json`. Pushing the bumped `main` therefore publishes the note on the site **before** the tag starts the store release, so the note must be final when `main` is pushed.

## Platform logo markers

Write `:gemini: Gemini`, `:aistudio: AI Studio`, `:chatgpt: ChatGPT`, `:claude: Claude` or `:deepseek: DeepSeek` to put that platform's mark before its name. The ids are the keys of `PLATFORM_LOGOS` (`src/core/icons/platformLogos.ts`, which also has `qwen`, `kimi`, `notebooklm`, `midjourney` and `perplexity`); an unknown id stays literal text. Both renderers (`src/pages/content/changelog/platformLogoMarks.ts` in-product, `docs/.vitepress/changelog.ts` on the site) swallow the one space after the marker, so keep the space and the name. Use the same markers in all 10 locales.

## Shortcut and setting-switch markers

- **Shortcut**: `:kbd:Alt+V:`, `:kbd:Mod+Shift+K:`. Modifiers are `Mod` (⌘ on macOS, Ctrl elsewhere), `Ctrl`, `Alt` and `Shift`, then exactly one key: a letter, digit, `/`, `.`, `,`, `F1`–`F12`, or `Enter`, `Esc`, `Tab`, `Space`, `Backspace`, `Delete`, `Up`, `Down`, `Left`, `Right`. The viewer shows a `<kbd>` in the reader's notation (⌥V, ⇧⌘K on macOS; Alt+V, Ctrl+Shift+K elsewhere); the site builds the combined `Alt/⌥+V` and redraws it for the reader once the page loads. Write the marker instead of hand-typing `Ctrl/⌘+…`.
- **Setting switch**: `:switch:voyager.gemini-quote-reply:`. In the viewer it is a working switch labelled with the plugin's localized name, reading and writing the same setting as the popup; on the site it prints the name and "turn it on or off in Voyager". Only ids in `CHANGELOG_SWITCH_TARGETS` (`src/pages/content/changelog/switchTargets.ts`) work, and each must be a legacy-bound official plugin; add one there before using it in a note. Put the marker after the sentence that introduces the setting, at most one per entry.

An invalid shortcut or an unlisted switch id renders as plain text in the viewer and fails both `bun run test` (`__tests__/shortcutMarks.test.ts` scans every note) and `bun run docs:build`. A marker inside backticks stays literal. Use the same markers in all 10 locales.

## Commit → entry filtering

Include:

- `feat(scope): …` — user-visible new feature
- `fix(scope): …` — user-visible bug fix
- `perf(scope): …` — if the speedup is noticeable to users

Exclude:

- `chore`, `style`, `refactor`, `ci`, `build`, `test` — internal
- `docs` — unless it's a brand-new user-facing guide page the user would care about
- Sponsor updates, README updates, version bumps
- Revert/fix-forward commits that cancel out within the same window

Rule of thumb: if a user couldn't see or feel the change, skip it.

## Style guide

- Lead each entry with a **bold title** followed by a colon and the description.
- Titles should be short and product-like ("Sidebar auto-hide", not "Implement sidebar auto-hide functionality").
- Descriptions are one line. If you need two lines, the entry is probably two separate features — split them.
- For optional features, add `*(off by default)*` / `*（默认关闭）*` after the title so users know they need to turn it on.
- Link to docs sparingly: `[→ Docs](/guide/{slug})` only when the doc genuinely helps. Don't link to a stub.
- **Screenshots are supported — use one for the headline feature.** `img` is on the sanitizer allow-list and `.gv-changelog-body img` already styles it (full width, rounded, click-to-zoom lightbox). Put the image in `docs/public/assets/promotion/` and append it to that bullet in every locale with localized alt text: `![{alt}](https://github.com/voyager-crew/voyager/raw/main/docs/public/assets/promotion/{file}.png)`. Only that folder is rewritten: the site turns the URL into its own `/assets/promotion/{file}.png`, and in-product the viewer swaps it for a bundled copy only when `getPromotionRuntimePath` in `src/pages/content/changelog/index.ts` maps the filename to a file in `public/` (today only `Activity-View.png` → `changelog-activity-view.png`); otherwise the extension loads the GitHub URL at view time. That URL only resolves once the docs commit is on `main` — verify with `curl -sIL -o /dev/null -w '%{http_code}'` before shipping. One screenshot per release at most; a wall of images buries the text.
- Translations should feel native. Arabic is RTL — don't worry about it in the raw file (the viewer handles direction), just get the text right.

## Opening quote (every release)

Every release note opens with one quote; `src/pages/content/changelog/__tests__/changelog.test.ts` fails a note from 2.1.1 on without it. It is required, and it is chosen, not filled in: a line that merely occupies the slot is worse than taking longer to find the right one.

1. **Ask the maintainer first whether they already have a line in mind.** They often do, and their pick fits the release better than anything a search surfaces.
2. If not, **collect 3–5 candidates, mainly from films and anime.** A line the maintainer would recognize from a film or anime beats a philosopher, proverb or book.
3. Check each against the bar below, verify it, and **give the maintainer the candidates with one line on how each fits.** The maintainer picks; the note does not ship without a pick.

The bar:

- **Direct fit**: it matches what this release does (its highlights) without explanation. For security, privacy, or permission releases, the line should be about responsibility, restraint, trust, or care — not just something vaguely warm.
- **High recognition**: a casual viewer is likely to recognize the line or at least the film or anime. Prefer iconic lines, not quiet one-off dialogue from a minor scene.
- **Source confidence**: the line is really said in the work, in these words. Memes and misquotes fail ("We need to go deeper" is not in _Inception_). Check the film or episode, its script or a reliable transcript; fan quote lists alone are not enough.
- **Tone fit**: it should feel like a small wink or reflection, not a motivational poster, sermon, ad, or inside joke.
- **Localization fit**: it can be translated naturally in all 10 locales without getting awkward.

Reject a candidate that:

- needs an explanation to connect to the release
- is only "valid" because WebSearch found it
- comes from an obscure source or an obscure moment in a famous source
- was chosen mainly because previous releases have not used it
- feels more clever than useful

Open every locale's file with one blockquoted, italic line, above the first section:

```markdown
> _"{the quote}" — {Character}, 《{Work Title}》_

### Highlights
```

Before saving it:

- Verify it with WebSearch or another reliable source. Do not rely on memory, fan quote lists alone, or aggregator paraphrases.
- Use the film's or anime's official title and translation in each locale where one exists.
- Confirm it has not been used before with `grep -rh '^>' src/pages/content/changelog/notes/`.
- Use one line across all 10 locales. Use official/known translations where they exist; otherwise translate naturally.
- Renders fine in the viewer: `blockquote` and `em` are on the sanitizer allow-list in `src/pages/content/changelog/index.ts` — don't introduce other raw HTML.
- The line opens each locale's body; the site's changelog pages list releases one after another, so a quote at the bottom reads as the start of the next release.

## Template skeleton

`{VERSION}/en.md`:

```markdown
> _"{the quote}" — {Character}, 《{Work Title}》_

### Highlights

- 🎛️ **{Title}**: {Description.}

### New

- **{Title}**: {Description.}
- **{Title}** _(off by default)_: {Description.} [→ Docs](/guide/{slug})

### Fixes

- **{Title}**: {Description.}
```

`{VERSION}/zh.md`:

```markdown
> _「{引语}」——{角色}，《{作品名}》_

### 亮点

- 🎛️ **{中文标题}**：{中文描述。}

### 新增

- **{中文标题}**：{中文描述。}
- **{中文标题}** _（默认关闭）_：{中文描述。}[→ 文档](/guide/{slug})

### 修复

- **{中文标题}**：{中文描述。}
```

`zh_TW.md`, `ja.md`, `fr.md`, `es.md`, `pt.md`, `ar.md`, `ko.md` and `ru.md` take the same shape with the headers from the table above.

Fill every locale — all 10 are non-negotiable. Write **Chinese first**, render English from it, then the other 8 from English (see _Authoring order_ below).

## Authoring order — Chinese first

**Write and polish Chinese (`zh`) first.** It's the project's primary voice and the maintainer's native language — the notes read most naturally when zh is the _source_, not a back-translation. Then:

- Render **English (`en`)** from the polished zh. `en` must always be complete: the in-product viewer falls back to `en` for any locale it can't find, so it stays the safety net even though it's no longer the source.
- Translate the remaining **8 locales from the English** (`en` is a cleaner pivot than zh for non-CJK languages). Keep the same structure — bullets, bold titles, and optional-feature markers. Use punctuation native to each language (`：` in Chinese/Japanese, `:` in others).
- Keep titles crisp in every language; long phrasings (especially zh) wreck the single-line list layout.
- Arabic: RTL is handled by the viewer — write natural RTL text, don't reorder for LTR display; use Arabic-style punctuation.
- Read the prior release in the same locale before writing — there's an established voice per language.

`en.md` is the fallback for any locale the viewer cannot find, so it must exist and be complete.

## Reality check before saving

- Every locale has the same number of bullets in the same order.
- All 10 locale files are present in `{VERSION}/`.
- Platform markers (`:gemini:` …) are spelled as `PLATFORM_LOGOS` ids and match across locales.
- No locale is missing a section that another locale has.
- Optional-feature markers are present in all 10 where they appear in English.
- No commit-speak leaked in (avoid things like "implement X" or "refactor Y to be more Z" — those are internal descriptions).
- The quote is there: it opens the body in all 10 locales, is the maintainer's pick, is verified, is new vs. prior release notes, and clearly fits the release. If it feels decorative or obscure, go back to the candidates rather than ship it.
