import { withPageSemanticSelectors } from '@/core/selectors';
/**
 * What a site must name in site.json for its sends to be told apart. Kept free
 * of page code so the popup can tell whether a site's timeline records send times.
 */
import type { SiteAdapter } from '@/features/plugins/types';

export interface SendInputs {
  readonly siteId: string;
  readonly matches: readonly string[];
  readonly conversationIdPattern: string;
  /** A user message. */
  readonly userTurn: string;
  /** The prompt field. */
  readonly composer: string;
  readonly composerRoot?: string;
  readonly sendButton?: string;
  /** Attributes, on the turn or its nearest ancestor holding one, that keep a message's identity. */
  readonly turnKeyAttributes: readonly string[];
}

/**
 * The send inputs `adapter` provides, or `null` when it lacks any of them: such
 * a site has no send tracking, rather than tracking that could stamp the wrong turn.
 */
export function sendInputsOf(adapter: SiteAdapter | null | undefined): SendInputs | null {
  adapter = adapter
    ? withPageSemanticSelectors(adapter, ['composer', 'composerRoot', 'sendButton', 'userTurn'])
    : adapter;
  const userTurn = adapter?.selectors.userTurn;
  const composer = adapter?.selectors.composer;
  const pattern = adapter?.conversationIdPattern;
  const turnKeyAttributes = adapter?.turnKeyAttributes;
  if (!adapter || !userTurn || !composer || !pattern || !turnKeyAttributes?.length) return null;
  return {
    siteId: adapter.id,
    matches: adapter.matches,
    conversationIdPattern: pattern,
    userTurn,
    composer,
    composerRoot: adapter.selectors.composerRoot,
    sendButton: adapter.selectors.sendButton,
    turnKeyAttributes,
  };
}
