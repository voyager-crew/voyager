# Normal Voyager Release

Follow this reference for a new release or interrupted preparation. Resume from verified state; do not bump an already-prepared version again.

## 1. Establish scope

### Branch and worktree

- Release from `main` unless the user explicitly chooses another branch.
- Inspect `git status --short --branch -uall`. Preserve unrelated changes and never use `git add -A`.
- Release files left from an interrupted attempt are acceptable only after verifying their target version and contents.

### Commit range

Derive the scope from the last released tag, not from unpushed commits. Match `v*`: the repository also carries non-release tags such as `pre-oss-rewrite`.

```bash
PREV_TAG=$(git describe --tags --abbrev=0 --match 'v*')
git log "${PREV_TAG}..HEAD" --format='%h %s' --no-merges
git rev-list --count "${PREV_TAG}..HEAD"
```

Use this same range for both the in-product changelog and GitHub release body.

### Open issues

Read the current open issues and briefly classify recent bugs, `important` issues, and maintainer promises as blocking or non-blocking:

```bash
gh issue list --state open --limit 100 \
  --json number,title,labels,createdAt,updatedAt,author
```

Show the user the possible blockers before changing the version.

### Secret-name preflight

Check secret names only; never print, download, or commit their values:

```bash
gh secret list -R voyager-crew/voyager --json name --jq '.[].name'
```

Confirm the workflow has names for:

- Safari: `APPLE_CERTIFICATE_P12_BASE64`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_APP_PROVISIONING_PROFILE_BASE64`, `APPLE_EXTENSION_PROVISIONING_PROFILE_BASE64`, `SPARKLE_PRIVATE_KEY`
- Firefox: `AMO_JWT_ISSUER`, `AMO_JWT_SECRET`, `VOYAGER_FIREFOX_OAUTH_CLIENT_SECRET` (Firefox Google Drive sign-in; the build step fails without it)
- Chrome: `CHROME_EXTENSION_ID`, `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN`
- Edge: `EDGE_CLIENT_ID`, `EDGE_PRODUCT_ID`, `EDGE_API_KEY`

Missing Safari release secrets are blocking: the GitHub Release job now waits for the Safari artifact job. A missing `VOYAGER_FIREFOX_OAUTH_CLIENT_SECRET` also blocks `build-and-release`, and it fails only after the Safari job has run.

## 2. Prepare the version and changelog

### Version bump

Read the five current version sources first. If they already match the intended release version after an interrupted attempt, do not bump again; continue with verification and the changelog.

For the next patch version:

```bash
bun run bump
```

For an explicit version:

```bash
bun run bump {VERSION}
```

`scripts/bump-version.js` now updates all five tracked version sources together:

- `package.json`
- `manifest.json`
- `manifest.dev.json`
- `packages/create-voyager-plugin/package.json` (the plugin CLI follows the extension version)
- `Voyager/Voyager.xcodeproj/project.pbxproj`

The bump also stamps raw `sinceEngine: 'next'` declarations in primitive
contracts, their imported data modules, and baselines (including later-added parameters), and `engine:
">=next"` in catalog plugin manifests. They become the next minor engine
version, and `src/features/plugins/constants.ts` records that released engine.
When no `next` declaration exists, the engine version stays unchanged regardless
of the extension version. Never hand-bump the plugin engine or choose the
engine version while authoring an unreleased primitive.

When `next` declarations land after a version was already bumped,
`plugin:release:check` fails. Run `bun run bump {VERSION}` again with the same
version: it leaves the five version sources unchanged and stamps only the new
declarations. The bump does not touch prose or tests: replace `>=next` in
`docs/**` with the stamped engine, and move test fixtures that pin `>=next`
for a capability this release ships to that engine (`>=next` now means the
engine after it).

Do not manually edit the Xcode project version during a normal release. Verify all values after the bump:

```bash
rg '"version"' package.json manifest.json manifest.dev.json \
  packages/create-voyager-plugin/package.json
rg 'MARKETING_VERSION|CURRENT_PROJECT_VERSION' \
  Voyager/Voyager.xcodeproj/project.pbxproj | sort -u
```

### In-product changelog

Create the folder `src/pages/content/changelog/notes/{VERSION}/` with one file per locale (`en.md`, `zh.md`, …). Read [changelog.md](changelog.md) before authoring it. All 10 locales are required before publication, each opening with the release quote the maintainer picked ([Opening quote](changelog.md#opening-quote-every-release)); `src/pages/content/changelog/__tests__/changelog.test.ts` fails a note without it.

Every commit in `PREV_TAG..HEAD` must be accounted for before writing. Scale the effort to the range — do not fan out by default:

- **15 commits or fewer**: read them yourself with `git show <sha> --stat` and the diff where the subject is ambiguous. No subagents. The transcription loss of delegating outweighs the parallelism at this size.
- **More than 15 commits**: still read the range yourself, but delegate the groups where the commit message alone would lead to a wrong conclusion — same-scope clusters containing `fix`, `revert`, or `ux`, where a later commit may cancel, narrow, or quietly exceed an earlier one. **At most 4 agents.** Groups that are purely `ci`, `docs`, `chore`, `build`, `test`, or `refactor` are decided from the commit type; never spend an agent on them.

Whoever does the reading — you or an agent — must establish, per commit: the actual user-facing effect, whether the implementation matches the commit message, and whether it belongs in the changelog. Watch specifically for pairs that net to zero inside the window (a `revert` undoing a `feat`, a `fix` deleting most of the feature it follows) — those are the findings that justify the effort, and they must not reach the changelog.

Write `zh` first, derive `en`, then translate the other eight locales, one file each.

## 3. Verify the final release tree

Finish the version bump, 10-locale changelog, and any release fixes before running the full gates. Run lint first because it can modify files; inspect its diff. Then run the release-only check and the full PR gate on the final tree:

```bash
bun run lint

bun run plugin:release:check
lockf -k /tmp/voyager-verify.lock bun run verify:pr
```

`verify:pr` runs format, lint, typecheck, i18n, file-size and plugin checks, the full test suite, `build:all`, `cli:build` and `docs:build`.

`cli:build` stamps the bumped version into `packages/create-voyager-plugin/dist/cli.mjs`; the `publish-cli` job of `deploy-docs.yml` rebuilds and publishes that file when the release commit reaches `main` (step 5).

`plugin:release:check` fails if any raw `next` engine declaration remains in a
primitive contract, imported contract data module, baseline or catalog manifest. Run it before release builds
or publication; main's development tree may still contain `next`, so this gate
is separate from `verify:pr`.

Use `bun run test`, not raw `bun test`. `build:all` writes production outputs to `dist_chrome`, `dist_firefox`, and `dist_safari`; `dist_chrome_dev` is only for routine local Chrome development. Native and live-browser checks stay separate from `verify:pr`.

A successful Chrome build does not cover Firefox's manifest transform/add-on ID or Safari's resource registration. Every top-level `public/` entry must be registered in `Voyager/Voyager.xcodeproj/project.pbxproj`; `build:all` checks that through the Safari build. Keep all three browser builds as the release gate.

Only commit and tag after the gates pass. Record the verified tree; reuse passing results while the relevant inputs remain unchanged. If a later fix, asset, review change, or hook changes tested inputs, rerun the affected checks before tagging or pushing. Build-affecting changes require `build:all` again, not only Chrome. Committing an unchanged verified tree alone does not invalidate evidence.

## 4. Commit and tag locally

Recheck status and HEAD, then stage only the release files:

```bash
git add \
  package.json manifest.json manifest.dev.json \
  packages/create-voyager-plugin/package.json \
  Voyager/Voyager.xcodeproj/project.pbxproj \
  src/pages/content/changelog/notes/{VERSION}/
git diff --name-only -- src/features/plugins/constants.ts \
  ':(glob)src/features/plugins/verbs/**/*.ts' \
  ':(glob)src/features/plugins/verbs/*/paramsBaseline.json' \
  ':(glob)src/features/plugins/catalog/**/plugin.json'
