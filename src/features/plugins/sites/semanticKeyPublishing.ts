/**
 * Which semantic keys a published `site.json` may carry.
 *
 * One host file serves every extension version that still fetches it. A
 * release before `UNKNOWN_SEMANTIC_KEY_TOLERANT_VERSION` rejects the whole
 * remote adapter on a key it does not know and quietly keeps its bundled
 * selectors; from that release on, the key alone is dropped. So a key newer
 * than the oldest consumer can be published only once that consumer is
 * tolerant. Every concrete host is checked, including Gemini Enterprise and AI Studio.
 */
import { engineSatisfied } from '../semver';
import { SEMANTIC_KEY_SINCE_VERSION, isSemanticSelectorKey } from './semanticKeys';

/** First release whose runtime read drops an unknown selector key instead of the adapter. */
export const UNKNOWN_SEMANTIC_KEY_TOLERANT_VERSION = '2.2.1';

/**
 * The oldest release that still fetches host files and whose selector fixes
 * we keep delivering. Raise it by hand once older builds have left the
 * stores; at `UNKNOWN_SEMANTIC_KEY_TOLERANT_VERSION` or later every new key
 * may be published. 1.9.0 is already below it: it cannot read `composerRoot`
 * or `sendButton`, so it gets no remote site fixes for the sites that use them.
 */
export const OLDEST_REMOTE_SITE_CONSUMER_VERSION = '2.0.0';

export interface SemanticKeyPublishPolicy {
  readonly oldestConsumer: string;
  readonly tolerantSince: string;
  readonly since: Readonly<Record<string, string>>;
}

const DEFAULT_POLICY: SemanticKeyPublishPolicy = {
  oldestConsumer: OLDEST_REMOTE_SITE_CONSUMER_VERSION,
  tolerantSince: UNKNOWN_SEMANTIC_KEY_TOLERANT_VERSION,
  since: SEMANTIC_KEY_SINCE_VERSION,
};

export interface UnpublishableSemanticKey {
  readonly key: string;
  readonly since: string;
}

function atLeast(version: string, floor: string): boolean {
  return engineSatisfied(`>=${floor}`, version);
}

/**
 * Keys in `keys` that the oldest consumer would reject together with the whole
 * adapter. Keys outside the vocabulary are left to the authoring check.
 */
export function semanticKeysTooNewToPublish(
  keys: Iterable<string>,
  policy: SemanticKeyPublishPolicy = DEFAULT_POLICY,
): readonly UnpublishableSemanticKey[] {
  if (atLeast(policy.oldestConsumer, policy.tolerantSince)) return [];
  const tooNew: UnpublishableSemanticKey[] = [];
  for (const key of keys) {
    const since = isSemanticSelectorKey(key) ? policy.since[key] : undefined;
    if (since !== undefined && !atLeast(policy.oldestConsumer, since)) {
      tooNew.push({ key, since });
    }
  }
  return tooNew;
}
