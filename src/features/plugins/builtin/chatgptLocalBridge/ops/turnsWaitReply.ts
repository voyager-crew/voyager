/**
 * `turns.waitReply` (spec §3.4, passive): watch the reply to one prompt until
 * it is proven finished, for as long as a Pro answer takes.
 *
 * A turn finishes only on positive evidence, never on quiet alone (a settled
 * preamble before a long thinking phase looks quiet too). Every check must
 * hold at once:
 * - the reply's action row has rendered and held for {@link BAR_CONFIRM_CYCLES}
 *   unchanged looks, each at least {@link CYCLE_MS} after the last one counted
 *   — the row can flash mid-thinking, so one sighting is not enough;
 * - the reply's text has not changed for `stableMs`, and is not empty;
 * - no stop control in the composer, no thinking or streaming marker in the turn;
 * - the turn's `data-talvt-turn-state` reads `complete` when the turn carries
 *   one (its generating value was never observed, so any other value vetoes).
 *
 * There is no fixed time limit while ChatGPT works on the reply: a stop
 * control, a thinking marker or changing text counts as activity. Only
 * `stallMs` without any of these fails it (`reply-stalled`); `timeoutMs` is
 * the hard cap behind that.
 *
 * Nothing polls: the wait looks when the reply's item or the composer form
 * changes (at most once per {@link CYCLE_MS}), when the route or page data
 * moves, every {@link CYCLE_MS} while the reply is finalizing, and at the next
 * moment something is due: the end of `stableMs`, the progress beat, the
 * stall, the timeout. A background tab needs no foreground for any of it.
 * After a frozen stretch (`resume`), the activity clock restarts: the frozen
 * time is the browser's, not a stall.
 *
 * A turn showing ChatGPT's connection-interrupted notice never counts as
 * finished, whatever else it shows: its text is cut short (`./replyEvidence.ts`).
 *
 * With `stopOnApproval`, an app's approval card in the reply ends the wait
 * (`approval-required`); `turns.approve` answers it.
 *
 * The page is never touched: no scroll, no click. Progress goes out every
 * {@link PROGRESS_EVERY_MS}.
 */
import {
  type TurnsWaitReplyParams,
  type TurnsWaitReplyResult,
  WAIT_REPLY_DEFAULT_STABLE_MS,
  WAIT_REPLY_DEFAULT_STALL_MS,
  WAIT_REPLY_DEFAULT_TIMEOUT_MS,
  type WaitReplyProgress,
} from '@/features/bridge/protocol';
import { chatgptPageData } from '@/features/plugins/builtin/chatgptPageData';
import { hasReplyActions } from '@/features/plugins/builtin/chatgptResponseNotification/page';
import chatgptSite from '@/features/plugins/catalog/sites/chatgpt/site.json';
import type { SiteAdapter } from '@/features/plugins/types';

import type { OpContext } from '../opContext';
import type { WakeScope } from '../wake';
import { describeApprovalCard, findApprovalCard } from './approvalCard';
import {
  composerFormOf,
  conversationItems,
  findComposerField,
  findReply,
  hashText,
  hasStopControl,
  hasThinkingSignal,
  isCompleteTurnState,
  readTurnKey,
  replyIdOf,
  replyTextOf,
  settledConversationId,
  turnStateOf,
  userTextOf,
} from './pageReaders';
import { interruptionNotice, replyEvidence } from './replyEvidence';

export const PROGRESS_EVERY_MS = 15_000;
export const BAR_CONFIRM_CYCLES = 3;
/** One confirmation cycle, and the least gap between two looks at a streaming reply. */
const CYCLE_MS = 1_000;
/** A look found the reply in another item, or its finalizing begin or end: watch anew. */
const RESCOPE = Symbol('rescope');
// ChatGPT's terminal failure copy and its usage-cap and throttling banners: its servers
// send them in English (no UI language's messages hold them). The site's
// `pageHooks.replyFailed` / `.rateLimit` replace these measured forms remotely.
const THINKING_FAILED = chatgptSite.pageHooks.replyFailed.map((source) => new RegExp(source, 'i'));
const RATE_LIMIT_COPY = chatgptSite.pageHooks.rateLimit.map((source) => new RegExp(source, 'i'));

/** The site's patterns (checked safe when the site data was read), else the measured ones. */
function patternsOf(sources: readonly string[] | undefined, fallback: readonly RegExp[]): RegExp[] {
  if (!sources) return [...fallback];
  return sources.flatMap((source) => {
    try {
      return [new RegExp(source, 'i')];
    } catch {
      return [];
    }
  });
}
const ALERT_SELECTOR = chatgptPageData.replyAlert;