```

Review the engine files listed by `git diff --name-only`, then stage each stamped
path explicitly before committing. They are part of the same release as the
five version sources and must be committed before tagging. Include only the
bump's replacements; preserve unrelated changes in those files.

```bash
git diff --cached --name-only
git diff --cached --check
git commit -m "chore(release): v{VERSION}" \
  -m "Co-authored-by: Codex <codex@users.noreply.github.com>"
```

If this release intentionally includes announcements or other release-only files, add them explicitly and re-check the staged list. Never absorb unrelated worktree changes.

Verify the staged list immediately before every commit, not once at the start. A
`git mv` or an earlier `git add` leaves entries in the index, and `git commit`
takes all of them — that is how unrelated work gets absorbed into the release
commit.

Inspect the commit and status with `git show --stat --format=fuller HEAD` and `git status --short --branch -uall`. Verify that the committed inputs match the tested tree, including any hook edits, before creating the local tag:

```bash
git tag "v{VERSION}"
```

## 5. Push the authorized release

Check the concrete tag and commit against the authorization boundaries in [SKILL.md](../SKILL.md). Reuse existing approval; if publication has not been authorized, show the prepared version, verification results, and tag-push effects before asking.

Publish in this order; each step depends on the one before it:

1. **main, which publishes npm first.** The docs and the public `write-voyager-plugin` skill tell users to run `npx create-voyager-plugin@latest`, so `deploy-docs.yml` runs its `publish-cli` job before building the docs: when `create-voyager-plugin@{VERSION}` is not on npm yet, it builds the CLI, publishes it through npm Trusted Publishing (OIDC, no token or 2FA prompt), and on every run waits until `npm view` reports `{VERSION}` as `latest` and smoke-tests `init` and `check`. The same push then deploys the docs and the remote plugin catalog. Wait for the whole run to succeed before the tag: a new-version extension that fetches the catalog before the deploy caches the old one as authoritative for that version. Until the next refresh, that cached catalog can withhold the version's plugin updates and site fixes, and revoke any ids it lists in `revoked`.

   ```bash
   git push origin main
   gh run list --workflow deploy-docs.yml --limit 1
   ```

   A failed `publish-cli` blocks the docs deploy, which is the intent. An `ENEEDAUTH` or `E403`/`E404` on publish can mean the package's Trusted Publisher on npmjs.com no longer matches `voyager-crew/voyager`, `deploy-docs.yml` and direct publishing; check the job's npm log for the CLI version, the OIDC exchange and registry or network errors before the user changes that setting and re-runs the workflow. Manual recovery is the user's action: `cd packages/create-voyager-plugin && npm publish --access public`, after which a re-run skips the publish.

   After that run succeeds, check that npm and the site agree: `npm view create-voyager-plugin version` prints `{VERSION}`, and `curl -s https://voyager.nagi.fun/en/changelog | grep -c 'v{VERSION}'` prints a non-zero count (the page has a `## v{VERSION}` heading per release, built from the in-product notes once `package.json` reaches that version). Zero means the deploy did not pick up the bump or the note; fix that before the tag.

