/**
 * The optional `timeline` section of a `site.json`: how the conversation
 * timeline reaches turns a virtualized host has not mounted.
 *
 * Format 1:
 * - `homing`: how navigation reaches an unmounted turn. `mode` is `bisect`
 *   (default), jumping by remembered offsets, for hosts that keep unmounted
 *   turns' height; or `step`, scrolling a bounded distance toward the turn's
 *   place in the list until it mounts, for hosts that reserve no height for
 *   them (ChatGPT, #1112). `releaseWith: "wheel"` dispatches a scripted wheel
 *   in the scroll's direction before each programmatic scroll, for a host that
 *   pins its thread to the newest turn until a wheel moves it (ChatGPT).
 * - `history`: where the whole list of user turns is read from. `source` names
 *   a reader this build carries (`chatgptConversation`); `sessionPath` and
 *   `conversationPath` are same-origin paths it requests, the latter with one
 *   `{conversationId}`; `keyAttributes` (optional, default the site's
 *   `turnKeyAttributes`) name the attributes on a mounted turn, or its nearest
 *   ancestor, that carry the key the reader reports.
 *
 * An unusable section reads as absent and a bad field as its default (no
 * `history`: the rail lists the mounted turns it has seen). Problems are
 * reported in `sectionIssues`, so `catalog:build` refuses them; an unknown key
 * is reported and otherwise ignored.
 */
import type { ManifestIssue } from '../../manifest/validate';

export const TIMELINE_HOMING_MODES = ['bisect', 'step'] as const;
export type TimelineHoming = (typeof TIMELINE_HOMING_MODES)[number];
export const TIMELINE_HOMING_RELEASES = ['wheel'] as const;
export type TimelineHomingRelease = (typeof TIMELINE_HOMING_RELEASES)[number];
export const TIMELINE_HISTORY_SOURCES = ['chatgptConversation'] as const;
export type TimelineHistorySource = (typeof TIMELINE_HISTORY_SOURCES)[number];

export interface TimelineHistorySection {
  readonly source: TimelineHistorySource;
  readonly sessionPath: string;
  /** Contains `{conversationId}` exactly once. */
  readonly conversationPath: string;
  readonly keyAttributes?: readonly string[];
}

export interface TimelineHomingSection {
  readonly mode: TimelineHoming;
  readonly releaseWith?: TimelineHomingRelease;
}

export interface TimelineSection {
  readonly format: 1;
  readonly homing?: TimelineHomingSection;
  readonly history?: TimelineHistorySection;
}

export const CONVERSATION_ID_PLACEHOLDER = '{conversationId}';
const MAX_PATH_LENGTH = 200;
/** Same-origin path segments only: no scheme, host, query, `..` or empty segment. */
const PATH = /^(?:\/[A-Za-z0-9._~-]+)+\/?$/;
const ATTRIBUTE_NAME = /^[a-z][a-z0-9-]{0,63}$/;
const MAX_KEY_ATTRIBUTES = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(options: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (options as readonly string[]).includes(value);
}

export function isSameOriginPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_PATH_LENGTH &&
    PATH.test(value) &&
    !value.split('/').some((segment) => segment === '.' || segment === '..')
  );
}

function isConversationPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.split(CONVERSATION_ID_PLACEHOLDER).length === 2 &&
    isSameOriginPath(value.replace(CONVERSATION_ID_PLACEHOLDER, 'id'))
  );
}

function readHoming(
  raw: unknown,
  path: string,
  issues: ManifestIssue[],
): TimelineHomingSection | undefined {
  if (!isRecord(raw)) {
    issues.push({ path, message: 'must be an object' });
    return undefined;
  }
  for (const key of Object.keys(raw))
    if (key !== 'mode' && key !== 'releaseWith')
      issues.push({ path: `${path}.${key}`, message: 'unknown key' });
  if (!oneOf(TIMELINE_HOMING_MODES, raw.mode)) {
    issues.push({
      path: `${path}.mode`,
      message: `must be one of ${TIMELINE_HOMING_MODES.join(', ')}`,
    });
    return undefined;
  }
  const mode = raw.mode;
  if (raw.releaseWith === undefined) return { mode };
  if (oneOf(TIMELINE_HOMING_RELEASES, raw.releaseWith))
    return { mode, releaseWith: raw.releaseWith };
  issues.push({
    path: `${path}.releaseWith`,
    message: `must be one of ${TIMELINE_HOMING_RELEASES.join(', ')}`,
  });
  return { mode };
}

