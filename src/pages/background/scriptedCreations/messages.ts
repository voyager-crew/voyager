/**
 * Background side of the `gv.scripted.*` runtime messages. `loaded` must come
 * from this extension's content script in a tab's top frame, since the tab id
 * it confirms is the sender's own; the rest also accept extension pages. A
 * user script cannot pass for either: every world it runs in has messaging
 * off, and its messages would reach `runtime.onUserScriptMessage` anyway.
 */
import {
  SCRIPTED_MESSAGE,
  type ScriptedStatus,
  isScriptedMessageType,
  parseScriptedMessage,
} from '@/features/plugins/scripted/messages';

import { isTrustedExtensionPageSender } from '../runtimeMessageRouting';

export interface ScriptedMessageDeps {
  status(): Promise<ScriptedStatus>;
  recheck(): Promise<ScriptedStatus>;
  confirmLoad(tabId: number, url: string): Promise<void>;
  clearNotice(id: string): Promise<boolean>;
  openDetails(): Promise<void>;
}

const INVALID_PAYLOAD = { ok: false, error: 'invalid_payload' } as const;
const UNTRUSTED_SENDER = { ok: false, error: 'untrusted_sender' } as const;
const WRITE_FAILED = { ok: false, error: 'write_failed' } as const;

interface PageSender {
  readonly tabId: number;
  readonly url: string;
}

/** This extension's content script in a tab's top frame, on an https page. */
export function contentScriptSender(sender: chrome.runtime.MessageSender): PageSender | undefined {
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0) return undefined;
  const tabId = sender.tab?.id;
  const url = sender.tab?.url ?? sender.url;
  if (tabId === undefined || tabId < 0 || !url?.startsWith('https://')) return undefined;
  return { tabId, url };
}

function isScriptedSender(sender: chrome.runtime.MessageSender): boolean {
  return isTrustedExtensionPageSender(sender) || contentScriptSender(sender) !== undefined;
}

/** Null for a message that is not ours, so the caller keeps routing it. */
export function handleScriptedMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender,
  deps: ScriptedMessageDeps,
): Promise<unknown> | null {
  if (!isScriptedMessageType(message)) return null;
  const parsed = parseScriptedMessage(message);
  if (!parsed) return Promise.resolve(INVALID_PAYLOAD);
  if (parsed.type === SCRIPTED_MESSAGE.loaded) {
    const page = contentScriptSender(sender);
    if (!page) return Promise.resolve(UNTRUSTED_SENDER);
    return deps.confirmLoad(page.tabId, page.url).then(() => ({ ok: true }));
  }
  if (!isScriptedSender(sender)) return Promise.resolve(UNTRUSTED_SENDER);
  switch (parsed.type) {
    case SCRIPTED_MESSAGE.status:
      return deps.status();
    case SCRIPTED_MESSAGE.recheck:
      return deps.recheck();
    case SCRIPTED_MESSAGE.clearNotice:
      return deps
        .clearNotice(parsed.payload.id)
        .then((cleared) => (cleared ? { ok: true } : WRITE_FAILED));
    case SCRIPTED_MESSAGE.openDetails:
      return deps.openDetails().then(() => ({ ok: true }));
    default: {
      const _exhaustive: never = parsed;
      return _exhaustive;
    }
  }
}