2. **Tag.** The tag starts the store release.

   ```bash
   git push origin "v{VERSION}"
   ```

If the user chose a different release branch, verify the tag points to that intended branch and push only the authorized branch and tag.

Do not use the workflow's auto-increment `workflow_dispatch` path for a normal curated release: it can bump and tag, but cannot author the required in-product changelog. Reserve it for an already-prepared version or an explicit recovery decision.

## 6. Monitor CI

The release jobs run in the `release` environment, which holds the run at `waiting` until a reviewer approves it. Approving it is part of the authorized tag push, so approve it yourself, and again whenever the run returns to `waiting`:

```bash
ENV_ID=$(gh api repos/voyager-crew/voyager/actions/runs/{RUN_ID}/pending_deployments --jq '.[0].environment.id')
gh api -X POST repos/voyager-crew/voyager/actions/runs/{RUN_ID}/pending_deployments \
  -F "environment_ids[]=$ENV_ID" -f state=approved -f comment="Release v{VERSION}"
```

Before a release that changes `release*.yml` or the build scripts, run `release.yml` from `main` with `dry_run` ticked: it builds, signs and notarizes every package under the current version and stops before any tag, GitHub Release or store submission.

The tag workflow runs these gates:

1. `build-safari-release` builds `dist_safari`, imports the Developer ID certificate and provisioning profiles, then calls `scripts/build-safari-release.sh`.
2. That script archives the `Voyager` scheme, exports `Voyager.app`, verifies a universal binary, notarizes and staples the app and DMG, includes the Safari-upgrade README, generates signed `appcast.xml`, and scans artifacts for private data.
3. `build-and-release` waits for Safari, builds the other browser artifacts, signs/submits Firefox, creates the GitHub Release, then submits Chrome and Edge.

Monitor with:

```bash
gh run list --workflow release.yml --limit 3
gh run view {RUN_ID} --log-failed
```

For a Safari failure, read [safari-dmg.md](safari-dmg.md). For an isolated store failure, read [store-recovery.md](store-recovery.md).

Important failure semantics:

- Safari build/sign/notarization failure prevents the GitHub Release job from starting.
- A later Chrome or Edge store failure does not undo an already-created GitHub Release or AMO submission.
- Firefox signing can remain quiet for several minutes; wait for an actual error before treating it as stuck.

## 7. Curate the GitHub release body

Read [release-body.md](release-body.md). Use the same commit range as the in-product changelog and replace the generated top section with concise English and Chinese feature/fix tables, preserving the workflow-generated `## 📥 Installation` tail. Verify the rendered body, attribution, and Safari capability text against the current product.

## 8. Verify the published result

Confirm the release contains:

- `voyager-chrome-v{VERSION}.zip`
- `voyager-firefox-v{VERSION}.xpi`
- `voyager-v{VERSION}.dmg`
- `appcast.xml`

```bash
gh release view "v{VERSION}" --json assets --jq '.assets[].name'
```

Also confirm:

- the Safari job reported notarization and privacy verification success,
- `appcast.xml` contains `sparkle:edSignature`,
- Chrome and Edge workflow steps reached upload/submission success,
- AMO signing/submission completed.

Report the release URL, version, verification evidence, and any store review or recovery still pending. Use [store-recovery.md](store-recovery.md) for an isolated submission failure instead of cutting another version.
