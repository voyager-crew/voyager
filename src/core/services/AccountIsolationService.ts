import { StorageKeys } from '@/core/types/common';
import { getVoyagerBuildTarget } from '@/core/utils/browser';
import { hashString } from '@/core/utils/hash';
import {
  FOLDER_PLATFORMS,
  type AccountScopedFolderPlatform,
  supportsAccountIsolation,
  getFolderPlatformForHost,
} from '@/features/folder/platforms';

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PROFILE_MAP_VERSION = 1;
const PROFILE_MAP_LOCK_NAME = 'gv-account-profile-map';
const ACCOUNT_SCOPE_RESOLVE_MESSAGE = 'gv.account.resolve';

interface AccountProfileRecord {
  id: number;
  createdAt: number;
  updatedAt: number;
  routeUserId?: string;
  emailHash?: string;
}

interface AccountProfileMap {
  version: number;
  nextId: number;
  profiles: Record<string, AccountProfileRecord>;
  routeAliases: Record<string, string>;
  emailAliases: Record<string, string>;
}

export interface AccountScope {
  accountKey: string;
  accountId: number;
  routeUserId: string | null;
  emailHash: string | null;
}

export interface AccountScopeHints {
  pageUrl?: string | null;
  routeUserId?: string | null;
  email?: string | null;
}

export interface AccountContext {
  routeUserId: string | null;
  email: string | null;
}

/** Platforms with their own folder bucket and account isolation switch. */
export type AccountPlatform = AccountScopedFolderPlatform;

interface AccountScopeResolveResponse {
  ok: true;
  scope: AccountScope;
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function parseHostname(url: string): string | null {
  return parseUrl(url)?.hostname.toLowerCase() ?? null;
}

function isAIStudioHost(hostname: string | null): boolean {
  return getFolderPlatformForHost(hostname) === 'aistudio';
}

function isGeminiHost(hostname: string | null): boolean {
  return getFolderPlatformForHost(hostname) === 'gemini';
}

/**
 * Resolve the folder/account platform that owns a page.
 *
 * Returns `null` for any other web page (ChatGPT, Claude, DeepSeek, custom websites): those sites
 * have no account-isolated bucket. ChatGPT, Claude and DeepSeek folders remain unscoped until
 * isolation is supported.
 * Without a web page (missing URL, new tab, extension pages) the historical Gemini default stays,
 * matching the popup's full Gemini settings surface on those tabs.
 */
export function detectAccountPlatformFromUrl(
  pageUrl: string | null | undefined,
): AccountPlatform | null {
  const parsed = parseUrl(pageUrl || '');
  if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) return 'gemini';
  const platform = getFolderPlatformForHost(parsed.hostname);
  return platform && supportsAccountIsolation(platform) ? platform : null;
}

export function getAccountIsolationStorageKey(platform: AccountPlatform): string {
  return FOLDER_PLATFORMS[platform].accountIsolationStorageKey;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAccountScope(value: unknown): value is AccountScope {
  if (!isRecord(value)) return false;
  return (
    typeof value.accountKey === 'string' &&
    typeof value.accountId === 'number' &&
    (typeof value.routeUserId === 'string' || value.routeUserId === null) &&
    (typeof value.emailHash === 'string' || value.emailHash === null)
  );
}

function isAccountScopeResolveResponse(value: unknown): value is AccountScopeResolveResponse {
  return isRecord(value) && value.ok === true && isAccountScope(value.scope);
}

function shouldResolveScopeInBackground(): boolean {
  if (getVoyagerBuildTarget() !== 'firefox' || typeof location === 'undefined') return false;
  return location.protocol === 'http:' || location.protocol === 'https:';
}

function toStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] =>
        typeof entry[0] === 'string' && typeof entry[1] === 'string',
    ),
  );
}

