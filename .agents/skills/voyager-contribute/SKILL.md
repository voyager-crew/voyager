---
name: voyager-contribute
description: Prepare Voyager commits, pull requests, and contribution evidence, or claim an issue and check review readiness.
---

# Voyager Contribution

Use only the stages included in the user's request; a readiness review delivers findings, while an authorized commit or publication continues through verification and handoff. Route issue investigation to `issue-review`, Safari loading or native verification to `update-safari-extension`, and releases to `release` when needed.

## 1. Preflight

1. Inspect `git status --short --branch`, the current branch, and the diff. Preserve unrelated work.
2. Read the linked Issue and its comments when one exists. A new feature needs explicit maintainer approval of the approach, either in the Issue or as a direct instruction in the current task; assignment or `/claim` only selects an owner.
   The PR gate (`.github/workflows/pr-gate.yml`) closes any PR from an author outside `.github/MAINTAINERS` and `.github/APPROVED_CONTRIBUTORS` unless it has a `fix:` / `fix(scope):` title and stays within 20 files and 1,000 changed lines, or a maintainer added the `maintainer-approved` label. Docs, refactor and feature PRs from such authors need that alignment first. A maintainer's `/approve @user` both assigns the issue and adds the user to `APPROVED_CONTRIBUTORS`.
3. Work on one focused topic branch targeting `main`. Keep secrets and generated `dist_*` artifacts out of commits.
4. Read [repo-traps.md](references/repo-traps.md) — the repository-specific pitfalls that have cost past contributors the most review rounds.
5. Use `gh` as the source of truth for Issue/PR state. Before any GitHub write, confirm `gh auth status` shows the account you intend to contribute as. If GitHub CLI is unavailable, perform Issue/PR reads and writes through the GitHub web UI instead and note that in the PR.

Preflight is complete when the Issue or rationale, approval state, intended scope, current branch, and clean ownership of every changed file are known.

## 2. Verify

1. Add or update regression tests for behavior changes. If no useful automated test exists, record the reason.
2. Use the verification matrix in [AGENTS.md](../../../AGENTS.md#verification): code changes run `test:changed`, `typecheck` and `lint:check` locally and leave the full suite to CI; prose-only changes use the applicable document checks. During implementation, run focused checks; reuse passing evidence for unchanged inputs. If formatting or lint fixes are needed, apply them to the intended files with `bun run format <paths>` / `bun run lint <paths>` and inspect the diff before checking the final tree. Read-only reviews use check variants.

   CI covers the full suite and production browser builds; it does not prove that an extension loaded or that live behavior works. Finish with `git diff --check` and `git status --short`.

3. For runtime, UI, manifest, permission, packaging, native, or plugin changes, read [browser-testing.md](references/browser-testing.md) and collect the required live evidence.
4. Record every omitted command or browser check with its reason. For required coverage that another person must complete, name the browser and owner and leave the item pending.

Verification is complete when every applicable automated check and browser check has a truthful result, the working tree matches the snapshot being tested, and remaining work is explicitly assigned.

## 3. Commit and publish

1. Review the final diff and stage only intended paths.
2. Create a Conventional Commit with a lowercase scope and a header no longer than 100 characters. Add `Fixes #<issue>` or `Closes #<issue>` when appropriate. Retain the active agent's project-standard co-author footer; Codex-authored commits use:

   ```text
   Co-authored-by: Codex <codex@users.noreply.github.com>
   ```

3. Inspect the commit with `git show --stat --format=fuller HEAD` and `git status --short`. Require no staged or unstaged changes in the contribution's paths; preserve and disclose unrelated pre-existing work. `HEAD` is the tested commit only while the verified paths match it, and any later change invalidates affected evidence.
4. When publishing is authorized, push only the topic branch and open or update a draft PR targeting `main`. Contributors never push directly to `main`; use force-push only with explicit user approval — this repository squash-merges, so a merged branch will later look unmerged (see repo-traps.md) and must be deleted, not re-pushed. Exception: this rule governs contribution workflows; a maintainer with push access working outside a contribution follows the project-wide default push rules in `CLAUDE.md`/`AGENTS.md`, which take precedence.
5. In the PR, state the linked Issue or direct authorization/rationale, scope, tested commit, commands run, live browser evidence, screenshots for UI changes, and all pending checks. Re-run affected checks after review changes.
6. Verify the PR author, base branch, commit set, changed files, and CI state with `gh` before handoff.

Publishing is complete when the focused diff is on a topic branch, the draft PR accurately reports its evidence and gaps, and the user receives the PR URL plus pending review or CI work.

After an Issue fix lands, leave a short comment in the reporter's language: the fix has landed, it will be available in the next version, and the Issue may be reopened if the problem remains.