interface Gate {
  contentKey: string;
  changedAt: number;
  barCycles: number;
  /** When the last cycle was counted, or the count was reset. */
  cycleAt: number;
}

/** What one wait watches: the reply's item (null until it is found) and whether it is finalizing. */
interface Watch {
  readonly item: HTMLElement | null;
  readonly finalizing: boolean;
}

/** The reply's item, the list it sits in (a re-mounted item) and the composer form. */
function scopeOf(watch: Watch, adapter: SiteAdapter | null): WakeScope[] | undefined {
  const field = findComposerField(adapter);
  if (!watch.item || !field) return undefined;
  const scope: WakeScope[] = [{ element: watch.item }, { element: composerFormOf(field) }];
  const list = watch.item.parentElement;
  if (list) scope.push({ element: list, subtree: false, attributeFilter: [] });
  return scope;
}

function findTarget(
  afterUserTurnKey: string,
): { item: HTMLElement; reply: HTMLElement | null } | null {
  const items = conversationItems();
  const index = items.findIndex((item) => readTurnKey(item) === afterUserTurnKey);
  if (index < 0) return null;
  // ChatGPT keeps the reply in the prompt's own item; earlier DOMs gave it the next one.
  for (const item of items.slice(index)) {
    // A later prompt's item holds that prompt's reply, never this one's.
    if (item !== items[index] && userTextOf(item) !== null) break;
    const reply = findReply(item);
    if (reply) return { item, reply };
    if (item !== items[index]) break;
  }
  return { item: items[index], reply: null };
}

/** The page's alerts outside the thread, as text: found by role, in every UI language. */
function pageAlerts(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>(ALERT_SELECTOR))
    .filter((alert) => !alert.closest(chatgptPageData.turnItem))
    .map((alert) => (alert.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 300))
    .filter(Boolean);
}

function rateLimitBanner(patterns: readonly RegExp[]): string | null {
  return pageAlerts().find((text) => patterns.some((pattern) => pattern.test(text))) ?? null;
}

