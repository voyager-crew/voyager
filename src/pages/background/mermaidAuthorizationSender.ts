import { MERMAID_RENDERER_PATH } from '@/pages/mermaidRenderer/protocol';

export interface MermaidPageContext {
  readonly tabId: number;
  readonly pageUrl: string;
}

function isFrameId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function hostPage(value: unknown): URL | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
      ? url
      : null;
  } catch {
    return null;
  }
}

/** All custom sites still need their existing host permission; WAR grants no authority. */
export async function isCurrentMermaidPage(context: MermaidPageContext): Promise<boolean> {
  try {
    const expected = new URL(context.pageUrl);
    if (
      !(await chrome.permissions.contains({
        origins: [`${expected.protocol}//${expected.hostname}/*`],
      }))
    ) {
      return false;
    }
    // Read the live URL after permission inspection, including /u/<account>/ routes.
    const tab = await chrome.tabs.get(context.tabId);
    return hostPage(tab.url)?.href === context.pageUrl;
  } catch {
    return false;
  }
}

export function mermaidIssuingPage(
  sender: chrome.runtime.MessageSender,
): MermaidPageContext | null {
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !isFrameId(sender.tab?.id)) {
    return null;
  }
  const page = hostPage(sender.url);
  if (!page || (sender.tab.url && hostPage(sender.tab.url)?.href !== page.href)) return null;
  return { tabId: sender.tab.id, pageUrl: page.href };
}

export function isMermaidRedeemingFrame(
  sender: chrome.runtime.MessageSender,
  context: MermaidPageContext,
): boolean {
  if (
    sender.id !== chrome.runtime.id ||
    sender.tab?.id !== context.tabId ||
    !isFrameId(sender.frameId) ||
    sender.frameId === 0 ||
    typeof sender.url !== 'string'
  ) {
    return false;
  }
  try {
    // No hash/query is an authority channel, even on the correct extension page.
    const page = new URL(sender.url);
    const expected = new URL(chrome.runtime.getURL(MERMAID_RENDERER_PATH));
    return (
      page.href === expected.href &&
      (!sender.tab.url || hostPage(sender.tab.url)?.href === context.pageUrl)
    );
  } catch {
    return false;
  }
}
