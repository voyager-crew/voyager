import {
  accountIsolationService,
  detectAccountPlatformFromUrl,
} from '@/core/services/AccountIsolationService';
import { highlightAnnotationService } from '@/core/services/HighlightAnnotationService';
import {
  HighlightAnnotationError,
  getHighlightAccountHash,
} from '@/core/services/highlightAnnotationData';
import { StorageKeys } from '@/core/types/common';
import type {
  HighlightAccountScope,
  HighlightCreateInput,
  HighlightPlatform,
  HighlightStoredAccountScope,
  HighlightUpdatePatch,
} from '@/core/types/highlight';
import type { SyncPlatform } from '@/core/types/sync';
import {
  HighlightImportExportService,
  highlightImportExportService,
} from '@/features/backup/services/HighlightImportExportService';
import { nativeStartPointSiteForHost } from '@/features/plugins/sites/hostPolicy';

import { isTrustedExtensionPageSender } from './runtimeMessageRouting';

export function isHighlightPlatform(value: unknown): value is HighlightPlatform {
  return value === 'gemini' || value === 'aistudio';
}

function isHighlightAccountScope(value: unknown): value is HighlightAccountScope {
  if (typeof value !== 'object' || value === null) return false;
  const scope = value as Record<string, unknown>;
  return (
    isHighlightPlatform(scope.platform) &&
    typeof scope.accountKey === 'string' &&
    typeof scope.accountId === 'number' &&
    Number.isFinite(scope.accountId) &&
    (typeof scope.routeUserId === 'string' || scope.routeUserId === null)
  );
}

function isHighlightStoredAccountScope(value: unknown): value is HighlightStoredAccountScope {
  if (typeof value !== 'object' || value === null) return false;
  const scope = value as Record<string, unknown>;
  return isHighlightPlatform(scope.platform) && typeof scope.accountHash === 'string';
}

async function resolveHighlightAccountScope(
  sender: chrome.runtime.MessageSender,
  payload: Record<string, unknown> | undefined,
): Promise<HighlightAccountScope> {
  if (isHighlightAccountScope(payload?.scope)) return payload.scope;

  const pageUrl =
    (typeof payload?.pageUrl === 'string' && payload.pageUrl) ||
    (typeof payload?.conversationUrl === 'string' && payload.conversationUrl) ||
    sender.tab?.url ||
    null;
  // Highlight buckets keep their Gemini default off-platform; only folder routing is gated here.
  const platform = isHighlightPlatform(payload?.platform)
    ? payload.platform
    : (detectAccountPlatformFromUrl(pageUrl) ?? 'gemini');
  const scope = await accountIsolationService.resolveAccountScope({ pageUrl });
  return {
    platform,
    accountKey: scope.accountKey,
    accountId: scope.accountId,
    routeUserId: scope.routeUserId,
  };
}

function shouldKeepHighlightTombstones(platform: HighlightPlatform): boolean {
  // Gemini records may already exist in Drive even when the user temporarily
  // turns sync off. A compact tombstone prevents a later pull from reviving a
  // deletion. AI Studio has no highlight Drive sync, so it can hard-delete.
  return platform === 'gemini';
}

export async function isHighlightCloudSyncRequested(
  platform: SyncPlatform,
  explicitlyIncluded: boolean,
): Promise<boolean> {
  if (platform !== 'gemini') return false;
  if (explicitlyIncluded) return true;
  try {
    const stored = await chrome.storage.local.get({
      [StorageKeys.HIGHLIGHT_CLOUD_SYNC_ENABLED]: true,
    });
    return stored[StorageKeys.HIGHLIGHT_CLOUD_SYNC_ENABLED] !== false;
  } catch {
    return false;
  }
}

export async function notifyHighlightChanged(
  scope: HighlightStoredAccountScope,
  conversationId?: string,
): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({});
    const targets = tabs.filter((tab) => {
      if (typeof tab.id !== 'number' || !tab.url) return false;
      try {
        return nativeStartPointSiteForHost(new URL(tab.url).hostname) !== null;
      } catch {
        return false;
      }
    });
    await Promise.allSettled(
      targets.map((tab) =>
        chrome.tabs.sendMessage(tab.id as number, {
          type: 'gv.highlight.changed',
          payload: { ...scope, conversationId },
        }),
      ),
    );
  } catch {
    // Storage listeners and route reloads remain safe fallbacks.
  }
}

