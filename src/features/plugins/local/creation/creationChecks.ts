/**
 * Whether an installed creation does anything on the page, as the page tells
 * the panel (`gv.create.check`), and the panel's "Ask it to fix"
 * (`gv.create.fix`). Parsed on both ends, like the other Create mode requests.
 */
import { MAX_LOCAL_PLUGINS } from '../localPluginStore';

export const CREATION_CHECK_MESSAGES = {
  /** Which installed restyling creations find anything on this page now. */
  check: 'gv.create.check',
  /** Open a new chat here and fill it with a request to fix one creation. */
  fix: 'gv.create.fix',
} as const;

/**
 *   matches    a style rule or a page change found an element here
 *   nothing    everything that could be checked found nothing here
 *   unchecked  nothing could be checked (only primitives, only at-rules)
 */
export type PageVerdict = 'matches' | 'nothing' | 'unchecked';

export interface CreationCheck {
  readonly id: string;
  /** The version the page checked, so a verdict never lands on a newer install. */
  readonly version: string;
  readonly verdict: PageVerdict;
}

/** What the row saw: a restyling creation that matches nothing, or code that froze a page. */
export type CreationProblem = 'nothing-matches' | 'froze';

export interface CreationFixRequest {
  readonly type: typeof CREATION_CHECK_MESSAGES.fix;
  readonly id: string;
  readonly problem: CreationProblem;
  /** Attach the outline of this page too. */
  readonly structure: boolean;
}

const VERDICTS: readonly PageVerdict[] = ['matches', 'nothing', 'unchecked'];
const PROBLEMS: readonly CreationProblem[] = ['nothing-matches', 'froze'];
const MAX_ID_CHARS = 200;
const MAX_VERSION_CHARS = 64;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function parseCheck(value: unknown): CreationCheck | null {
  if (!isRecord(value)) return null;
  const { id, version, verdict } = value;
  if (!boundedText(id, MAX_ID_CHARS) || !boundedText(version, MAX_VERSION_CHARS)) return null;
  const known = VERDICTS.find((candidate) => candidate === verdict);
  return known ? { id, version, verdict: known } : null;
}

/** The page's checks, malformed entries dropped; null when the reply is not a check at all. */
export function parseCreationChecks(value: unknown): readonly CreationCheck[] | null {
  if (!isRecord(value) || !Array.isArray(value.checks)) return null;
  return value.checks
    .slice(0, MAX_LOCAL_PLUGINS)
    .map(parseCheck)
    .filter((check): check is CreationCheck => check !== null);
}

export function parseCreationFixRequest(value: unknown): CreationFixRequest | null {
  if (!isRecord(value) || value.type !== CREATION_CHECK_MESSAGES.fix) return null;
  const { id, problem } = value;
  const known = PROBLEMS.find((candidate) => candidate === problem);
  if (!boundedText(id, MAX_ID_CHARS) || !known) return null;
  return {
    type: CREATION_CHECK_MESSAGES.fix,
    id,
    problem: known,
    structure: value.structure === true,
  };
}