function toProfileRecord(value: unknown): AccountProfileRecord | null {
  if (!isRecord(value)) return null;
  const id = value.id;
  const createdAt = value.createdAt;
  const updatedAt = value.updatedAt;
  if (typeof id !== 'number' || !Number.isFinite(id)) return null;
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return null;
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return null;

  const routeUserId = typeof value.routeUserId === 'string' ? value.routeUserId : undefined;
  const emailHash = typeof value.emailHash === 'string' ? value.emailHash : undefined;
  return {
    id,
    createdAt,
    updatedAt,
    routeUserId,
    emailHash,
  };
}

function createDefaultProfileMap(): AccountProfileMap {
  return {
    version: PROFILE_MAP_VERSION,
    nextId: 1,
    profiles: {},
    routeAliases: {},
    emailAliases: {},
  };
}

function parseProfileMap(value: unknown): AccountProfileMap {
  if (!isRecord(value)) return createDefaultProfileMap();

  const nextId =
    typeof value.nextId === 'number' && Number.isFinite(value.nextId) ? value.nextId : 1;
  const profilesRaw = isRecord(value.profiles) ? value.profiles : {};

  const profiles: Record<string, AccountProfileRecord> = {};
  for (const [key, recordRaw] of Object.entries(profilesRaw)) {
    if (typeof key !== 'string') continue;
    const record = toProfileRecord(recordRaw);
    if (!record) continue;
    profiles[key] = record;
  }

  return {
    version: PROFILE_MAP_VERSION,
    nextId: Math.max(1, Math.floor(nextId)),
    profiles,
    routeAliases: toStringRecord(value.routeAliases),
    emailAliases: toStringRecord(value.emailAliases),
  };
}

export function extractRouteUserIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/u\/(\d+)\//);
  return match?.[1] ?? null;
}

export function extractRouteUserIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return extractRouteUserIdFromPath(parsed.pathname);
  } catch {
    return null;
  }
}

export function normalizeEmailAddress(email: string | null | undefined): string | null {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  if (!normalized || !EMAIL_PATTERN.test(normalized)) return null;
  return normalized;
}

export function extractEmailFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.match(EMAIL_PATTERN);
  if (!match) return null;
  return normalizeEmailAddress(match[0]);
}

function extractEmailFromElement(element: Element): string | null {
  const candidates = [
    element.getAttribute('data-email'),
    element.getAttribute('aria-label'),
    element.getAttribute('title'),
    element.textContent,
  ];

  if (element instanceof HTMLAnchorElement) {
    candidates.push(element.href);
  }

  for (const candidate of candidates) {
    const email = extractEmailFromText(candidate);
    if (email) return email;
  }

  return null;
}

function findEmailBySelectors(
  doc: Document,
  selectors: string[],
  limitPerSelector: number = 40,
): string | null {
  for (const selector of selectors) {
    const elements = Array.from(doc.querySelectorAll(selector)).slice(0, limitPerSelector);
    for (const element of elements) {
      const email = extractEmailFromElement(element);
      if (email) return email;
    }
  }

  return null;
}

/** Gemini's conversation content and chat list: page text that can carry any email. */
const GEMINI_CONTENT_SELECTOR = [
  '#chat-history',
  'infinite-scroller.chat-history',
  'chat-window-content',
  '.conversation-container',
  'user-query',
  'model-response',
  'message-content',
  'response-element',
  '.markdown',
  'deep-research-immersive-panel',
  '[data-message-author-role]',
  'conversations-list',
].join(', ');

/**
 * The Google account button first, then account labels outside the content. Only attributes
 * are read: never text, `title` or `mailto:` links, which any reply or chat title can carry.
 */
const GEMINI_ACCOUNT_CONTROL_SELECTORS = [
  'a[href*="accounts.google.com"][aria-label*="@"]',
  '[data-email]',
  '[aria-label*="@"]',
];

function findGeminiAccountControlEmail(doc: Document): string | null {
  for (const selector of GEMINI_ACCOUNT_CONTROL_SELECTORS) {
    for (const element of Array.from(doc.querySelectorAll(selector)).slice(0, 40)) {
      if (element.closest(GEMINI_CONTENT_SELECTOR)) continue;
      const email =
        normalizeEmailAddress(element.getAttribute('data-email')) ??
        extractEmailFromText(element.getAttribute('aria-label'));
      if (email) return email;
    }
  }
  return null;
}

