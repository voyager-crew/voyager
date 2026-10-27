import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/menu-packaged.json';

import { promptPageScope } from '../prompt/promptPageScope';
import { watchRouteChanges } from '../utils/routeWatcher';

// These are packaged account evidence, never remote locators or conversation text.
const ACCOUNT_EVIDENCE = '[data-email], [aria-label*="@"]';

function containsMatch(node: Node, selector: string): boolean {
  return node instanceof Element && (node.matches(selector) || !!node.querySelector(selector));
}

function affectsAccount(record: MutationRecord): boolean {
  if (record.type === 'childList') {
    return [...record.addedNodes, ...record.removedNodes].some((node) =>
      containsMatch(node, ACCOUNT_EVIDENCE),
    );
  }
  const target = record.target;
  if (!(target instanceof Element)) return false;
  if (record.attributeName === 'data-email') return true;
  if (record.attributeName === 'aria-label')
    return target.matches(ACCOUNT_EVIDENCE) || record.oldValue?.includes('@') === true;
  return containsMatch(target, ACCOUNT_EVIDENCE);
}

/** Menu waits need account/route changes, not every streaming or animation attribute. */
export function watchMenuPageScope(onChange: () => void): () => void {
  const original = promptPageScope();
  const check = () => {
    if (promptPageScope() !== original) onChange();
  };
  const stopRoute = watchRouteChanges(check);
  const observer = new MutationObserver((records) => {
    if (records.some(affectsAccount)) check();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributeOldValue: true,
    attributeFilter: [
      'data-email',
      'aria-label',
      'href',
      'class',
      'id',
      'data-message-author-role',
    ],
  });
  return () => {
    stopRoute();
    observer.disconnect();
  };
}

/** Watch only the native association and the row that supplies this action's identity. */
export function watchMenuActionIdentity(
  panel: HTMLElement,
  button: HTMLElement,
  trigger: HTMLElement | null,
  sidebar: Element | null | undefined,
  check: () => void,
): () => void {
  const observer = new MutationObserver((records) => {
    if (
      records.some((record) => {
        if (record.type === 'attributes') {
          return (
            record.target === trigger ||
            (record.target instanceof Element && record.target.matches('[aria-haspopup]')) ||
            (record.attributeName === 'aria-haspopup' && record.oldValue === 'menu')
          );
        }
        return (
          [...record.removedNodes].some(
            (node) =>
              node.contains(panel) ||
              node.contains(button) ||
              (trigger !== null && node.contains(trigger)),
          ) ||
          [...record.addedNodes, ...record.removedNodes].some((node) =>
            containsMatch(node, packaged['menu.expandedTrigger']),
          )
        );
      })
    )
      check();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributeOldValue: true,
    attributeFilter: [
      'aria-haspopup',
      'aria-expanded',
      'aria-controls',
      'aria-owns',
      'data-test-id',
    ],
  });
  const ownerObserver = new MutationObserver(check);
  ownerObserver.observe(panel, { attributeFilter: ['id'] });
  const directRow = trigger?.closest('[data-test-id="conversation"]');
  const identityOwner = directRow ?? sidebar;
  if (identityOwner)
    ownerObserver.observe(identityOwner, {
      childList: true,
      characterData: true,
      subtree: true,
      attributeFilter: directRow
        ? ['href', 'jslog', 'data-test-id']
        : ['href', 'jslog', 'aria-label', 'title', 'data-test-id'],
    });
  return () => {
    observer.disconnect();
    ownerObserver.disconnect();
  };
}
