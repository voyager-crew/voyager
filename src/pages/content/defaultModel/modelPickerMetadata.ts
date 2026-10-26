/** Model identities and thinking semantics are packaged; a locator cannot change them. */
const EXTENDED_THINKING_TOGGLE_JSLOG_ID = '323336';

export function isInlineThinkingItem(item: HTMLElement): boolean {
  if (item.getAttribute('value') === 'thinking_level') return false;
  return item.getAttribute('jslog')?.split(';', 1)[0]?.trim() === EXTENDED_THINKING_TOGGLE_JSLOG_ID;
}

export function isNestedThinkingItem(item: HTMLElement): boolean {
  if (item.getAttribute('value') === 'thinking_level') return false;
  for (let parent = item.parentElement; parent; parent = parent.parentElement) {
    if (parent.getAttribute('value') === 'thinking_level') return true;
  }
  return false;
}

export function readModelId(item: HTMLElement): string | null {
  const raw = item.getAttribute('data-mode-id') || item.dataset.modeId;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  const jslog = item.getAttribute('jslog');
  if (typeof jslog !== 'string') return null;
  const matchedIds = readJslogMetadata(jslog).match(/[a-f0-9]{16}/gi);
  return matchedIds?.[matchedIds.length - 1]?.trim() || null;
}

function readJslogMetadata(jslog: string): string {
  const encoded = jslog.match(/BardVeMetadataKey:([A-Za-z0-9+/_-]+={0,2})(?:;|$)/)?.[1];
  if (!encoded) return jslog;
  try {
    return atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    return jslog;
  }
}

export function hasNativeSelectedState(
  item: HTMLElement,
  kind: 'model' | 'thinking' | 'nested',
): boolean {
  if (kind === 'nested') return item.classList.contains('selected');
  return (
    item.classList.contains('selected') ||
    item.getAttribute('aria-checked') === 'true' ||
    (kind === 'model'
      ? item.classList.contains('is-selected')
      : item.getAttribute('aria-selected') === 'true')
  );
}

export function hasNativeItemRole(item: HTMLElement): boolean {
  const role = item.getAttribute('role');
  return role === 'menuitem' || role === 'menuitemradio' || item.localName === 'gem-menu-item';
}

export function isNativeThinkingRow(item: HTMLElement): boolean {
  return (
    item instanceof HTMLElement &&
    item.getAttribute('value') === 'thinking_level' &&
    hasNativeItemRole(item)
  );
}
