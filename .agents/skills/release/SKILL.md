---
name: release
description: Prepare, publish, or recover a Voyager release. Use for version bumps and releases, failed store submissions, or Safari release failures.
metadata:
  version: '1.5.0'
---

# Voyager Release

Use repository scripts and `.github/workflows/release.yml` (with the `release-*.yml` stages it calls) as the source of truth. Normal releases use CI: a release tag builds the browser artifacts, signs and notarizes Safari, creates the GitHub Release, and submits the stores.

## Choose the requested workflow

Read only the reference needed for the current task:

- New release, version bump, or interrupted release preparation: [normal-release.md](references/normal-release.md).
- Failed Chrome or Edge submission, or an urgent Firefox-only hotfix: [store-recovery.md](references/store-recovery.md).
- Safari CI failure or an explicitly requested local recovery artifact: [safari-dmg.md](references/safari-dmg.md).
- Store listing copy about the plugin catalog connection (Chrome, Edge, Firefox): [store-listing-plugin-catalog.md](references/store-listing-plugin-catalog.md).

## Authorization and publication boundaries

The user's request and existing approval define the scope; loading this skill grants no additional permission. Complete authorized preparation and verification, and reuse approval for the same version, destination, and action. A diagnosis or preparation request does not by itself authorize publication.

Before a tag push, store submission, or replacement upload, verify that the concrete action is authorized. Ask only when that authorization is missing or the version, scope, or a possible release blocker needs a user decision; prepare the reviewable result first. Explain any newly discovered change to the approved release.

- A tag push triggers the public GitHub Release, Safari signing/notarization and Sparkle feed, Firefox AMO submission, Chrome Web Store publication, and Edge Add-ons submission.
- Moving a published tag requires explicit authorization for that operation and is allowed only while no release artifacts have been produced. Otherwise recover the affected store or prepare a new version; never silently retag.
- Preserve unrelated changes and stage release paths explicitly. Never bypass hooks with `--no-verify`.
- Keep Safari compatibility bundle IDs and signing requirements intact. Do not run a second local Safari release or upload a second DMG while CI is producing the release.
- Failed required checks block tagging and publication. Fix failures caused by the authorized work and rerun affected checks; ask only when resolving a blocker needs new scope or a risk decision. An accepted unresolved failure remains reported as failed and never bypasses artifact signing, notarization, or privacy requirements.

## Completion

For preparation, report the version, scoped changes, verification results, and remaining publication step. For diagnosis, report the failing stage, evidence, and the concrete recovery path. Do not advance either request into publication automatically.

For publication or recovery, finish the applicable workflow and verify its actual result: GitHub assets/body, Safari notarization/privacy evidence and signed Sparkle feed, and the requested stores' signing/submission outcomes. Distinguish submission success from store availability, and report pending review or failures. A successful GitHub Release alone does not prove every store or Safari succeeded.