function highlightErrorResponse(error: unknown): { ok: false; error: string; code?: string } {
  if (error instanceof HighlightAnnotationError) {
    return { ok: false, error: error.message, code: error.code };
  }
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

type HighlightMessageType =
  | 'gv.highlight.listAll'
  | 'gv.highlight.list'
  | 'gv.highlight.create'
  | 'gv.highlight.update'
  | 'gv.highlight.updateStored'
  | 'gv.highlight.delete'
  | 'gv.highlight.deleteStored'
  | 'gv.highlight.export'
  | 'gv.highlight.import'
  | 'gv.highlight.clearAll'
  | 'gv.highlight.clearAllAccounts';

/**
 * Annotations stay account-scoped regardless of the legacy isolation setting.
 * Mutations notify tabs before resolving; other messages remain with the router.
 */
export function handleHighlightRuntimeMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender,
): Promise<Record<string, unknown>> | null {
  if (typeof message !== 'object' || message === null) return null;
  const { type, payload } = message as { type?: unknown; payload?: unknown };
  switch (type) {
    case 'gv.highlight.listAll':
    case 'gv.highlight.list':
    case 'gv.highlight.create':
    case 'gv.highlight.update':
    case 'gv.highlight.updateStored':
    case 'gv.highlight.delete':
    case 'gv.highlight.deleteStored':
    case 'gv.highlight.export':
    case 'gv.highlight.import':
    case 'gv.highlight.clearAll':
    case 'gv.highlight.clearAllAccounts':
      return handleHighlightMessage(type, (payload ?? {}) as Record<string, unknown>, sender);
    default:
      return null;
  }
}