export function detectAccountContextFromDocument(pageUrl: string, doc: Document): AccountContext {
  const routeUserId = extractRouteUserIdFromUrl(pageUrl);
  const hostname = parseHostname(pageUrl);

  if (isAIStudioHost(hostname)) {
    const aiStudioEmail = findEmailBySelectors(doc, [
      '.account-switcher-text',
      '#account-switcher-button .button-container[aria-label]',
      'alkali-accountswitcher [aria-label*="@"]',
      '.account-switcher-container [aria-label*="@"]',
    ]);
    // Only the account switcher counts: the page-wide scan below would take a `mailto:` or an
    // email in a prompt, and bind this tab to that account's bucket. No switcher, no email.
    return { routeUserId, email: aiStudioEmail };
  }

  if (isGeminiHost(hostname)) {
    // Only account controls count: an email in a reply, a chat title or a mailto link would
    // otherwise rebind this `/u/N` route to a stranger's bucket. No control, no email.
    return { routeUserId, email: findGeminiAccountControlEmail(doc) };
  }

  const fallbackEmail = findEmailBySelectors(doc, [
    '[data-email]',
    '[aria-label*="@"]',
    '[title*="@"]',
    'a[href^="mailto:"]',
    'img[alt*="@"]',
  ]);
  if (fallbackEmail) {
    return { routeUserId, email: fallbackEmail };
  }

  return { routeUserId, email: null };
}

export function buildScopedStorageKey(baseKey: string, accountKey: string): string {
  return `${baseKey}:acct:${hashString(accountKey)}`;
}

export function buildScopedFolderStorageKey(accountKey: string): string {
  return buildScopedStorageKey(StorageKeys.FOLDER_DATA, accountKey);
}

