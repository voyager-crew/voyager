import { getBundledSiteSelectorView } from '@/core/selectors';
import { resolveComposerOperation } from '@/core/services/composer/siteComposerOperation';

import type { SendInputs } from './sendInputs';

type TargetSelectors = Pick<SendInputs, 'composer' | 'composerRoot' | 'sendButton' | 'userTurn'>;
const KEYS = ['composer', 'composerRoot', 'sendButton', 'userTurn'] as const;

/** Tracking uses the same complete composer/action proof before it can stamp a user turn. */
export function sendTargets(site: SendInputs, doc: Document): TargetSelectors {
  const profiles = getBundledSiteSelectorView(site.siteId).profiles;
  const bundle: TargetSelectors = {
    composer: profiles.composer?.join(',') ?? site.composer,
    composerRoot: profiles.composerRoot?.join(',') ?? site.composerRoot,
    sendButton: profiles.sendButton?.join(',') ?? site.sendButton,
    userTurn: profiles.userTurn?.join(',') ?? site.userTurn,
  };
  const selected = {
    ...bundle,
    ...Object.fromEntries(
      KEYS.filter((key) => site[key] !== undefined).map((key) => [key, site[key]]),
    ),
  } as TargetSelectors;
  if (KEYS.every((key) => selected[key] === bundle[key])) return selected;
  try {
    if (selected.userTurn !== bundle.userTurn) {
      const actual = Array.from(doc.querySelectorAll(selected.userTurn));
      const expected = Array.from(doc.querySelectorAll(bundle.userTurn));
      // A partial turn set must never stamp another turn as the user's new send.
      if (
        actual.length !== expected.length ||
        actual.some((element, index) => element !== expected[index])
      )
        return bundle;
    }
    if (!selected.composerRoot || !selected.sendButton) return bundle;
    const accepted = resolveComposerOperation(
      { id: site.siteId },
      doc,
      {
        composer: selected.composer,
        composerRoot: selected.composerRoot,
        sendButton: selected.sendButton,
      },
      (selectors) => {
        const field = doc.querySelector<HTMLElement>(selectors.composer);
        const root = field?.closest(selectors.composerRoot) ?? null;
        const control = root
          ? (Array.from(doc.querySelectorAll<HTMLElement>(selectors.sendButton)).find((button) =>
              root.contains(button),
            ) ?? null)
          : null;
        return { field, root, control, selectors };
      },
    );
    return { ...selected, ...accepted.selectors };
  } catch {
    return bundle;
  }
}
