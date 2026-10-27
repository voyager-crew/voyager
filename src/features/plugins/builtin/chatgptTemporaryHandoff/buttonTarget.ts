import { pageSemanticSelector } from '@/core/selectors';
import { chatgptAdapter } from '@/features/plugins/sites/adapters/chatgpt';

import { chatgptActionSelector } from '../chatgptActionTargets';

export function headerSelector(): string {
  return pageSemanticSelector(chatgptAdapter, 'headerActions')!;
}

interface ButtonMountTarget {
  readonly parent: HTMLElement;
  readonly anchor: Element | null;
  readonly floating: boolean;
}

export function findButtonTarget(): ButtonMountTarget {
  const header = document.querySelector<HTMLElement>(headerSelector());
  if (header) return { parent: header, anchor: header.firstElementChild, floating: false };

  const share = document.querySelector<HTMLElement>(chatgptActionSelector('actions.shareButton'));
  const wrapper = share?.parentElement;
  const parent = wrapper?.parentElement;
  if (wrapper && parent) return { parent, anchor: wrapper, floating: false };
  return { parent: document.body, anchor: null, floating: true };
}
