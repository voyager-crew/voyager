import {
  GEMINI_SELECTOR_REFRESH_MESSAGE,
  GEMINI_SELECTOR_SET_ENABLED_MESSAGE,
  GEMINI_SELECTOR_STATUS_MESSAGE,
  type GeminiSelectorResponse,
} from '@/features/geminiSelectorFixes/messages';
/**
 * The popup's view of the Gemini selector channel for one source tab, as
 * explicit state for `startMachine`. The background owns consent and requests.
 *
 *   loading ─loaded─▶ idle | checking            (checks once when consent is on)
 *   idle ─checkNow─▶ checking ─checked─▶ idle
 *   idle | checking ─setEnabled─▶ saving ─saved─▶ idle | checking
 *   any ─consentChanged─▶ loading                 (except our own save's echo)
 *
 * Leaving a status drops its pending reply: a check that answers after the
 * switch was turned off, or a save that another popup's change superseded,
 * cannot overwrite the newer state.
 */
import type { MachineDefinition } from '@/features/plugins/runtime/stateMachine';

export type ChannelStatus = Extract<GeminiSelectorResponse, { ok: true }>;

interface FixesView {
  readonly channel: ChannelStatus | null;
  readonly error: 'check' | 'save' | null;
}

export type FixesState =
  | ({ readonly status: 'loading'; readonly checkAfter: boolean } & FixesView)
  | ({ readonly status: 'idle' } & FixesView)
  | ({ readonly status: 'checking'; readonly force: boolean } & FixesView)
  | ({ readonly status: 'saving'; readonly enabled: boolean } & FixesView);

type Reply = GeminiSelectorResponse | null;

export type FixesEvent =
  /** Storage reports a consent change, from this popup or any other page. */
  | { readonly type: 'consentChanged'; readonly enabled: boolean }
  | { readonly type: 'loaded'; readonly response: Reply }
  | { readonly type: 'checkNow' }
  | { readonly type: 'checked'; readonly response: Reply }
  | { readonly type: 'setEnabled'; readonly enabled: boolean }
  | { readonly type: 'saved'; readonly response: Reply; readonly reconciled: Reply };

export const INITIAL_FIXES_STATE: FixesState = {
  status: 'loading',
  checkAfter: true,
  channel: null,
  error: null,
};

/** `onGemini`: the popup has a verified Gemini source tab, needed to turn on and to check. */
export function geminiSelectorFixesTransition(onGemini: boolean) {
  const canCheck = (channel: ChannelStatus | null) =>
    onGemini && channel?.enabled === true && channel.buildEnabled;

  return (state: FixesState, event: FixesEvent): FixesState => {
    switch (event.type) {
      case 'consentChanged': {
        const channel = state.channel && {
          ...state.channel,
          enabled: event.enabled,
          cachedRevision: event.enabled ? state.channel.cachedRevision : null,
        };
        // Our own writer still has to finish cache deletion; the consent event alone is not its ack.
        if (state.status === 'saving' && state.enabled === event.enabled) {
          return { ...state, channel };
        }
        // A second popup can turn the channel off during a check; re-read instead of trusting it.
        return { status: 'loading', checkAfter: event.enabled, channel, error: null };
      }
      case 'loaded': {
        if (state.status !== 'loading') return state;
        if (!event.response?.ok) return { status: 'idle', channel: state.channel, error: 'check' };
        const channel = event.response;
        return state.checkAfter && canCheck(channel)
          ? { status: 'checking', force: false, channel, error: null }
          : { status: 'idle', channel, error: null };
      }
      case 'checkNow':
        return state.status === 'idle' && canCheck(state.channel)
          ? { status: 'checking', force: true, channel: state.channel, error: null }
          : state;
      case 'checked':
        if (state.status !== 'checking') return state;
        return event.response?.ok
          ? { status: 'idle', channel: event.response, error: null }
          : { status: 'idle', channel: state.channel, error: 'check' };
      case 'setEnabled':
        if (
          (state.status !== 'idle' && state.status !== 'checking') ||
          !state.channel?.buildEnabled ||
          (event.enabled && !onGemini)
        ) {
          return state;
        }
        return { status: 'saving', enabled: event.enabled, channel: state.channel, error: null };
      case 'saved': {
        if (state.status !== 'saving') return state;
        const saved = event.response?.ok ? event.response : null;
        // Consent can be durable even if removing the cache failed. Show that state and the error.
        const reconciled = saved ?? (event.reconciled?.ok ? event.reconciled : null);
        const channel = reconciled ?? state.channel;
        if (!saved) return { status: 'idle', channel, error: 'save' };
        return state.enabled && canCheck(channel)
          ? { status: 'checking', force: false, channel, error: null }
          : { status: 'idle', channel, error: null };
      }
    }
  };
}

export type FixesRequest = (
  type: string,
  extra?: { enabled?: boolean; force?: boolean },
) => Promise<Reply>;

export function createGeminiSelectorFixesEffects(
  request: FixesRequest,
): MachineDefinition<FixesState, FixesEvent>['effects'] {
  return {
    loading: (stay) => {
      const read = (asked: FixesState): void => {
        void request(GEMINI_SELECTOR_STATUS_MESSAGE).then((response) => {
          if (stay.signal.aborted) return;
          // A consent change while reading keeps this status but makes the answer stale.
          if (stay.state() !== asked) read(stay.state());
          else stay.send({ type: 'loaded', response });
        });
      };
      read(stay.state());
    },
    checking: (stay) => {
      void request(GEMINI_SELECTOR_REFRESH_MESSAGE, { force: stay.state().force }).then(
        (response) => stay.send({ type: 'checked', response }),
      );
    },
    saving: (stay) => {
      const { enabled } = stay.state();
      void (async () => {
        const response = await request(GEMINI_SELECTOR_SET_ENABLED_MESSAGE, { enabled });
        const reconciled =
          response?.ok || stay.signal.aborted
            ? null
            : await request(GEMINI_SELECTOR_STATUS_MESSAGE);
        stay.send({ type: 'saved', response, reconciled });
      })();
    },
  };
}
