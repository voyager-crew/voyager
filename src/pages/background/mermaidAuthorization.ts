import { startMachine } from '@/features/plugins/runtime/stateMachine';
import {
  MERMAID_TOKEN_MESSAGE,
  MERMAID_TOKEN_TTL_MS,
  type MermaidTokenIssueReply,
  type MermaidTokenRedeemReply,
  isMermaidTokenMessage,
  parseMermaidTokenMessage,
} from '@/pages/mermaidRenderer/authorization';

import {
  type MermaidPageContext,
  isCurrentMermaidPage,
  isMermaidRedeemingFrame,
  mermaidIssuingPage,
} from './mermaidAuthorizationSender';

type AuthorizedRequest = MermaidPageContext & { readonly requestId: string };
type TokenState =
  | { readonly status: 'issuing'; readonly context: AuthorizedRequest }
  | { readonly status: 'available'; readonly context: AuthorizedRequest }
  | {
      readonly status: 'redeeming';
      readonly context: AuthorizedRequest;
    }
  | { readonly status: 'finished'; readonly reply: MermaidTokenRedeemReply };
type TokenEvent =
  | { readonly type: 'issued' }
  | { readonly type: 'redeem' }
  | { readonly type: 'approved' }
  | { readonly type: 'revoke' };

function transition(state: TokenState, event: TokenEvent): TokenState {
  if (state.status === 'finished') return state;
  switch (event.type) {
    case 'revoke':
      return { status: 'finished', reply: { ok: false } };
    case 'issued':
      return state.status === 'issuing' ? { ...state, status: 'available' } : state;
    case 'redeem':
      return state.status === 'available' ? { ...state, status: 'redeeming' } : state;
    case 'approved':
      return state.status === 'redeeming'
        ? { status: 'finished', reply: { ok: true, requestId: state.context.requestId } }
        : state;
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function createToken(token: string, context: AuthorizedRequest, retire: () => void) {
  const issuedAt = Date.now();
  const fresh = () => Date.now() >= issuedAt && Date.now() - issuedAt < MERMAID_TOKEN_TTL_MS;
  const remaining = () => Math.max(0, MERMAID_TOKEN_TTL_MS - (Date.now() - issuedAt));
  let issue!: (reply: MermaidTokenIssueReply) => void;
  const issued = new Promise<MermaidTokenIssueReply>((resolve) => (issue = resolve));
  let redeem: (reply: MermaidTokenRedeemReply) => void = () => {};
  const machine = startMachine<TokenState, TokenEvent>(
    {
      id: 'mermaid-authorization',
      transition,
      effects: {
        issuing(stay) {
          stay.scope.timer(() => stay.send({ type: 'revoke' }), remaining());
          void isCurrentMermaidPage(stay.state().context).then((current) =>
            stay.send({ type: current && fresh() ? 'issued' : 'revoke' }),
          );
        },
        available(stay) {
          stay.scope.timer(() => stay.send({ type: 'revoke' }), remaining());
          issue({ ok: true, token });
        },
        redeeming(stay) {
          stay.scope.timer(() => stay.send({ type: 'revoke' }), remaining());
          void isCurrentMermaidPage(stay.state().context).then((current) =>
            stay.send({ type: current && fresh() ? 'approved' : 'revoke' }),
          );
        },
        finished(stay) {
          retire();
          issue({ ok: false });
          redeem(stay.state().reply);
        },
      },
    },
    { status: 'issuing', context },
  );
  return {
    tabId: context.tabId,
    issued,
    revoke() {
      machine.send({ type: 'revoke' });
    },
    redeem(sender: chrome.runtime.MessageSender): Promise<MermaidTokenRedeemReply> {
      const state = machine.state;
      if (
        state.status !== 'available' ||
        !fresh() ||
        !isMermaidRedeemingFrame(sender, state.context)
      ) {
        return Promise.resolve({ ok: false });
      }
      const redeemed = new Promise<MermaidTokenRedeemReply>((resolve) => (redeem = resolve));
      // Claim synchronously before browser inspection: concurrent callers cannot share a token.
      machine.send({ type: 'redeem' });
      return redeemed;
    },
  };
}

/** Ephemeral capabilities: a worker restart forgets every unconsumed token and fails closed. */
export function createMermaidAuthorization() {
  const tokens = new Map<string, ReturnType<typeof createToken>>();

  function handle(
    value: unknown,
    sender: chrome.runtime.MessageSender,
  ): Promise<MermaidTokenIssueReply | MermaidTokenRedeemReply> | null {
    if (!isMermaidTokenMessage(value)) return null;
    const message = parseMermaidTokenMessage(value);
    if (!message) return Promise.resolve({ ok: false });
    if (message.type === MERMAID_TOKEN_MESSAGE.redeem) {
      return tokens.get(message.token)?.redeem(sender) ?? Promise.resolve({ ok: false });
    }
    const page = mermaidIssuingPage(sender);
    if (!page) return Promise.resolve({ ok: false });
    const token = randomToken();
    const capability = createToken(token, { ...page, requestId: message.requestId }, () =>
      tokens.delete(token),
    );
    tokens.set(token, capability);
    return capability.issued;
  }

  function revokeTab(tabId: number): void {
    for (const capability of tokens.values()) {
      if (capability.tabId === tabId) capability.revoke();
    }
  }

  function registerListeners(): void {
    chrome.tabs.onRemoved?.addListener(revokeTab);
    chrome.tabs.onUpdated?.addListener((tabId, change) => {
      if (change.status === 'loading' || change.url) revokeTab(tabId);
    });
  }

  // No renderer frame becomes a trusted extension-page sender for any other runtime message.
  return { handle, registerListeners };
}
