# AGENTS.md — Voyager

## Execution

- Follow current user requirements over repository or skill guidance, within the host's instruction hierarchy. Reuse existing approval. If a document requires a pause, cite the exact instruction and explain why it applies; finish independent authorized work first.
- Check `git status --short --branch -uall` before editing. Preserve unrelated work; recheck status and HEAD before committing or pushing.
- Give each file one editor and verify delegated findings before reporting them.

## Read the relevant context

Read matching rules before editing; do not assume the client auto-loaded `.claude/rules/`.

| Change                                                                   | Required context                                                                                                                            |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/**/*.ts`, `src/**/*.tsx`                                            | [.claude/rules/typescript.md](.claude/rules/typescript.md)                                                                                  |
| `src/pages/content/**`, `src/styles/contentStyle/**`                     | [.claude/rules/content-scripts.md](.claude/rules/content-scripts.md)                                                                        |
| `src/locales/**`                                                         | [.claude/rules/i18n.md](.claude/rules/i18n.md)                                                                                              |
| Storage, backup, account isolation, Drive sync, folder or export modules | [.claude/rules/high-complexity.md](.claude/rules/high-complexity.md), full-file reads and full-suite verification for behavior/data changes |
| `src/pages/content/changelog/notes/**` (release notes)                   | [.agents/skills/release/references/changelog.md](.agents/skills/release/references/changelog.md), including its opening quote               |
| Contribution or release                                                  | [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md); matching workflows in [.agents/skills/](.agents/skills/)                                |
| `src/features/plugins/catalog/**`, `verbs/**` or `sites/**`              | [.agents/skills/create-voyager-plugin/SKILL.md](.agents/skills/create-voyager-plugin/SKILL.md)                                              |
| `docs/**/guide/**` (guide pages in every locale)                         | [.agents/skills/writing-docs/SKILL.md](.agents/skills/writing-docs/SKILL.md)                                                                |
| Reviewing a diff; writing or deleting tests                              | [CODING_STANDARDS.md](CODING_STANDARDS.md)                                                                                                  |

Use `package.json`, build configs, manifests and CI to verify command names and current wiring. Keep `CLAUDE.md` as a pointer here.

## Protected behavior

- Preserve user data and serialized formats, especially localStorage. Legacy keys and cleanup paths may serve migrations. Scope page-derived state, caches, backups and delayed work to the applicable platform/account; preserve `/u/<index>/` routes.
- Generate `dist_*` through build scripts; never edit them directly. Never commit `.env` or secrets.
- Never grant a page or feature direct `<all_urls>` permission without explicit user approval.
- Gemini conversation navigation uses native in-app links first, then History API/router events. Full reloads (`location.assign`, `location.href`, `location.reload`) require explicit user acceptance for normal session navigation.
- Popup Material Symbols use bundled `public/fonts/` assets. Check new glyphs locally or update the bundle; do not introduce a remote Google Fonts URL.
- Every local `xcodebuild` uses `-derivedDataPath .build/safari-native-test-derived -clonedSourcePackagesDirPath .build/sparkle-source-packages`. Only CI uses `.build/ci-xcode-derived`. `bun run clean:build` reclaims derived data while retaining the SPM cache.

## Where changes belong

- **Shared services and storage**: `src/core/services/`; `StorageKeys` in the domain groups of `src/core/types/storageKeys/` (re-exported from `src/core/types/common.ts`); sync-backed settings also need defaults in `src/core/services/settingsBackupDefaults.ts` (other keys a policy in `settingsBackupPolicies.ts`) and migrations in `SettingsBackupService.ts`
- **Feature logic and UI**: `src/features/*/services/` or hooks; functional React UI. Content modules in `src/pages/content/` remain self-contained
- **Folders**: Schema: `src/core/types/folder.ts`; content `types.ts` re-exports it and owns drag data. Logic: `src/features/folder/`; host/UI: `src/pages/content/folder/`
- **Timeline and highlights**: [Owner map and lifecycle boundaries](src/pages/content/timeline/README.md); start with the owner of the behavior before editing a manager
- **Popup settings and shortcuts**: `src/pages/popup/Popup.tsx` and its `components/`; official plugin rows in `src/pages/popup/officialPlugins/`; shortcuts use `src/core/services/KeyboardShortcutService.ts`, related types and `components/KeyboardShortcutSettings.tsx`
- **Cloud sync**: `src/core/services/GoogleDriveSyncService.ts`
- **Translations**: `src/locales/*/messages.json`: all 10 locales for new/removed user-facing keys
- **Content styles**: Shared/static CSS in `src/styles/contentStyle/` (parts of the shipped `contentStyle.css`); computed feature CSS stays local, uses `gv-` prefixes and has teardown
- **Confirmations and toasts**: `askConfirm` (`src/core/ui/confirm.ts`) and `createToaster` (`src/core/ui/toast/toaster.ts`)
- **Coachmarks**: Read [coachmark authoring and tour behavior](src/pages/content/coachmark/README.md) when adding or changing a guide or its lifecycle
- **Plugins**: Read [plugin architecture and distribution](src/features/plugins/README.md) when changing sources, catalog loading, or native plugin wiring. Host-page data that must update without a release travels in the catalog host files ([`remote/`](src/features/plugins/remote/README.md)), the only online channel
- **Native feature lifecycle**: Contract in `src/pages/content/featureLifecycle.ts`; register a module that returns a stop in `nativeFeatures.ts` and start it from there; `__tests__/nativeFeatureLifecycle.test.ts` covers it. A feature listed in `src/features/plugins/sites/featureOwners.ts` runs only as its official plugin, admitted at its original start point. Input services that must exist before `PluginHost`, such as the page send-key coordinator, start from `src/pages/content/inputStartup.ts`

Use `StorageService` where suitable; established direct `chrome.storage`/`browser.storage` paths remain valid for content scripts, popup settings, bulk operations and listeners.

## Keep changes incremental

- Implement the minimum requested behavior. Keep independent options separate; inspect existing data structures and sibling implementations before adding abstractions.
- Before deletion, trace production entry points, callers and regression guards. Distinguish retired implementations from compatibility cleanup. Remove tests that exist solely for deleted, unreachable code.
- A feature with phases that an async result can outlive (a request a toggle can cancel, a wait the page can leave) runs on `startMachine` (`src/features/plugins/runtime/stateMachine.ts`): states as a union, a pure `transition`, effects owned per state. It replaces hand-written flags, generation counters and promise guards; orthogonal axes stay separate machines or plain state ([plan](.github/docs/STATE_MACHINE_PLAN.md)).
- Keep listener, observer and timer cleanup beside setup. Sidebar remount, account change and full teardown have different lifetimes; preserve the appropriate state across each.
- For visual changes, state the expected result and verify alignment, spacing and behavior in light/dark themes, including external resource dependencies.
- New code goes in a new file: `bun run filesize:check` blocks growing a `src` file past 1000 lines (`filesize:update` after shrinking one), and the pre-commit hook blocks any staged file over 5,000 tokens, so split an oversized file before editing it.

## Verification

Choose checks by changed surface. Repeat passing checks only after relevant changes or new evidence. Code contributions run `bun run verify:pr` once, on the final tree, right before a PR is opened or updated or `main` is pushed; it covers the automated checks below. While review fixes are still pending the tree is not final, so the full suite waits. Prose-only contributions use the applicable rows below. Native checks remain separate; releases use the final-tree gates in the `release` skill.

A change to content scripts, injected CSS, MAIN-world scripts or anything else a host page shows is proven in the live browser and shown: run the [verify-in-browser](.agents/skills/verify-in-browser/SKILL.md) skill on the dev build yourself, and report with its screenshots. The dev build already has every site's access and switches settings and plugins through its dev settings bridge, so the person never clicks the popup for a check. Passing tests prove the fixtures, not the current host page.

While iterating, and when a subagent finishes its part of a larger change, run `bun run test:changed` (tests affected by changes since `main`; CSS, locale or config changes run the whole suite) plus `bun run typecheck` and `bun run lint:check`. Worktrees share one machine, so queue every full run behind one lock (`lockf -k /tmp/voyager-verify.lock bun run verify:pr` on macOS, `flock` on Linux). Overlapping suites starve each other into timeouts; a failure that passes when its file reruns alone is load, not a regression.

| Changed surface                                        | Final-tree checks                                                                                                                   |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Prose, agent instructions, comments or formatting only | Review the diff for lost requirements, validate referenced paths/commands, format-check changed files                               |
| Extension code, build logic or dependencies            | `bun run lint:check`, `bun run test`, `bun run build:chrome`; add `bun run typecheck` for any `.ts`/`.tsx` change                   |
| Added, renamed or removed `public/` entries            | `bun run build:all` instead of Chrome only; register every top-level Safari resource in `Voyager/Voyager.xcodeproj/project.pbxproj` |
| `docs/**/*.md` or `docs/.vitepress/**`                 | `bun run docs:build`; background `bun run docs:dev` when preview is needed before committing                                        |

Run tooling through `bun run <script>` or `bunx`; the formatter is oxfmt and the linter is oxlint. `bun run lint` (`oxlint --fix`) and `bun run format` (`oxfmt`) apply corrections: inspect their diffs. Read-only reviews use `:check` variants; for specific files, `bunx oxfmt --check <files>`.

Features need tests that catch a real regression; bug fixes add one only when coverage has a genuine gap. [CODING_STANDARDS.md](CODING_STANDARDS.md) defines which tests earn their place.

For Chrome development, run `bun run dev:chrome` and load `dist_chrome_dev` once; it reloads itself after each later dev build. Production checks use `build:chrome`/`dist_chrome`. `build:all` builds Chrome, Firefox and Safari; `build:browsers` includes Edge too.

## Git and publishing

- Use `gh` as the source of truth for GitHub issues, PRs and comments.
- When asked to push without branch/PR instructions, fast-forward `origin/main`. Never force-push unless explicitly requested.
- Commit as `<type>(<scope>): <imperative summary>`: lowercase feature scope, preferably lowercase summary, no trailing period, at most 100 header characters. Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `build`, `ci`, `perf`, `style`, `revert`, `deps`, `ux`.
- Link related issues/discussions with `Fixes #xxx` or `Closes #xxx` in the commit body or PR description.
- After an issue fix has landed, and when posting is authorized, comment briefly in the reporter's language: the fix has landed, it will be in the next version, and they can reopen if it persists.
