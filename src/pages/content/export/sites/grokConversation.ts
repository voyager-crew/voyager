/**
 * Grok's export read. The conversation endpoint is tried first; every other
 * catalog site, and Grok when that read fails, uses the DOM reader configured
 * in `site.json`. Branch selection lives in `grokBranch.ts` and the request in
 * `grokConversationEndpoint.ts`.
 */
import { logger } from '@/core/services/LoggerService';
import type { ExtractedContent } from '@/features/export/services/DOMContentExtractor';
import grokSite from '@/features/plugins/catalog/sites/grok/site.json';
import type { SiteAdapter } from '@/features/plugins/types';

import type { ExportPlatformAdapter } from '../adapter/platformAdapters';
import type { ExportSelectionOptions } from '../adapter/type';
import { isAbortError, throwIfExportCancelled } from '../exportCancellation';
import {
  type CatalogReadResult,
  type CatalogSnapshot,
  readCatalogConversation,
  snapshotFingerprint,
} from './catalogReader';
import { type GrokBranch, grokConversationId, grokDisplayedLeafId } from './grokBranch';
import { GrokApiMiss, fetchGrokBranch } from './grokConversationEndpoint';
import { embedYouTubeLinks } from './grokMessageMarkdown';

const REQUEST_TIMEOUT_MS = 20_000;
const GROK_ORIGIN = 'https://grok.com';

export interface GrokReadDeps {
  readonly fetch?: typeof fetch;
  readonly readDom?: typeof readCatalogConversation;
  readonly timeoutMs?: number;
}

function snapshotsFor(messageKey: string, branch: GrokBranch): CatalogSnapshot[] {
  return branch.messages.map((message) => {
    const nativeId = `${messageKey}:gateway:${message.id}`;
    const element = document.createElement('div');
    element.textContent = message.text;
    const content: ExtractedContent = {
      text: message.text,
      html: '',
      attachments: [],
      hasImages: message.text.includes('!['),
      hasFormulas: false,
      hasTables: false,
      hasCode: message.text.includes('```'),
    };
    return {
      id: nativeId,
      nativeId,
      role: message.role,
      content,
      text: message.text,
      element,
      host: new WeakRef(element),
      fingerprint: snapshotFingerprint(message.role, content),
    };
  });
}

function sameRoute(expected: string, page: string): boolean {
  const left = new URL(expected);
  const right = new URL(page);
  return (
    left.origin === right.origin && left.pathname === right.pathname && left.search === right.search
  );
}

/** Page text has no card payload; a bare YouTube URL still becomes a cover. */
function decorateGrokDom(result: CatalogReadResult): CatalogReadResult {
  let changed = false;
  const snapshots = result.snapshots.map((snapshot) => {
    const text = embedYouTubeLinks(snapshot.text);
    if (text === snapshot.text) return snapshot;
    changed = true;
    return {
      ...snapshot,
      text,
      content: {
        ...snapshot.content,
        text,
        hasImages: snapshot.content.hasImages || text.includes('!['),
      },
    };
  });
  return changed ? { ...result, snapshots } : result;
}

function logGrokExportRead(source: 'endpoint' | 'virtual-dom', count: number): void {
  // `vite build` leaves DEV false and the logger at WARN; the chrome dev build sets the bridge flag.
  if (!import.meta.env.DEV && !import.meta.env.VOYAGER_DEV_SETTINGS_BRIDGE) return;
  const via = source === 'endpoint' ? 'endpoint' : 'virtual DOM';
  // oxlint-disable-next-line no-console -- dev builds only
  console.info(`Grok export read via ${via}`, { source, count });
}

/** This reader belongs to the bundled Grok adapter, not every catalog site. */
function isGrokAdapter(site: SiteAdapter): boolean {
  return site.id === grokSite.id;
}

function canReadGrokApi(site: SiteAdapter, expectedUrl: string | undefined): boolean {
  if (!isGrokAdapter(site) || location.origin !== GROK_ORIGIN) return false;
  if (!expectedUrl) return true;
  try {
    return sameRoute(expectedUrl, location.href);
  } catch {
    return false;
  }
}

export async function readCatalogOrGrokConversation(
  site: SiteAdapter,
  adapter: ExportPlatformAdapter,
  options: ExportSelectionOptions,
  deps: GrokReadDeps = {},
): Promise<CatalogReadResult> {
  const readDom = deps.readDom ?? readCatalogConversation;
  const readPage = async (): Promise<CatalogReadResult> => {
    const result = await readDom(site, adapter, options);
    if (!isGrokAdapter(site)) return result;
    const decorated = decorateGrokDom(result);
    logGrokExportRead('virtual-dom', decorated.snapshots.length);
    return decorated;
  };
  if (!canReadGrokApi(site, options.expectedUrl)) return readPage();
  const pattern = site.conversationIdPattern;
  const conversationId = pattern ? grokConversationId(location.href, pattern) : null;
  if (!conversationId) return readPage();
  const messageKey = site.export?.messageKey;
  if (!messageKey) return readPage();
  try {
    const branch = await fetchGrokBranch(
      conversationId,
      grokDisplayedLeafId(location.href),
      options.signal,
      deps.timeoutMs ?? REQUEST_TIMEOUT_MS,
      deps.fetch ?? ((input, init) => globalThis.fetch(input, init)),
    );
    const snapshots = snapshotsFor(messageKey, branch);
    logGrokExportRead('endpoint', snapshots.length);
    return {
      snapshots,
      completeness: branch.partial ? 'unknown' : 'complete',
    };
  } catch (error) {
    if (isAbortError(error)) throw error;
    logger.warn('Grok conversation endpoint was not used', {
      reason: error instanceof GrokApiMiss ? error.reason : 'error',
    });
    throwIfExportCancelled(options.signal);
    return readPage();
  }
}
