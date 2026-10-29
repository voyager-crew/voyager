import { type PanelTabRequest, parsePanelTabRequest } from './tabRequests';

export { PANEL_TAB_REQUEST_TYPES, parsePanelTabRequest } from './tabRequests';
export type { PanelTabRequest } from './tabRequests';

export const PANEL_PAGE_PATH = 'src/pages/panel/index.html';
export const PANEL_TOKEN_QUERY_PARAM = 'token';
export const PANEL_TOKEN_TTL_MS = 30_000;

export const PANEL_MESSAGE = {
  tokenIssue: 'gv.panel.token.issue',
  tokenRedeem: 'gv.panel.token.redeem',
  close: 'gv.panel.close',
  contextUpdate: 'gv.panel.context.update',
  tabRequest: 'gv.panel.tab.request',
  siteAccessFallback: 'gv.panel.siteAccess.fallback',
} as const;

export type PanelToken = string & { readonly __brand: 'PanelToken' };
export type PanelSessionId = string & { readonly __brand: 'PanelSessionId' };

export function isPanelToken(value: unknown): value is PanelToken {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

export function isPanelSessionId(value: unknown): value is PanelSessionId {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

/** The shell owns this tab-scoped context; siteId is null on a custom website. */
export interface PanelContext {
  pageUrl: string;
  siteId: string | null;
  accountSlot: string | null;
  scheme: 'light' | 'dark';
  direction: 'ltr' | 'rtl';
}

export interface PanelSession {
  sessionId: PanelSessionId;
  context: PanelContext;
  hostOrigin: string;
}

export type PanelRuntimeMessage =
  | { type: typeof PANEL_MESSAGE.tokenIssue; payload: { context: PanelContext } }
  | { type: typeof PANEL_MESSAGE.tokenRedeem; payload: { token: PanelToken } }
  | { type: typeof PANEL_MESSAGE.close }
  | { type: typeof PANEL_MESSAGE.contextUpdate; payload: { context: PanelContext } }
  | {
      type: typeof PANEL_MESSAGE.tabRequest;
      payload: { sessionId: PanelSessionId; request: PanelTabRequest };
    }
  | { type: typeof PANEL_MESSAGE.siteAccessFallback; payload: { sessionId: PanelSessionId } };

export interface PanelRefusal {
  ok: false;
  error: string;
}
export type PanelTokenIssueReply = { ok: true; token: PanelToken; panelUrl: string } | PanelRefusal;
export type PanelTokenRedeemReply = { ok: true; session: PanelSession } | PanelRefusal;
export type PanelActionReply = { ok: true; fallback?: 'options' } | PanelRefusal;
/** The caller parses `response` with the requested feature's own reply parser. */
export type PanelTabRequestReply = { ok: true; response: unknown } | PanelRefusal;

export function isPanelRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function panelHostOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

function isNullableId(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.length > 0 && value.length <= 256);
}

export function parsePanelContext(value: unknown): PanelContext | null {
  if (!isPanelRecord(value) || typeof value.pageUrl !== 'string') return null;
  if (!panelHostOrigin(value.pageUrl)) return null;
  if (!isNullableId(value.siteId) || !isNullableId(value.accountSlot)) return null;
  if (value.scheme !== 'light' && value.scheme !== 'dark') return null;
  if (value.direction !== 'ltr' && value.direction !== 'rtl') return null;
  return {
    pageUrl: value.pageUrl,
    siteId: value.siteId,
    accountSlot: value.accountSlot,
    scheme: value.scheme,
    direction: value.direction,
  };
}

export function parsePanelSession(value: unknown): PanelSession | null {
  if (!isPanelRecord(value) || !isPanelSessionId(value.sessionId)) return null;
  const context = parsePanelContext(value.context);
  if (!context) return null;
  const hostOrigin = panelHostOrigin(context.pageUrl);
  if (!hostOrigin || hostOrigin !== value.hostOrigin) return null;
  return { sessionId: value.sessionId, context, hostOrigin };
}

export function isPanelRuntimeMessage(value: unknown): boolean {
  return isPanelRecord(value) && Object.values(PANEL_MESSAGE).some((type) => type === value.type);
}

export function parsePanelRuntimeMessage(value: unknown): PanelRuntimeMessage | null {
  if (!isPanelRecord(value)) return null;
  if (value.type === PANEL_MESSAGE.close) return { type: value.type };
  if (!isPanelRecord(value.payload)) return null;
  const payload = value.payload;
  switch (value.type) {
    case PANEL_MESSAGE.tokenIssue:
    case PANEL_MESSAGE.contextUpdate: {
      const context = parsePanelContext(payload.context);
      return context ? { type: value.type, payload: { context } } : null;
    }
    case PANEL_MESSAGE.tokenRedeem:
      return isPanelToken(payload.token)
        ? { type: value.type, payload: { token: payload.token } }
        : null;
    case PANEL_MESSAGE.tabRequest: {
      const request = parsePanelTabRequest(payload.request);
      return request && isPanelSessionId(payload.sessionId)
        ? { type: value.type, payload: { sessionId: payload.sessionId, request } }
        : null;
    }
    case PANEL_MESSAGE.siteAccessFallback:
      return isPanelSessionId(payload.sessionId)
        ? { type: value.type, payload: { sessionId: payload.sessionId } }
        : null;
    default:
      return null;
  }
}

function parseRefusal(value: Record<string, unknown>): PanelRefusal | null {
  return value.ok === false && typeof value.error === 'string'
    ? { ok: false, error: value.error }
    : null;
}

export function parsePanelTokenIssueReply(value: unknown): PanelTokenIssueReply | null {
  if (!isPanelRecord(value)) return null;
  if (value.ok !== true) return parseRefusal(value);
  return isPanelToken(value.token) && typeof value.panelUrl === 'string'
    ? { ok: true, token: value.token, panelUrl: value.panelUrl }
    : null;
}

export function parsePanelTokenRedeemReply(value: unknown): PanelTokenRedeemReply | null {
  if (!isPanelRecord(value)) return null;
  if (value.ok !== true) return parseRefusal(value);
  const session = parsePanelSession(value.session);
  return session ? { ok: true, session } : null;
}

export function parsePanelActionReply(value: unknown): PanelActionReply | null {
  if (!isPanelRecord(value)) return null;
  if (value.ok !== true) return parseRefusal(value);
  if (value.fallback !== undefined && value.fallback !== 'options') return null;
  return value.fallback === 'options' ? { ok: true, fallback: 'options' } : { ok: true };
}

export function parsePanelTabRequestReply(value: unknown): PanelTabRequestReply | null {
  if (!isPanelRecord(value)) return null;
  return value.ok === true ? { ok: true, response: value.response } : parseRefusal(value);
}

export const PANEL_PORT_NAME = 'gv.panel.context';
export const PANEL_PORT_MESSAGE = {
  connect: 'gv.panel.port.connect',
  context: 'gv.panel.port.context',
} as const;
export interface PanelPortConnectMessage {
  type: typeof PANEL_PORT_MESSAGE.connect;
  payload: { sessionId: PanelSessionId };
}
export interface PanelPortContextMessage {
  type: typeof PANEL_PORT_MESSAGE.context;
  payload: { sessionId: PanelSessionId; context: PanelContext };
}

export function parsePanelPortConnectMessage(value: unknown): PanelPortConnectMessage | null {
  if (
    !isPanelRecord(value) ||
    value.type !== PANEL_PORT_MESSAGE.connect ||
    !isPanelRecord(value.payload) ||
    !isPanelSessionId(value.payload.sessionId)
  )
    return null;
  return { type: value.type, payload: { sessionId: value.payload.sessionId } };
}

export function parsePanelPortContextMessage(value: unknown): PanelPortContextMessage | null {
  if (
    !isPanelRecord(value) ||
    value.type !== PANEL_PORT_MESSAGE.context ||
    !isPanelRecord(value.payload) ||
    !isPanelSessionId(value.payload.sessionId)
  )
    return null;
  const context = parsePanelContext(value.payload.context);
  return context
    ? { type: value.type, payload: { sessionId: value.payload.sessionId, context } }
    : null;
}

/** Popup/options removes this session value before opening the named card (one shot). */
export const PANEL_POPUP_OPEN_CARD_KEY = 'gvPopupOpenCard';
export const PANEL_SITE_ACCESS_CARD = 'site-access';
export function parsePanelPopupCard(value: unknown): typeof PANEL_SITE_ACCESS_CARD | null {
  return value === PANEL_SITE_ACCESS_CARD ? value : null;
}

export const PANEL_SHELL_MESSAGE = {
  preview: 'gv.panel.preview.value',
  previewEnd: 'gv.panel.preview.end',
  dragStart: 'gv.panel.drag.start',
  dragMove: 'gv.panel.drag.move',
  dragEnd: 'gv.panel.drag.end',
  recenter: 'gv.panel.recenter',
  fade: 'gv.panel.fade',
  close: 'gv.panel.close',
  focusReturn: 'gv.panel.focus.return',
} as const;
type DragKind =
  | typeof PANEL_SHELL_MESSAGE.dragStart
  | typeof PANEL_SHELL_MESSAGE.dragMove
  | typeof PANEL_SHELL_MESSAGE.dragEnd;
export type PanelSettingValue = string | number | boolean;
export type PanelShellMessage =
  | {
      kind: typeof PANEL_SHELL_MESSAGE.preview;
      pluginId: string;
      settingKey: string;
      value: PanelSettingValue;
    }
  // Cumulative screen-coordinate deltas since pointerdown; dragStart sends zeroes.
  | { kind: DragKind; deltaX: number; deltaY: number }
  | { kind: typeof PANEL_SHELL_MESSAGE.fade; faded: boolean }
  | {
      kind:
        | typeof PANEL_SHELL_MESSAGE.previewEnd
        | typeof PANEL_SHELL_MESSAGE.recenter
        | typeof PANEL_SHELL_MESSAGE.close
        | typeof PANEL_SHELL_MESSAGE.focusReturn;
    };

/** The shell must ALSO check event.source === iframe.contentWindow and the extension origin. */
export function parsePanelShellMessage(value: unknown): PanelShellMessage | null {
  if (!isPanelRecord(value)) return null;
  switch (value.kind) {
    case PANEL_SHELL_MESSAGE.preview:
      if (
        typeof value.pluginId !== 'string' ||
        !value.pluginId ||
        typeof value.settingKey !== 'string' ||
        !value.settingKey ||
        !(
          typeof value.value === 'string' ||
          typeof value.value === 'boolean' ||
          (typeof value.value === 'number' && Number.isFinite(value.value))
        )
      )
        return null;
      return {
        kind: value.kind,
        pluginId: value.pluginId,
        settingKey: value.settingKey,
        value: value.value,
      };
    case PANEL_SHELL_MESSAGE.dragStart:
    case PANEL_SHELL_MESSAGE.dragMove:
    case PANEL_SHELL_MESSAGE.dragEnd:
      return typeof value.deltaX === 'number' &&
        Number.isFinite(value.deltaX) &&
        typeof value.deltaY === 'number' &&
        Number.isFinite(value.deltaY)
        ? { kind: value.kind, deltaX: value.deltaX, deltaY: value.deltaY }
        : null;
    case PANEL_SHELL_MESSAGE.fade:
      return typeof value.faded === 'boolean' ? { kind: value.kind, faded: value.faded } : null;
    case PANEL_SHELL_MESSAGE.previewEnd:
    case PANEL_SHELL_MESSAGE.recenter:
    case PANEL_SHELL_MESSAGE.close:
    case PANEL_SHELL_MESSAGE.focusReturn:
      return { kind: value.kind };
    default:
      return null;
  }
}
