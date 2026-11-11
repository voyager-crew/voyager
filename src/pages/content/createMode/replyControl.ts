/**
 * The control under one plugin code block in a Create chat. Its UI lives in a
 * shadow root, so the reply's text, copy and export never read it, and its
 * colours follow the page's own text colour in either scheme.
 */
import { isUserEvent } from '@/core/utils/userEvent';
import type { CreationCandidate } from '@/features/plugins/local/creation/types';
import { getTranslationSync } from '@/utils/i18n';
import type { TranslationKey } from '@/utils/translations';

export const REPLY_CONTROL_CLASS = 'gv-create-control';

export type ReplyControlAction = 'preview' | 'problems';

type ControlView =
  | { readonly kind: 'action'; readonly action: ReplyControlAction; readonly label: TranslationKey }
  | { readonly kind: 'chip'; readonly label: TranslationKey };

/** What a block offers: only the latest block per plugin id acts. */
function controlView(candidate: CreationCandidate): ControlView {
  if (!candidate.latest) return { kind: 'chip', label: 'createModeEarlierVersion' };
  const { verdict } = candidate;
  if (verdict.kind === 'rejected')
    return { kind: 'action', action: 'problems', label: 'createModeSendProblems' };
  switch (verdict.install.kind) {
    case 'new':
      return { kind: 'action', action: 'preview', label: 'createModePreviewInstall' };
    case 'update':
      return { kind: 'action', action: 'preview', label: 'createModePreviewUpdate' };
    case 'installed':
      return { kind: 'chip', label: 'createModeInstalledChip' };
  }
}

const SHADOW_CSS = `
:host { display: block; margin-block: 6px 10px; }
.row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font: 500 12px/1.4 system-ui, sans-serif; }
.brand { opacity: 0.6; }
.note { opacity: 0.75; }
button, .chip {
  border: 0; border-radius: 999px; padding: 4px 12px; font: inherit; color: inherit;
  background: color-mix(in srgb, currentColor 10%, transparent);
}
button { cursor: pointer; }
button:hover { background: color-mix(in srgb, currentColor 16%, transparent); }
button:focus-visible { outline: 2px solid color-mix(in srgb, currentColor 55%, transparent); outline-offset: 2px; }
.chip { opacity: 0.7; }
`;

export interface ReplyControl {
  readonly host: HTMLElement;
  show(candidate: CreationCandidate): void;
  relabel(): void;
}

export function createReplyControl(
  doc: Document,
  onAction: (action: ReplyControlAction, candidate: CreationCandidate) => void,
): ReplyControl {
  const host = doc.createElement('div');
  host.className = REPLY_CONTROL_CLASS;
  const root = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = SHADOW_CSS;
  const row = doc.createElement('div');
  row.className = 'row';
  root.append(style, row);
  let current: CreationCandidate | null = null;

  const render = (): void => {
    if (!current) return;
    const candidate = current;
    const view = controlView(candidate);
    const brand = doc.createElement('span');
    brand.className = 'brand';
    brand.textContent = 'Voyager';
    const parts: HTMLElement[] = [brand];
    if (view.kind === 'chip') {
      const chip = doc.createElement('span');
      chip.className = 'chip';
      chip.textContent = getTranslationSync(view.label);
      parts.push(chip);
    } else {
      if (view.action === 'problems') {
        const note = doc.createElement('span');
        note.className = 'note';
        note.textContent = getTranslationSync('createModeRejectedNote');
        parts.push(note);
      }
      const button = doc.createElement('button');
      button.type = 'button';
      button.textContent = getTranslationSync(view.label);
      button.addEventListener('click', (event) => {
        // A page script's synthetic click must not open a review or write the composer.
        if (!isUserEvent(event)) return;
        onAction(view.action, candidate);
      });
      parts.push(button);
    }
    row.replaceChildren(...parts);
  };

  return {
    host,
    show(candidate) {
      const same =
        current?.latest === candidate.latest &&
        current.text === candidate.text &&
        JSON.stringify(current.verdict) === JSON.stringify(candidate.verdict);
      current = candidate;
      if (!same) render();
    },
    relabel: render,
  };
}
