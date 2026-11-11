import { PLUGIN_ENGINE_VERSION } from './constants';

/** Voyager 2.3.1, the last release with its own engine number, reports engine 1.11.0. */
export const LAST_SEPARATE_ENGINE = { voyager: '2.3.1', engine: '1.11.0' } as const;

/**
 * The newest floor the released build of this tree meets: its version, or engine
 * 1.11.0 while the tree is still at 2.3.1, because 2.3.1 compares floors to that.
 */
export const RELEASED_ENGINE_FLOOR: string =
  PLUGIN_ENGINE_VERSION === LAST_SEPARATE_ENGINE.voyager
    ? LAST_SEPARATE_ENGINE.engine
    : PLUGIN_ENGINE_VERSION;

/** The version `bun run bump` gives the release after `version`: next patch, rolling over at 10. */
export function nextReleaseVersion(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Cannot resolve the release after ${version}`);
  let [major, minor, patch] = match.slice(1).map(Number);
  patch += 1;
  if (patch > 9) {
    patch = 0;
    minor += 1;
  }
  if (minor > 9) {
    minor = 0;
    major += 1;
  }
  return `${major}.${minor}.${patch}`;
}

/**
 * Resolve contributor placeholders before a version or range reaches semver.
 * `next` is the release that will ship the declaration; `bun run bump` stamps
 * it with the version it actually releases.
 */
export function resolveEngineVersion(
  value: string,
  nextVersion = nextReleaseVersion(PLUGIN_ENGINE_VERSION),
): string {
  const trimmed = value.trim();
  if (trimmed !== 'next' && trimmed !== '>=next') return value;
  return trimmed === 'next' ? nextVersion : `>=${nextVersion}`;
}

/** Only the manifest's engine field is authoring notation; other strings are user data. */
export function resolveManifestEngine(input: unknown): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return input;
  const manifest = input as Record<string, unknown>;
  if (typeof manifest.engine !== 'string') return input;
  const engine = resolveEngineVersion(manifest.engine);
  return engine === manifest.engine ? input : { ...manifest, engine };
}
