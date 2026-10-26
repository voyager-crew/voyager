import type { AccountPlatform } from '@/core/services/AccountIsolationService';

// This only filters notifications; AccountIsolationService still chooses the account.
const GEMINI_ACCOUNT_EVIDENCE = '[data-email], [aria-label*="@"]';
const STUDIO_ACCOUNT_EVIDENCE =
  '.account-switcher-text, #account-switcher-button, alkali-accountswitcher, .account-switcher-container';

function containsEvidence(node: Node, selector: string): boolean {
  return node instanceof Element && (node.matches(selector) || !!node.querySelector(selector));
}

export function promptAccountMutation(record: MutationRecord, platform: AccountPlatform): boolean {
  const studio = platform === 'aistudio';
  const evidence = studio ? STUDIO_ACCOUNT_EVIDENCE : GEMINI_ACCOUNT_EVIDENCE;
  const target = record.target instanceof Element ? record.target : record.target.parentElement;
  if (studio && target?.closest(evidence)) return true;
  if (record.type === 'characterData') return false;
  if (record.type === 'childList') {
    return [...record.addedNodes, ...record.removedNodes].some((node) =>
      containsEvidence(node, evidence),
    );
  }
  if (!target) return false;
  if (!studio && record.attributeName === 'data-email') return true;
  if (!studio && record.attributeName === 'aria-label')
    return target.matches(evidence) || record.oldValue?.includes('@') === true;
  if (studio && (record.attributeName === 'class' || record.attributeName === 'id')) {
    if (record.oldValue?.split(/\s+/).some((value) => value.startsWith('account-switcher-')))
      return true;
  }
  // Page decoration changes cannot alter account ownership, and must not scan the whole page.
  if (target === document.body || target === document.documentElement) return false;
  return containsEvidence(target, evidence);
}

export const PROMPT_ACCOUNT_ATTRIBUTES = [
  'data-email',
  'aria-label',
  'href',
  'title',
  'class',
  'id',
  'data-message-author-role',
];
