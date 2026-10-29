import { beforeEach, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import { container, extensionApi, sync } from './popupHarness';

/**
 * The browser's grants, with its meaning of a match pattern: `*.x` covers x
 * itself and every subdomain, a `*` scheme both schemes, `<all_urls>` all.
 */
export const granted = new Set<string>();
const listeners = { added: [] as (() => void)[], removed: [] as (() => void)[] };

function covers(grant: string, wanted: string): boolean {
  if (grant === '<all_urls>') return true;
  const parse = (pattern: string) => /^(\*|https?):\/\/([^/]+)\//.exec(pattern);
  const [have, want] = [parse(grant), parse(wanted)];
  if (!have || !want) return grant === wanted;
  if (have[1] !== '*' && have[1] !== want[1]) return false;
  if (have[2] === want[2]) return true;
  if (!have[2].startsWith('*.')) return false;
  const domain = have[2].slice(2);
  const host = want[2].replace(/^\*\./, '');
  return host === domain || host.endsWith(`.${domain}`);
}

export const holds = (origin: string) => [...granted].some((grant) => covers(grant, origin));

export function grant(...origins: string[]): void {
  granted.clear();
  for (const origin of origins) granted.add(origin);
}

/** The coverage-access pair a stored entry asks for. */
export const coverageGrants = (entry: string) => [`https://*.${entry}/*`, `http://*.${entry}/*`];

export const coverage = () => sync[StorageKeys.PROMPT_CUSTOM_WEBSITES];
export const siteRow = (id: string) =>
  container.querySelector<HTMLElement>(`[data-site-access="${id}"]`)!;
export const pluginSwitch = (name: string) =>
  container.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!;
export const promptSwitch = () =>
  container.querySelector<HTMLInputElement>('#prompt-manager-site-enabled')!;
export const buttonWithText = (text: string, within: ParentNode = container) =>
  Array.from(within.querySelectorAll('button')).find((button) => button.textContent === text);
export const otherWebsiteRows = () =>
  Array.from(container.querySelectorAll<HTMLElement>('section[aria-labelledby] li'));
export const otherWebsites = () =>
  otherWebsiteRows().map((row) => row.querySelector(':scope > bdi')?.textContent);
/** The undo toast's live region, empty while nothing is offered. */
export const toast = () => container.querySelector<HTMLElement>('.sticky > [role="status"]')!;

beforeEach(() => {
  granted.clear();
  listeners.added = [];
  listeners.removed = [];
  // Dynamic registration is what lets a plugin be granted and injected at all.
  vi.stubGlobal('chrome', {
    ...extensionApi,
    scripting: { registerContentScripts: vi.fn(), unregisterContentScripts: vi.fn() },
  });
  const { permissions } = extensionApi;
  // A one-off answer a test queued but never used must not reach the next test.
  for (const method of [permissions.contains, permissions.request, permissions.remove]) {
    method.mockReset();
  }
  permissions.contains.mockImplementation(async ({ origins }: { origins: string[] }) =>
    origins.every(holds),
  );
  permissions.request.mockImplementation(async ({ origins }: { origins: string[] }) => {
    for (const origin of origins) granted.add(origin);
    for (const listener of listeners.added) listener();
    return true;
  });
  permissions.remove.mockImplementation(async ({ origins }: { origins: string[] }) => {
    for (const origin of origins) granted.delete(origin);
    for (const listener of listeners.removed) listener();
    return true;
  });
  permissions.getAll.mockImplementation(async () => ({ origins: [...granted], permissions: [] }));
  permissions.onAdded.addListener.mockImplementation((listener: () => void) =>
    listeners.added.push(listener),
  );
  permissions.onRemoved.addListener.mockImplementation((listener: () => void) =>
    listeners.removed.push(listener),
  );
});
