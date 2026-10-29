import { logger } from '@/core/services/LoggerService';
import {
  PANEL_MESSAGE,
  PANEL_PAGE_PATH,
  PANEL_POPUP_OPEN_CARD_KEY,
  PANEL_PORT_NAME,
  PANEL_SITE_ACCESS_CARD,
  PANEL_TOKEN_QUERY_PARAM,
  PANEL_TOKEN_TTL_MS,
  type PanelActionReply,
  type PanelRefusal,
  type PanelRuntimeMessage,
  type PanelSessionId,
  type PanelTabRequestReply,
  type PanelTokenIssueReply,
  type PanelTokenRedeemReply,
  isPanelRuntimeMessage,
  isPanelSessionId,
  isPanelToken,
  panelHostOrigin,
  parsePanelActionReply,
  parsePanelRuntimeMessage,
} from '@/features/panel/protocol';

import { handlePageRuntimeMessage } from './pageRuntimeMessages';
import { panelContextMessage, startPanelPort } from './panelPorts';
import { startPanelRelay } from './panelRelay';
import {
  PANEL_STATE_SESSION_KEY,
  type PanelFrameRecord,
  type PanelState,
  isPanelPageUrl,
  isPanelTabId,
  matchesPanelFrame,
  panelSessionArea,
  panelTabHasOrigin,
  readPanelState,
} from './panelStorage';

export { isRegisteredPanelFrame } from './panelStorage';

type PanelCapabilityRequest = Extract<
  PanelRuntimeMessage,
  { type: typeof PANEL_MESSAGE.tabRequest | typeof PANEL_MESSAGE.siteAccessFallback }
>;

function refuse(error: string): PanelRefusal {
  return { ok: false, error };
}

function randomSecret(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function shellOrigin(sender: chrome.runtime.MessageSender): string | null {
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !isPanelTabId(sender.tab?.id))
    return null;
  const origin = panelHostOrigin(sender.url);
  return origin && (!sender.tab.url || panelHostOrigin(sender.tab.url) === origin) ? origin : null;
}

