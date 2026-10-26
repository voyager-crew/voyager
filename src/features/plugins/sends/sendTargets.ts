import { getBundledSiteSelectorView, getSiteSelectorView } from '@/core/selectors';
import { guardedChatgptSemanticSelector } from '@/core/selectors/chatgptSemantics';
import { getSiteSelectorContract } from '@/core/selectors/contracts';
import { resolveComposerOperation } from '@/core/services/composer/siteComposerOperation';
import { nativeSiteComposerRoot } from '@/core/services/composer/siteInputReads';

import type { SendInputs } from './sendInputs';

type TargetSelectors = Pick<SendInputs, 'composer' | 'composerRoot' | 'sendButton' | 'userTurn'>;
const COMPOSER_KEYS = ['composer', 'composerRoot', 'sendButton'] as const;
const KEYS = [...COMPOSER_KEYS, 'userTurn'] as const;
type TrackingTargets = TargetSelectors & {
  readonly remoteComposer: boolean;
  readonly provedRoot: Element | null;
};

/** Tracking uses the same complete composer/action proof before it can stamp a user turn. */
export function sendTargets(site: SendInputs, doc: Document): TrackingTargets {
  // Custom adapters have no catalog claim; their installed selectors keep the legacy path.
  if (!getSiteSelectorContract(site.siteId))
    return { ...site, remoteComposer: false, provedRoot: null };
  const profiles = getBundledSiteSelectorView(site.siteId).profiles;
  const bundle: TargetSelectors = {
    composer: profiles.composer?.join(',') ?? site.composer,
    composerRoot: profiles.composerRoot?.join(',') ?? site.composerRoot,
    sendButton: profiles.sendButton?.join(',') ?? site.sendButton,
    userTurn: profiles.userTurn?.join(',') ?? site.userTurn,
  };
  let selected = {
    ...bundle,
    ...Object.fromEntries(
      KEYS.filter((key) => site[key] !== undefined).map((key) => [key, site[key]]),
    ),
  } as TargetSelectors;
  const bundled = { ...bundle, remoteComposer: false, provedRoot: null };
  if (KEYS.every((key) => selected[key] === bundle[key])) return bundled;
  try {
    if (selected.userTurn !== bundle.userTurn) {
      if (site.siteId === 'chatgpt') {
        const view = getSiteSelectorView('chatgpt');
        selected = {
          ...selected,
          userTurn:
            guardedChatgptSemanticSelector(
              'userTurn',
              {
                ...view,
                profiles: { ...view.profiles, userTurn: [selected.userTurn] },
                remoteKeys: new Set([...view.remoteKeys, 'userTurn']),
              },
              doc,
            ) ?? bundle.userTurn,
        };
      }
      const actual = Array.from(doc.querySelectorAll(selected.userTurn));
      const expected = Array.from(doc.querySelectorAll(bundle.userTurn));
      // A partial turn set must never stamp another turn as the user's new send.
      if (
        site.siteId !== 'chatgpt' &&
        (actual.length !== expected.length ||
          actual.some((element, index) => element !== expected[index]))
      )
        return bundled;
    }
    if (COMPOSER_KEYS.every((key) => selected[key] === bundle[key]))
      return { ...selected, remoteComposer: false, provedRoot: null };
    if (!selected.composerRoot || !selected.sendButton) return bundled;
    const accepted = resolveComposerOperation(
      { id: site.siteId },
      doc,
      {
        composer: selected.composer,
        composerRoot: selected.composerRoot,
        sendButton: selected.sendButton,
      },
      (selectors, requiresProof) => {
        const field = doc.querySelector<HTMLElement>(selectors.composer);
        const root = field
          ? (field.closest(selectors.composerRoot) ??
            (requiresProof ? nativeSiteComposerRoot(site.siteId, field) : null))
          : null;
        const control = root
          ? (Array.from(doc.querySelectorAll<HTMLElement>(selectors.sendButton)).find((button) =>
              root.contains(button),
            ) ?? null)
          : null;
        return { field, root, control, selectors };
      },
    );
    return {
      ...selected,
      ...accepted.selectors,
      remoteComposer: COMPOSER_KEYS.some((key) => accepted.selectors[key] !== bundle[key]),
      provedRoot: accepted.root,
    };
  } catch {
    return bundled;
  }
}
