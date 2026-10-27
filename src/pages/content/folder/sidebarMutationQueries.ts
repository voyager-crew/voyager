import type { GeminiSelectorView } from '@/core/gemini/selectors';
import {
  geminiSidebarSelector,
  resolveGeminiSidebarOperation,
} from '@/core/gemini/sidebar/queries';

import {
  isPackagedNativeConversationRow,
  isUsableSidebarObservationRow,
} from './sidebarConversationQueries';

interface SidebarMutationRead {
  rows: HTMLElement[];
  titlesChanged: boolean;
}

function readMutations(
  mutations: readonly MutationRecord[],
  view: GeminiSelectorView,
): SidebarMutationRead {
  const selector = geminiSidebarSelector('sidebar.row', view);
  const rows = new Set<HTMLElement>();
  let titlesChanged = false;
  const touches = (node: Node): boolean =>
    node instanceof Element && (!!node.closest(selector) || !!node.querySelector(selector));

  for (const mutation of mutations) {
    if (mutation.type === 'characterData') {
      titlesChanged ||= !!mutation.target.parentElement?.closest(selector);
      continue;
    }
    if (mutation.type === 'attributes') {
      titlesChanged ||= mutation.target instanceof Element && !!mutation.target.closest(selector);
      continue;
    }
    if (mutation.type !== 'childList') continue;
    titlesChanged ||= mutation.target instanceof Element && !!mutation.target.closest(selector);
    for (const node of Array.from(mutation.addedNodes)) {
      titlesChanged ||= touches(node);
      if (!(node instanceof HTMLElement)) continue;
      if (node.matches(selector)) rows.add(node);
      node.querySelectorAll<HTMLElement>(selector).forEach((row) => rows.add(row));
    }
  }

  return {
    rows: [...rows].filter(
      (row) => isPackagedNativeConversationRow(row) && isUsableSidebarObservationRow(row, view),
    ),
    titlesChanged,
  };
}

/** One mutation batch uses one view; no effects run during an abandoned online read. */
export function readNativeSidebarMutations(
  mutations: readonly MutationRecord[],
): SidebarMutationRead {
  return resolveGeminiSidebarOperation(
    (view) => readMutations(mutations, view),
    // A matched label cannot mask rejected rows and prevent their bundled enhancement.
    (result) => result.rows.length > 0,
  ).value;
}