/** One background owner serializes persisted read/modify/write operations for every tab. */
export function createPanelBackground() {
  const area = panelSessionArea();
  let chain: Promise<unknown> = Promise.resolve();
  const ports = new Map<
    number,
    { sessionId: PanelSessionId; port: chrome.runtime.Port; close(): void }
  >();
  const relays = new Set<{ tabId: number; origin: string | null; revoke(): void }>();

  function revokeRelays(tabId: number, nextUrl?: string): void {
    const nextOrigin = panelHostOrigin(nextUrl);
    for (const relay of relays) {
      if (
        relay.tabId === tabId &&
        (nextUrl === undefined || !relay.origin || relay.origin !== nextOrigin)
      )
        relay.revoke();
    }
  }

  function serial<T>(work: (state: PanelState) => Promise<T>): Promise<T> {
    const run = chain.then(async () => {
      if (!area) throw new Error('session_unavailable');
      const state = await readPanelState(area);
      const now = Date.now();
      state.tokens = state.tokens.filter(
        (token) => now >= token.issuedAt && now - token.issuedAt < PANEL_TOKEN_TTL_MS,
      );
      const result = await work(state);
      if (state.tokens.length || state.frames.length)
        await area.set({ [PANEL_STATE_SESSION_KEY]: state });
      else await area.remove(PANEL_STATE_SESSION_KEY);
      return result;
    });
    chain = run.catch(() => undefined);
    return run;
  }

  function revoke(state: PanelState, tabId: number): void {
    revokeRelays(tabId);
    state.tokens = state.tokens.filter((token) => token.tabId !== tabId);
    state.frames = state.frames.filter((frame) => frame.tabId !== tabId);
    ports.get(tabId)?.close();
  }

  async function registeredFrame(
    state: PanelState,
    sender: chrome.runtime.MessageSender,
    sessionId: PanelSessionId,
  ): Promise<PanelFrameRecord | null> {
    const frame = state.frames.find(
      (frame) => frame.sessionId === sessionId && matchesPanelFrame(sender, frame),
    );
    return frame && (await panelTabHasOrigin(frame.tabId, frame.hostOrigin)) ? frame : null;
  }

  async function handleParsed(
    message: Exclude<PanelRuntimeMessage, PanelCapabilityRequest>,
    sender: chrome.runtime.MessageSender,
    state: PanelState,
  ): Promise<PanelTokenIssueReply | PanelTokenRedeemReply | PanelActionReply> {
    switch (message.type) {
      case PANEL_MESSAGE.tokenIssue: {
        const origin = shellOrigin(sender);
        const tabId = sender.tab?.id;
        const { context } = message.payload;
        if (
          !origin ||
          !isPanelTabId(tabId) ||
          panelHostOrigin(context.pageUrl) !== origin ||
          !(await panelTabHasOrigin(tabId, origin))
        )
          return refuse('sender_not_allowed');
        const token = randomSecret();
        if (!isPanelToken(token)) return refuse('token_unavailable');
        revoke(state, tabId);
        state.tokens.push({
          token,
          tabId,
          context,
          issuedAt: Date.now(),
          hostDocumentId: sender.documentId ?? null,
        });
        const url = new URL(chrome.runtime.getURL(PANEL_PAGE_PATH));
        url.searchParams.set(PANEL_TOKEN_QUERY_PARAM, token);
        return { ok: true, token, panelUrl: url.href };
      }
      case PANEL_MESSAGE.tokenRedeem: {
        const { token } = message.payload;
        const record = state.tokens.find((record) => record.token === token);
        const tabId = sender.tab?.id;
        if (
          !record ||
          sender.id !== chrome.runtime.id ||
          tabId !== record.tabId ||
          !isPanelTabId(sender.frameId) ||
          sender.frameId === 0 ||
          !isPanelPageUrl(sender.url, token)
        )
          return refuse('token_refused');
        const hostOrigin = panelHostOrigin(record.context.pageUrl);
        if (
          !hostOrigin ||
          (sender.tab?.url && panelHostOrigin(sender.tab.url) !== hostOrigin) ||
          !(await panelTabHasOrigin(record.tabId, hostOrigin))
        )
          return refuse('token_refused');
        // Permission/tab inspection can be delayed; the token must still be fresh at consumption.
        const age = Date.now() - record.issuedAt;
        if (age < 0 || age >= PANEL_TOKEN_TTL_MS) return refuse('token_refused');
        const sessionId = randomSecret();
        if (!isPanelSessionId(sessionId)) return refuse('session_unavailable');
        revoke(state, record.tabId);
        const frame: PanelFrameRecord = {
          tabId: record.tabId,
          frameId: sender.frameId,
          documentId: sender.documentId ?? null,
          hostDocumentId: record.hostDocumentId,
          sessionId,
          context: record.context,
          hostOrigin,
        };
        state.frames.push(frame);
        return { ok: true, session: { sessionId, context: frame.context, hostOrigin } };
      }
      case PANEL_MESSAGE.close: {
        const origin = shellOrigin(sender);
        const tabId = sender.tab?.id;
        if (!origin || !isPanelTabId(tabId)) return refuse('sender_not_allowed');
        revoke(state, tabId);
        return { ok: true };
      }
      case PANEL_MESSAGE.contextUpdate: {
        const origin = shellOrigin(sender);
        const tabId = sender.tab?.id;
        const { context } = message.payload;
        if (
          !origin ||
          !isPanelTabId(tabId) ||
          panelHostOrigin(context.pageUrl) !== origin ||
          !(await panelTabHasOrigin(tabId, origin))
        )
          return refuse('sender_not_allowed');
        const frame = state.frames.find(
          (frame) => frame.tabId === tabId && frame.hostOrigin === origin,
        );
        for (const token of state.tokens)
          if (token.tabId === tabId && panelHostOrigin(token.context.pageUrl) === origin)
            token.context = context;
        if (frame) {
          frame.context = context;
          const connection = ports.get(tabId);
          if (connection?.sessionId === frame.sessionId) {
            try {
              connection.port.postMessage(panelContextMessage(frame));
            } catch {
              connection.close();
            }
          }
        }
        return { ok: true };
      }
      default: {
        const exhaustive: never = message;
        return exhaustive;
      }
    }
  }

  async function handleCapability(
    message: PanelCapabilityRequest,
    sender: chrome.runtime.MessageSender,
  ): Promise<PanelTabRequestReply | PanelActionReply> {
    if (!area) return refuse('session_unavailable');
    if (message.type === PANEL_MESSAGE.tabRequest) {
      const tabId = sender.tab?.id;
      if (!isPanelTabId(tabId)) return refuse('sender_not_allowed');
      // Only authentication holds the registry lock; network replies must never block revocation.
      const relay = startPanelRelay({
        request: message.payload.request,
        authorize: () =>
          serial((state) => registeredFrame(state, sender, message.payload.sessionId)),
        async isCurrent(frame) {
          // No storage write follows this check. In browsers without documentId, re-read both
          // the registration and current origin immediately before the send effect runs.
          const latest = await readPanelState(area);
          const tab = await chrome.tabs.get(frame.tabId);
          return (
            latest.frames.some(
              (current) =>
                current.sessionId === frame.sessionId && matchesPanelFrame(sender, current),
            ) && panelHostOrigin(tab.url) === frame.hostOrigin
          );
        },
      });
      const pending = { tabId, origin: panelHostOrigin(sender.tab?.url), revoke: relay.revoke };
      relays.add(pending);
      try {
        return await relay.result;
      } finally {
        relays.delete(pending);
      }
    }
    const frame = await serial((state) =>
      registeredFrame(state, sender, message.payload.sessionId),
    );
    if (!frame) return refuse('sender_not_allowed');
    // Popup opening also stays outside the registry lock.
    await area.set({ [PANEL_POPUP_OPEN_CARD_KEY]: PANEL_SITE_ACCESS_CARD });
    const opening = handlePageRuntimeMessage({ type: 'gv.openPopup' }, sender);
    return opening
      ? (parsePanelActionReply(await opening) ?? refuse('popup_unavailable'))
      : refuse('popup_unavailable');
  }

  function handle(value: unknown, sender: chrome.runtime.MessageSender): Promise<unknown> | null {
    if (!isPanelRuntimeMessage(value)) return null;
    const message = parsePanelRuntimeMessage(value);
    if (!message) return Promise.resolve(refuse('invalid_message'));
    if (message.type === PANEL_MESSAGE.close && shellOrigin(sender) && isPanelTabId(sender.tab?.id))
      revokeRelays(sender.tab.id);
    if (
      message.type === PANEL_MESSAGE.tabRequest ||
      message.type === PANEL_MESSAGE.siteAccessFallback
    )
      return handleCapability(message, sender);
    return serial((state) => handleParsed(message, sender, state));
  }

  function registerListeners(): void {
    chrome.runtime.onConnect?.addListener((port) => {
      if (port.name !== PANEL_PORT_NAME) return;
      const sender = port.sender;
      if (!sender) {
        port.disconnect();
        return;
      }
      startPanelPort(port, {
        authenticate: (sessionId) => serial((state) => registeredFrame(state, sender, sessionId)),
        connected(frame, close) {
          ports.get(frame.tabId)?.close();
          const connection = { sessionId: frame.sessionId, port, close };
          ports.set(frame.tabId, connection);
          return () => {
            if (ports.get(frame.tabId) === connection) ports.delete(frame.tabId);
          };
        },
      });
    });
    if (!area) return;
    const discard = (tabId: number, nextUrl?: string) => {
      // Retire in-flight effects now; persisted revocation may be waiting behind a storage write.
      revokeRelays(tabId, nextUrl);
      void serial(async (state) => {
        const nextOrigin = nextUrl === undefined ? null : panelHostOrigin(nextUrl);
        const changed =
          state.tokens.some(
            (token) =>
              token.tabId === tabId && panelHostOrigin(token.context.pageUrl) !== nextOrigin,
          ) ||
          state.frames.some((frame) => frame.tabId === tabId && frame.hostOrigin !== nextOrigin);
        if (nextUrl === undefined || changed) revoke(state, tabId);
      }).catch((error: unknown) =>
        logger.warn('Panel session cleanup failed', { error: String(error) }),
      );
    };
    chrome.tabs.onRemoved?.addListener((tabId) => discard(tabId));
    chrome.tabs.onUpdated?.addListener((tabId, change) => {
      if (change.status === 'loading') discard(tabId);
      else if (change.url) discard(tabId, change.url);
    });
  }

  return { handle, registerListeners };
}