async function handleHighlightMessage(
  type: HighlightMessageType,
  payload: Record<string, unknown>,
  sender: chrome.runtime.MessageSender,
): Promise<Record<string, unknown>> {
  try {
    switch (type) {
      case 'gv.highlight.listAll': {
        if (!isTrustedExtensionPageSender(sender)) {
          throw new HighlightAnnotationError(
            'INVALID_SCOPE',
            'Global highlight access is restricted to extension pages',
          );
        }
        const records = await highlightAnnotationService.getAllAccounts({
          includeDeleted: payload.includeDeleted === true,
        });
        return { ok: true, records };
      }
      case 'gv.highlight.list': {
        const scope = await resolveHighlightAccountScope(sender, payload);
        await highlightAnnotationService.claimLegacyDefaultHighlights(scope);
        const records =
          typeof payload.conversationId === 'string'
            ? await highlightAnnotationService.getConversation(scope, payload.conversationId, {
                includeDeleted: payload.includeDeleted === true,
              })
            : await highlightAnnotationService.getAll(scope, {
                includeDeleted: payload.includeDeleted === true,
              });
        return { ok: true, records };
      }
      case 'gv.highlight.create': {
        const scope = await resolveHighlightAccountScope(sender, payload);
        const input = (payload.input ?? payload) as HighlightCreateInput;
        const result = await highlightAnnotationService.add(scope, input);
        await notifyHighlightChanged(
          { platform: scope.platform, accountHash: getHighlightAccountHash(scope) },
          result.record.conversationId,
        );
        return { ok: true, ...result };
      }
      case 'gv.highlight.update': {
        if (
          typeof payload.conversationId !== 'string' ||
          typeof payload.id !== 'string' ||
          !payload.patch ||
          typeof payload.patch !== 'object'
        ) {
          throw new HighlightAnnotationError(
            'VALIDATION_FAILED',
            'Highlight update payload is invalid',
          );
        }
        const scope = await resolveHighlightAccountScope(sender, payload);
        const record = await highlightAnnotationService.update(
          scope,
          payload.conversationId,
          payload.id,
          payload.patch as HighlightUpdatePatch,
        );
        await notifyHighlightChanged(record, record.conversationId);
        return { ok: true, record };
      }
      case 'gv.highlight.updateStored': {
        if (!isTrustedExtensionPageSender(sender)) {
          throw new HighlightAnnotationError(
            'INVALID_SCOPE',
            'Stored highlight access is restricted to extension pages',
          );
        }
        if (
          !isHighlightStoredAccountScope(payload) ||
          typeof payload.conversationId !== 'string' ||
          typeof payload.id !== 'string' ||
          !payload.patch ||
          typeof payload.patch !== 'object'
        ) {
          throw new HighlightAnnotationError(
            'VALIDATION_FAILED',
            'Stored highlight update payload is invalid',
          );
        }
        const record = await highlightAnnotationService.update(
          payload,
          payload.conversationId,
          payload.id,
          payload.patch as HighlightUpdatePatch,
        );
        await notifyHighlightChanged(record, record.conversationId);
        return { ok: true, record };
      }
      case 'gv.highlight.delete': {
        if (typeof payload.conversationId !== 'string' || typeof payload.id !== 'string') {
          throw new HighlightAnnotationError(
            'VALIDATION_FAILED',
            'Highlight delete payload is invalid',
          );
        }
        const scope = await resolveHighlightAccountScope(sender, payload);
        const result = await highlightAnnotationService.remove(
          scope,
          payload.conversationId,
          payload.id,
          { tombstone: shouldKeepHighlightTombstones(scope.platform) },
        );
        await notifyHighlightChanged(
          { platform: scope.platform, accountHash: getHighlightAccountHash(scope) },
          payload.conversationId,
        );
        return { ok: true, ...result };
      }
      case 'gv.highlight.deleteStored': {
        if (!isTrustedExtensionPageSender(sender)) {
          throw new HighlightAnnotationError(
            'INVALID_SCOPE',
            'Stored highlight access is restricted to extension pages',
          );
        }
        if (
          !isHighlightStoredAccountScope(payload) ||
          typeof payload.conversationId !== 'string' ||
          typeof payload.id !== 'string'
        ) {
          throw new HighlightAnnotationError(
            'VALIDATION_FAILED',
            'Stored highlight delete payload is invalid',
          );
        }
        const result = await highlightAnnotationService.remove(
          payload,
          payload.conversationId,
          payload.id,
          { tombstone: shouldKeepHighlightTombstones(payload.platform) },
        );
        await notifyHighlightChanged(payload, payload.conversationId);
        return { ok: true, ...result };
      }
      case 'gv.highlight.export': {
        const scope = await resolveHighlightAccountScope(sender, payload);
        const format = payload.format === 'markdown' ? 'markdown' : 'json';
        const result =
          format === 'markdown'
            ? await highlightImportExportService.exportToMarkdown(scope)
            : await highlightImportExportService.exportToJSON(scope);
        if (!result.success) {
          return highlightErrorResponse(result.error);
        }
        return {
          ok: true,
          data: result.data,
          filename:
            format === 'markdown'
              ? HighlightImportExportService.generateMarkdownFilename()
              : HighlightImportExportService.generateExportFilename(),
        };
      }
      case 'gv.highlight.import': {
        const scope = await resolveHighlightAccountScope(sender, payload);
        const result = await highlightImportExportService.importFromJSON(
          scope,
          typeof payload.data === 'string' ? payload.data : '',
        );
        if (!result.success) {
          return highlightErrorResponse(result.error);
        }
        await notifyHighlightChanged({
          platform: scope.platform,
          accountHash: getHighlightAccountHash(scope),
        });
        return { ok: true, stats: result.data };
      }
      case 'gv.highlight.clearAll': {
        const scope = await resolveHighlightAccountScope(sender, payload);
        const result = await highlightAnnotationService.clearAll(scope);
        await notifyHighlightChanged({
          platform: scope.platform,
          accountHash: getHighlightAccountHash(scope),
        });
        return { ok: true, removed: result.removed };
      }
      case 'gv.highlight.clearAllAccounts': {
        if (!isTrustedExtensionPageSender(sender)) {
          throw new HighlightAnnotationError(
            'INVALID_SCOPE',
            'Global highlight cleanup is restricted to extension pages',
          );
        }
        const result = await highlightAnnotationService.clearAllAccounts();
        await Promise.allSettled(
          result.accounts.map(({ accountScope }) => notifyHighlightChanged(accountScope)),
        );
        return { ok: true, removed: result.removed };
      }
    }
  } catch (error) {
    return highlightErrorResponse(error);
  }
}