export async function runTurnsWaitReply(
  ctx: OpContext,
  params: TurnsWaitReplyParams,
  adapter: SiteAdapter | null,
): Promise<TurnsWaitReplyResult> {
  const startedAt = ctx.now();
  const failedCopy = patternsOf(adapter?.pageHooks?.replyFailed, THINKING_FAILED);
  const limitCopy = patternsOf(adapter?.pageHooks?.rateLimit, RATE_LIMIT_COPY);
  const timeoutMs = params.timeoutMs ?? WAIT_REPLY_DEFAULT_TIMEOUT_MS;
  const stableMs = params.stableMs ?? WAIT_REPLY_DEFAULT_STABLE_MS;
  const stallMs = params.stallMs ?? WAIT_REPLY_DEFAULT_STALL_MS;
  const onRoute = (): boolean => settledConversationId() === params.conversationId;
  if (!onRoute()) {
    ctx.fail('unverified', 'The tab shows another conversation.', {
      expected: params.conversationId,
      actual: settledConversationId(),
    });
  }

  let gate: Gate = { contentKey: '', changedAt: startedAt, barCycles: 0, cycleAt: startedAt };
  let lastProgressAt = startedAt;
  let activeAt = startedAt;
  let sawStop = false;
  let phase: WaitReplyProgress['phase'] = 'thinking';
  let textLength = 0;
  let watched: Watch = { item: null, finalizing: false };
  let seen: Watch = watched;

  const look = (): { readonly result: TurnsWaitReplyResult } | typeof RESCOPE | null => {
    const now = ctx.now();
    if (!onRoute()) {
      ctx.fail('cancelled', 'The tab left the conversation.', {
        reason: 'route-changed',
        conversationId: params.conversationId,
      });
    }
    const banner = rateLimitBanner(limitCopy);
    if (banner) ctx.fail('rate-limited', 'ChatGPT reports a usage limit.', { banner });
    const card = params.stopOnApproval ? findApprovalCard(params.afterUserTurnKey) : null;
    if (card) {
      ctx.fail(
        'approval-required',
        'ChatGPT asks to allow one of its apps before the reply goes on.',
        { ...describeApprovalCard(card) },
      );
    }

    const target = findTarget(params.afterUserTurnKey);
    const reply = target?.reply ?? null;
    const text = reply ? replyTextOf(reply) : '';
    if (reply && failedCopy.some((pattern) => pattern.test(text))) {
      ctx.fail('reply-failed', 'ChatGPT could not finish the reply.', {
        conversationId: params.conversationId,
      });
    }
    const stop = hasStopControl(adapter);
    sawStop ||= stop;
    const thinking = target ? hasThinkingSignal(target.item) : false;
    const turnState = target ? turnStateOf(target.item) : null;
    const bar = reply ? hasReplyActions(reply) : false;
    const contentKey = reply ? `${replyIdOf(reply) ?? ''}|${hashText(text)}` : '';
    const changed = contentKey !== gate.contentKey;
    const quiet = !stop && !thinking && (turnState === null || isCompleteTurnState(turnState));
    // Cut short: its retry button would pass for the action row, and its partial text for the reply.
    const interrupted = target ? interruptionNotice(target.item) !== null : false;
    // A wake can come any time: a cycle counts only a full cycle after the last one.
    const steady = bar && quiet && !changed && !interrupted;
    const cycled = steady && now - gate.cycleAt >= CYCLE_MS;
    gate = {
      contentKey,
      changedAt: changed ? now : gate.changedAt,
      barCycles: !steady ? 0 : cycled ? gate.barCycles + 1 : gate.barCycles,
      cycleAt: !steady || cycled ? now : gate.cycleAt,
    };
    textLength = text.length;
    if (changed || stop || thinking) activeAt = now;

    if (
      target &&
      reply &&
      text.length > 0 &&
      quiet &&
      bar &&
      !interrupted &&
      gate.barCycles >= BAR_CONFIRM_CYCLES &&
      now - gate.changedAt >= stableMs
    ) {
      return {
        result: {
          assistantTurnKey: replyIdOf(reply) ?? readTurnKey(target.item),
          status: 'complete',
          elapsedMs: now - startedAt,
          evidence: {
            turnState,
            barCycles: gate.barCycles,
            stableForMs: now - gate.changedAt,
            sawStop,
            itemKey: readTurnKey(target.item),
          },
        },
      };
    }

    phase =
      !reply || text.length === 0 || thinking
        ? 'thinking'
        : bar && quiet
          ? 'finalizing'
          : 'streaming';
    if (now - lastProgressAt >= PROGRESS_EVERY_MS) {
      lastProgressAt = now;
      ctx.progress({ phase, textLength, elapsedMs: now - startedAt });
    }
    if (now - activeAt >= stallMs) {
      ctx.fail('reply-stalled', 'The reply showed no activity for too long.', {
        conversationId: params.conversationId,
        phase,
        textLength,
        stalledForMs: now - activeAt,
        // An alert the site data does not know (another language, new copy) is often the cause.
        ...(pageAlerts().length > 0 ? { alerts: pageAlerts() } : {}),
        ...replyEvidence(target?.item ?? null, reply, adapter),
      });
    }
    if (now - startedAt >= timeoutMs) {
      ctx.fail('timeout', 'The reply did not finish in time.', {
        conversationId: params.conversationId,
        phase,
        textLength,
        ...(pageAlerts().length > 0 ? { alerts: pageAlerts() } : {}),
        ...replyEvidence(target?.item ?? null, reply, adapter),
      });
    }
    seen = { item: reply && target ? target.item : null, finalizing: phase === 'finalizing' };
    return seen.item !== watched.item || seen.finalizing !== watched.finalizing ? RESCOPE : null;
  };

  // A frozen tab runs nothing; the time it spent frozen says nothing about the reply.
  const onResume = (): void => {
    activeAt = ctx.now();
  };
  document.addEventListener('resume', onResume);
  try {
    for (;;) {
      watched = seen;
      const now = ctx.now();
      const stableAt = gate.changedAt + stableMs;
      // The next moment a look is due without any wake; each one-shot, re-armed after the look.
      const dueAt = Math.min(
        lastProgressAt + PROGRESS_EVERY_MS,
        activeAt + stallMs,
        startedAt + timeoutMs,
        stableAt > now ? stableAt : Number.POSITIVE_INFINITY,
      );
      const scope = scopeOf(watched, adapter);
      const found = await ctx.waitFor(look, {
        timeoutMs: Math.max(0, dueAt - now),
        minGapMs: CYCLE_MS,
        ...(scope ? { scope } : {}),
        ...(watched.finalizing ? { recheckMs: CYCLE_MS } : {}),
      });
      if (found && found !== RESCOPE) return found.result;
    }
  } finally {
    document.removeEventListener('resume', onResume);
  }
}
