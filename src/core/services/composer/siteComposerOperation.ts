import { hasVoyagerOwner } from '@/core/gemini/composer/ownedInput';
import { getBundledSiteSelectorView } from '@/core/selectors';
import { getSiteSelectorContract } from '@/core/selectors/contracts';
import type { SiteAdapter } from '@/features/plugins/types';

import { hasSiteContentOwner, nativeSiteComposerRoot } from './siteInputReads';

export interface ComposerSelectors {
  readonly composer: string;
  readonly composerRoot: string;
  readonly sendButton: string;
}
export interface ComposerRead {
  readonly field: HTMLElement | null;
  readonly root: Element | null;
  readonly control: HTMLElement | null;
}

const same = <T>(a: readonly T[], b: readonly T[]): boolean =>
  a.length === b.length && a.every((item, index) => item === b[index]);

/** All selectors in a send/insertion are accepted together, before the owner can act. */
export function resolveComposerOperation<T extends ComposerRead>(
  adapter: Pick<SiteAdapter, 'id'>,
  doc: Document,
  selectors: ComposerSelectors,
  read: (selectors: ComposerSelectors, requiresProof: boolean) => T,
): T {
  const contract = getSiteSelectorContract(adapter.id);
  if (!contract) return read(selectors, false);
  const profiles = getBundledSiteSelectorView(adapter.id).profiles;
  // Noncontract fields retain the pre-migration catalog override, including the upload owner.
  const baseline = (key: keyof ComposerSelectors): string =>
    contract.keys.includes(key) ? (profiles[key]?.join(',') ?? selectors[key]) : selectors[key];
  const bundle: ComposerSelectors = {
    composer: baseline('composer'),
    composerRoot: baseline('composerRoot'),
    sendButton: baseline('sendButton'),
  };
  if (
    Object.keys(bundle).every(
      (key) => bundle[key as keyof ComposerSelectors] === selectors[key as keyof ComposerSelectors],
    )
  )
    return read(selectors, false);
  const fallback = read(bundle, false);
  try {
    const actual = read(selectors, true);
    const oldFields = Array.from(doc.querySelectorAll(bundle.composer));
    const fields = Array.from(doc.querySelectorAll(selectors.composer));
    if (oldFields.length && !same(fields, oldFields)) return fallback;
    if (
      !actual.field ||
      !actual.root ||
      !actual.root.contains(actual.field) ||
      hasVoyagerOwner(actual.field) ||
      actual.field.closest('[role="dialog"], dialog, [data-gv-plugin]')
    )
      return fallback;
    if (
      hasSiteContentOwner(adapter.id, actual.field) ||
      actual.root !== nativeSiteComposerRoot(adapter.id, actual.field)
    )
      return fallback;
    if (fallback.field && actual.field !== fallback.field) return fallback;
    if (fallback.root && actual.root !== fallback.root) return fallback;
    const nativeInputs = Array.from(
      actual.root.querySelectorAll(
        'textarea, [contenteditable="true"], [contenteditable="plaintext-only"]',
      ),
    );
    if (
      !fallback.field &&
      (nativeInputs.length !== 1 || nativeInputs[0] !== actual.field || fields.length !== 1)
    )
      return fallback;
    if (
      actual.control instanceof HTMLButtonElement &&
      actual.control.form !== actual.field.closest('form')
    )
      return fallback;
    if (fallback.control) return actual.control === fallback.control ? actual : fallback;
    if (!actual.control) return actual;
    const installedControls = Array.from(doc.querySelectorAll(bundle.sendButton)).filter(
      (control) => actual.root!.contains(control),
    );
    if (installedControls.length === 1 && installedControls[0] === actual.control) return actual;
    // A remote button cannot borrow a sibling editor's send or turn a Stop into a submission.
    const nativeSends = Array.from(
      actual.root.querySelectorAll<HTMLElement>('button, [role="button"]'),
    ).filter(
      (control) =>
        !/\b(stop|cancel)\b|停止|取消|중지|إيقاف/i.test(
          `${control.getAttribute('aria-label') ?? ''} ${control.textContent ?? ''}`,
        ) &&
        !control.matches(':disabled, [aria-disabled="true"]') &&
        !control.closest('[hidden], [inert], [aria-hidden="true"]') &&
        (/\b(send|submit)\b|发送|傳送|送出|送信|전송/i.test(
          `${control.getAttribute('aria-label') ?? ''} ${control.textContent ?? ''}`,
        ) ||
          (control instanceof HTMLButtonElement && control.type === 'submit')),
    );
    return nativeSends.length === 1 && nativeSends[0] === actual.control ? actual : fallback;
  } catch {
    return fallback;
  }
}
