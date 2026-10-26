import {
  getBundledSiteSelectorView,
  getPageSelectorSiteId,
  type SiteSelectorView,
} from '@/core/selectors';
import { guardedChatgptSemanticSelector } from '@/core/selectors/chatgptSemantics';
import { getSiteSelectorContract } from '@/core/selectors/contracts';
import { resolveComposerOperation } from '@/core/services/composer/siteComposerOperation';
import { nativeSiteComposerRoot } from '@/core/services/composer/siteInputReads';

import type { SendInputs } from './sendInputs';

export interface SendTargetSource extends SendInputs {
  readonly selectorView?: SiteSelectorView;
}

type TargetSelectors = Pick<SendInputs, 'composer' | 'composerRoot' | 'sendButton' | 'userTurn'>;
const COMPOSER_KEYS = ['composer', 'composerRoot', 'sendButton'] as const;
const KEYS = [...COMPOSER_KEYS, 'userTurn'] as const;
export type TrackingTargets = TargetSelectors & {
  readonly remoteComposer: boolean;
  readonly provedRoot: Element | null;
};

export interface SendTargetReader {
  readonly bundled: TrackingTargets;
  readonly candidateSendButton?: string;
  readonly read?: () => TrackingTargets;
  readonly readUserTurn?: () => string;
}

/** Freeze candidate strings once; only a changed profile pays for operation-time proof. */
export function prepareSendTargets(site: SendTargetSource, doc: Document): SendTargetReader {
  const original = { ...site, remoteComposer: false, provedRoot: null };
  const view = site.selectorView;
  // The bundled path keeps its original event and mutation reads, without URL parsing or joins.
  if (
    !view ||
    !getSiteSelectorContract(site.siteId) ||
    !KEYS.some((key) => view.remoteKeys.has(key)) ||
    view.siteId !== getPageSelectorSiteId(doc)
  )
    return { bundled: original };
  const profiles = getBundledSiteSelectorView(site.siteId).profiles;
  const bundle: TargetSelectors = {
    composer: profiles.composer?.join(',') ?? site.composer,
    composerRoot: profiles.composerRoot?.join(',') ?? site.composerRoot,
    sendButton: profiles.sendButton?.join(',') ?? site.sendButton,
    userTurn: profiles.userTurn?.join(',') ?? site.userTurn,
  };
  const selected: TargetSelectors = {
    composer: view.profiles.composer?.join(',') ?? site.composer,
    composerRoot: view.profiles.composerRoot?.join(',') ?? site.composerRoot,
    sendButton: view.profiles.sendButton?.join(',') ?? site.sendButton,
    userTurn: view.profiles.userTurn?.join(',') ?? site.userTurn,
  };
  const bundled = { ...bundle, remoteComposer: false, provedRoot: null };
  return {
    bundled,
    candidateSendButton: selected.sendButton,
    read: () => readTargets(site, doc, view, selected, bundle, bundled),
    readUserTurn: view.remoteKeys.has('userTurn')
      ? () => {
          try {
            return (
              checkedUserTurn(site, doc, view, selected.userTurn, bundle.userTurn) ??
              bundle.userTurn
            );
          } catch {
            return bundle.userTurn;
          }
        }
      : undefined,
  };
}

/** Tracking proves the complete composer/action operation before it can stamp a user turn. */
function readTargets(
  site: SendTargetSource,
  doc: Document,
  view: SiteSelectorView,
  selected: TargetSelectors,
  bundle: TargetSelectors,
  bundled: TrackingTargets,
): TrackingTargets {
  try {
    const userTurn = checkedUserTurn(site, doc, view, selected.userTurn, bundle.userTurn);
    if (userTurn === null) return bundled;
    selected = { ...selected, userTurn };
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

function checkedUserTurn(
  site: SendTargetSource,
  doc: Document,
  view: SiteSelectorView,
  selected: string,
  bundle: string,
): string | null {
  if (selected === bundle) return bundle;
  if (site.siteId === 'chatgpt') {
    return (
      guardedChatgptSemanticSelector(
        'userTurn',
        {
          ...view,
          profiles: { ...view.profiles, userTurn: [selected] },
          remoteKeys: new Set([...view.remoteKeys, 'userTurn']),
        },
        doc,
      ) ?? bundle
    );
  }
  const actual = Array.from(doc.querySelectorAll(selected));
  const expected = Array.from(doc.querySelectorAll(bundle));
  // A partial turn set must never stamp another turn as the user's new send.
  return actual.length === expected.length &&
    actual.every((element, index) => element === expected[index])
    ? selected
    : null;
}
