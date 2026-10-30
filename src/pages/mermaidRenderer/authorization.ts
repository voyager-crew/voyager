export const MERMAID_TOKEN_MESSAGE = {
  issue: 'gv.mermaid.tokenIssue',
  redeem: 'gv.mermaid.tokenRedeem',
} as const;

export const MERMAID_TOKEN_TTL_MS = 30_000;

type MermaidTokenRefusal = { readonly ok: false };
export type MermaidTokenIssueReply =
  | { readonly ok: true; readonly token: string }
  | MermaidTokenRefusal;
export type MermaidTokenRedeemReply =
  | { readonly ok: true; readonly requestId: string }
  | MermaidTokenRefusal;

export type MermaidTokenMessage =
  | { readonly type: typeof MERMAID_TOKEN_MESSAGE.issue; readonly requestId: string }
  | { readonly type: typeof MERMAID_TOKEN_MESSAGE.redeem; readonly token: string };

export function isMermaidRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^mermaid-[a-z0-9-]+$/i.test(value);
}

function isMermaidToken(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

/** Recognizes the family only; the boundary parser validates its payload. */
export function isMermaidTokenMessage(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    (value.type === MERMAID_TOKEN_MESSAGE.issue || value.type === MERMAID_TOKEN_MESSAGE.redeem)
  );
}

export function parseMermaidTokenMessage(value: unknown): MermaidTokenMessage | null {
  if (typeof value !== 'object' || value === null || !('type' in value)) return null;
  if (
    value.type === MERMAID_TOKEN_MESSAGE.issue &&
    'requestId' in value &&
    isMermaidRequestId(value.requestId)
  ) {
    return { type: value.type, requestId: value.requestId };
  }
  if (
    value.type === MERMAID_TOKEN_MESSAGE.redeem &&
    'token' in value &&
    isMermaidToken(value.token)
  ) {
    return { type: value.type, token: value.token };
  }
  return null;
}

export function parseMermaidTokenIssueReply(value: unknown): MermaidTokenIssueReply | null {
  if (typeof value !== 'object' || value === null || !('ok' in value)) return null;
  if (value.ok === false) return { ok: false };
  return value.ok === true && 'token' in value && isMermaidToken(value.token)
    ? { ok: true, token: value.token }
    : null;
}

export function parseMermaidTokenRedeemReply(value: unknown): MermaidTokenRedeemReply | null {
  if (typeof value !== 'object' || value === null || !('ok' in value)) return null;
  if (value.ok === false) return { ok: false };
  return value.ok === true && 'requestId' in value && isMermaidRequestId(value.requestId)
    ? { ok: true, requestId: value.requestId }
    : null;
}