function readHistory(
  raw: unknown,
  path: string,
  issues: ManifestIssue[],
): TimelineHistorySection | undefined {
  if (!isRecord(raw)) {
    issues.push({ path, message: 'must be an object' });
    return undefined;
  }
  const known = ['source', 'sessionPath', 'conversationPath', 'keyAttributes'];
  for (const key of Object.keys(raw))
    if (!known.includes(key)) issues.push({ path: `${path}.${key}`, message: 'unknown key' });
  let usable = true;
  if (!oneOf(TIMELINE_HISTORY_SOURCES, raw.source)) {
    issues.push({
      path: `${path}.source`,
      message: `must be one of ${TIMELINE_HISTORY_SOURCES.join(', ')}`,
    });
    usable = false;
  }
  if (!isSameOriginPath(raw.sessionPath)) {
    issues.push({ path: `${path}.sessionPath`, message: 'must be a same-origin path' });
    usable = false;
  }
  if (!isConversationPath(raw.conversationPath)) {
    issues.push({
      path: `${path}.conversationPath`,
      message: `must be a same-origin path containing ${CONVERSATION_ID_PLACEHOLDER} once`,
    });
    usable = false;
  }
  const attributes = raw.keyAttributes;
  const attributesValid =
    Array.isArray(attributes) &&
    attributes.length > 0 &&
    attributes.length <= MAX_KEY_ATTRIBUTES &&
    attributes.every((name) => typeof name === 'string' && ATTRIBUTE_NAME.test(name));
  if (attributes !== undefined && !attributesValid) {
    issues.push({
      path: `${path}.keyAttributes`,
      message: `must be 1-${MAX_KEY_ATTRIBUTES} lower-case attribute names`,
    });
    usable = false;
  }
  if (!usable) return undefined;
  return {
    source: raw.source as TimelineHistorySource,
    sessionPath: raw.sessionPath as string,
    conversationPath: raw.conversationPath as string,
    ...(attributesValid ? { keyAttributes: (attributes as string[]).slice() } : {}),
  };
}

/** Read `site.timeline`. Absent or unusable reads as no section. */
export function readTimelineSection(
  raw: unknown,
  path = 'timeline',
): { readonly timeline?: TimelineSection; readonly issues: readonly ManifestIssue[] } {
  if (raw === undefined) return { issues: [] };
  if (!isRecord(raw)) return { issues: [{ path, message: 'must be an object' }] };
  if (raw.format !== 1) return { issues: [{ path: `${path}.format`, message: 'unknown format' }] };
  const issues: ManifestIssue[] = [];
  for (const key of Object.keys(raw))
    if (key !== 'format' && key !== 'homing' && key !== 'history')
      issues.push({ path: `${path}.${key}`, message: 'unknown key' });
  const homing =
    raw.homing === undefined ? undefined : readHoming(raw.homing, `${path}.homing`, issues);
  const history =
    raw.history === undefined ? undefined : readHistory(raw.history, `${path}.history`, issues);
  return {
    timeline: {
      format: 1,
      ...(homing ? { homing } : {}),
      ...(history ? { history } : {}),
    },
    issues,
  };
}

export function timelineSectionToData(section: TimelineSection): TimelineSection {
  return {
    format: 1,
    ...(section.homing ? { homing: { ...section.homing } } : {}),
    ...(section.history
      ? {
          history: {
            ...section.history,
            ...(section.history.keyAttributes
              ? { keyAttributes: [...section.history.keyAttributes] }
              : {}),
          },
        }
      : {}),
  };
}