export class AccountIsolationService {
  private operationQueue: Promise<unknown> = Promise.resolve();

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operationQueue.then(operation, operation);
    this.operationQueue = next.catch(() => undefined);
    return next;
  }

  private async withProfileMapLock<T>(operation: () => Promise<T>): Promise<T> {
    if (typeof navigator === 'undefined' || !navigator.locks?.request) {
      return await operation();
    }
    return await navigator.locks.request(PROFILE_MAP_LOCK_NAME, operation);
  }

  async isIsolationEnabled(options?: {
    /** `null` means a site without a folder bucket; omit it to detect from `pageUrl`. */
    platform?: AccountPlatform | null;
    pageUrl?: string | null;
  }): Promise<boolean> {
    try {
      const platform =
        options?.platform === undefined
          ? detectAccountPlatformFromUrl(options?.pageUrl ?? null)
          : options.platform;
      if (!platform) return false;
      const platformKey = getAccountIsolationStorageKey(platform);
      const result = await chrome.storage.sync.get([
        platformKey,
        StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED,
      ]);

      if (typeof result[platformKey] === 'boolean') {
        return result[platformKey] === true;
      }

      // Backward compatibility: fall back to legacy single flag.
      if (typeof result[StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED] === 'boolean') {
        return result[StorageKeys.GV_ACCOUNT_ISOLATION_ENABLED] === true;
      }

      return false;
    } catch {
      return false;
    }
  }

  async resolveAccountScope(
    hints: AccountScopeHints = {},
    persist: boolean = true,
  ): Promise<AccountScope> {
    // Firefox bug 1873028 prevents Web Locks callbacks from returning a content-script
    // Promise. Resolve in the extension background page instead, where the existing
    // lock remains available and shared across tabs without exposing account data.
    if (shouldResolveScopeInBackground()) {
      const response: unknown = await chrome.runtime.sendMessage({
        type: ACCOUNT_SCOPE_RESOLVE_MESSAGE,
        payload: persist ? hints : { ...hints, persist: false },
      });
      if (!isAccountScopeResolveResponse(response)) {
        throw new Error('Failed to resolve Firefox account scope in the extension background');
      }
      return response.scope;
    }

    return this.serialize(() =>
      this.withProfileMapLock(async () => {
        const routeUserId =
          hints.routeUserId ?? (hints.pageUrl ? extractRouteUserIdFromUrl(hints.pageUrl) : null);
        const normalizedEmail = normalizeEmailAddress(hints.email ?? null);
        const emailHash = normalizedEmail ? hashString(normalizedEmail) : null;
        const now = Date.now();

        const map = await this.readProfileMap();

        const keyFromEmail = emailHash ? map.emailAliases[emailHash] : null;
        const keyFromRoute = routeUserId ? map.routeAliases[routeUserId] : null;
        const routeProfile = keyFromRoute ? map.profiles[keyFromRoute] : null;
        const routeCanBelongToEmail = Boolean(
          routeProfile && (!routeProfile.emailHash || routeProfile.emailHash === emailHash),
        );

        // A `/u/<index>` slot is only a session-local hint: after sign-out or
        // account switching, the same route can represent a different email.
        // Keep the route-only fallback, but never let a stale route alias
        // override an observed, different account identity.
        const accountKey = emailHash
          ? (keyFromEmail ?? (routeCanBelongToEmail ? keyFromRoute : null) ?? `email:${emailHash}`)
          : (keyFromRoute ?? (routeUserId ? `route:${routeUserId}` : 'default'));

        const existing = map.profiles[accountKey];
        const routeAliasChanged = routeUserId
          ? map.routeAliases[routeUserId] !== accountKey
          : false;
        const emailAliasChanged = emailHash ? map.emailAliases[emailHash] !== accountKey : false;

        let profile: AccountProfileRecord;
        let mutated = false;

        if (!existing) {
          profile = {
            id: map.nextId,
            createdAt: now,
            updatedAt: now,
            routeUserId: routeUserId ?? undefined,
            emailHash: emailHash ?? undefined,
          };
          map.nextId += 1;
          map.profiles[accountKey] = profile;
          mutated = true;
        } else {
          const nextRouteUserId = routeUserId ?? existing.routeUserId;
          const nextEmailHash = emailHash ?? existing.emailHash;
          if (nextRouteUserId !== existing.routeUserId || nextEmailHash !== existing.emailHash) {
            profile = {
              ...existing,
              updatedAt: now,
              routeUserId: nextRouteUserId,
              emailHash: nextEmailHash,
            };
            map.profiles[accountKey] = profile;
            mutated = true;
          } else {
            // Nothing actually changed. Skip the updatedAt-only full-map rewrite
            // (and the storage.onChanged fan-out it triggers) on this hot,
            // per-navigation path.
            profile = existing;
          }
        }

        if (routeUserId && routeAliasChanged) {
          map.routeAliases[routeUserId] = accountKey;
          mutated = true;
        }
        if (emailHash && emailAliasChanged) {
          map.emailAliases[emailHash] = accountKey;
          mutated = true;
        }

        // Upload preflight resolves the same identity without creating local state on refusal.
        if (mutated && persist) {
          await this.writeProfileMap(map);
        }

        return {
          accountKey,
          accountId: profile.id,
          routeUserId: routeUserId ?? null,
          emailHash,
        };
      }),
    );
  }

  private async readProfileMap(): Promise<AccountProfileMap> {
    try {
      const result = await chrome.storage.local.get([StorageKeys.GV_ACCOUNT_PROFILE_MAP]);
      return parseProfileMap(result[StorageKeys.GV_ACCOUNT_PROFILE_MAP]);
    } catch {
      return createDefaultProfileMap();
    }
  }

  private async writeProfileMap(map: AccountProfileMap): Promise<void> {
    await chrome.storage.local.set({
      [StorageKeys.GV_ACCOUNT_PROFILE_MAP]: map,
    });
  }
}

export const accountIsolationService = new AccountIsolationService();
