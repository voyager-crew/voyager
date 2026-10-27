import { GEMINI_PACKAGED_FORK } from '@/core/gemini/content/packaged';
import { hasGeminiBoundaryConflict } from '@/core/gemini/domBoundary';
import {
  type GeminiTurnView,
  getBundledGeminiTurnView,
  getGeminiSelectorView,
  resolveGeminiTurnOperation,
} from '@/core/gemini/selectors';
import { getGeminiTurnSelectors } from '@/core/gemini/turnSelectors';
import { logger } from '@/core/services/LoggerService';
import { getSendKeyCoordinator } from '@/core/services/composer/sendKeys/sendKeyCoordinator';
import { findSendButton } from '@/core/services/composer/sendKeys/sendKeyDom';
import { SEND_SITE_POLICIES } from '@/core/services/composer/sendKeys/sendSitePolicies';
import { isExtensionContextInvalidatedError } from '@/core/utils/extensionContext';

import { geminiDraftPolicy } from '../draftSave/geminiDraftPolicy';
import {
  capturePageIdentity,
  isDifferentAccount,
  routeKeyOf,
  type PageIdentity,
} from '../selectionToolbar/pageIdentity';
import { isSendKeyboardEvent } from '../sendBehavior/sendButton';
import { watchRouteChanges } from '../utils/routeWatcher';
import { ForkNodesService } from './ForkNodesService';
import type { PendingForkData } from './forkLaunch';
import type { ForkNode } from './forkTypes';
import { isCurrentForkReceiver } from './receiverIdentity';
import { makeTurnId, readServerTurnId } from './turnId';

interface ForkLinkHandoff {
  readonly pendingFork: PendingForkData;
  readonly receiver: PageIdentity;
  readonly deadline: number;
  readonly getConversationTitle: () => string;
  readonly onLinked: () => Promise<void>;
  readonly onFinished: () => void;
}

export interface ForkLinkReceipt {
  /** Feature off hides UI, while the page-owned first-send watcher keeps its original deadline. */
  hideUi(): void;
  /** A late file-prompt wait must not refill a composer after its first send. */
  canPrefill(): boolean;
}

const normalize = (text: string): string => text.replace(/\s+/g, ' ').trim();

function turnText(turn: Element): string {
  const lines = turn.querySelectorAll(GEMINI_PACKAGED_FORK['fork.sentTextLines'].join(','));
  if (lines.length) return Array.from(lines, (line) => line.textContent ?? '').join('\n');
  const clone = turn.cloneNode(true) as Element;
  clone
    .querySelectorAll('button, .gv-fork-indicator-group, .gv-fork-btn')
    .forEach((el) => el.remove());
  return clone.textContent ?? '';
}

function userTurns(view: GeminiTurnView): Element[] {
  return Array.from(
    document.querySelectorAll(getGeminiTurnSelectors('turn.userWithHosts', view).join(',')),
  );
}

/** One operation owns all of its send evidence, bounded waits and notification eligibility. */
class PendingForkLink implements ForkLinkReceipt {
  private stopped = false;
  private writing = false;
  private uiAlive = true;
  private destination: PageIdentity | null = null;
  private intent: {
    text: string;
    turns: Set<Element>;
    ids: Set<string>;
    view: GeminiTurnView | null;
  } | null = null;
  private readonly policy = geminiDraftPolicy();
  private readonly deadlineTimer: number;
  private readonly poll: number;
  private readonly observer: MutationObserver;
  private readonly stopRoutes: () => void;

  constructor(
    private readonly handoff: ForkLinkHandoff,
    private readonly release: (writing: boolean) => void,
  ) {
    document.addEventListener('keydown', this.onKeydown, true);
    document.addEventListener('click', this.onClick, true);
    document.addEventListener('input', this.onInput, true);
    this.observer = new MutationObserver(this.check);
    this.observer.observe(document, { childList: true, subtree: true, attributes: true });
    this.stopRoutes = watchRouteChanges(this.check);
    this.poll = window.setInterval(this.check, 250);
    this.deadlineTimer = window.setTimeout(this.finish, Math.max(0, handoff.deadline - Date.now()));
  }

  hideUi(): void {
    this.uiAlive = false;
  }

  canPrefill(): boolean {
    return !this.stopped && !this.intent && isCurrentForkReceiver(this.handoff.receiver);
  }

  stop(): void {
    this.hideUi();
    this.finish();
  }

  private readonly finish = (): void => {
    if (this.stopped) return;
    this.stopped = true;
    clearTimeout(this.deadlineTimer);
    clearInterval(this.poll);
    this.observer.disconnect();
    this.stopRoutes();
    document.removeEventListener('keydown', this.onKeydown, true);
    document.removeEventListener('click', this.onClick, true);
    document.removeEventListener('input', this.onInput, true);
    this.handoff.onFinished();
    this.release(this.writing);
  };

  private field(): HTMLElement | null {
    const field = this.policy.findInput(document);
    if (field && getGeminiSelectorView().remoteKeys.has('composer.draftCandidates')) {
      return hasGeminiBoundaryConflict(
        field,
        field.closest('input-area, input-area-v2, input-container, .text-input-field, .input-area'),
        '[role="dialog"], .mat-mdc-dialog-container',
      )
        ? null
        : field;
    }
    return field?.closest('[role="dialog"], .mat-mdc-dialog-container') ? null : field;
  }

  private arm(field: HTMLElement): void {
    this.check();
    if (
      this.stopped ||
      !isCurrentForkReceiver(this.handoff.receiver) ||
      this.policy.isEmpty(field) ||
      !findSendButton(field, SEND_SITE_POLICIES.gemini.sendContainerSelectors)
    )
      return;
    const existing = resolveGeminiTurnOperation(userTurns, (matches) => matches.length > 0);
    const turns = new Set(existing.value);
    // Keep pre-send bundled evidence too: a later rejected repair cannot pass an older prompt off as new.
    if (existing.view.remoteKeys.size)
      userTurns(getBundledGeminiTurnView()).forEach((turn) => turns.add(turn));
    this.intent = {
      text: normalize(this.policy.readText(field)),
      turns,
      ids: new Set(Array.from(turns, readServerTurnId).filter((id): id is string => id !== null)),
      // Earlier turns were recorded through this view; another view could pass one off as new.
      // With no earlier turns either view is safe, so the first send may still fall back.
      view: turns.size > 0 ? existing.view : null,
    };
  }

  private readonly onKeydown = (event: KeyboardEvent): void => {
    if (
      event.defaultPrevented ||
      !isSendKeyboardEvent(event, getSendKeyCoordinator('gemini')?.effectiveSendKey() ?? 'host')
    )
      return;
    const field = this.field();
    if (field && event.target instanceof Node && field.contains(event.target)) this.arm(field);
  };

  private readonly onClick = (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) return;
    // Sidebar navigation is not a first send, even if it follows a cancelled send intent.
    const link = event.target.closest<HTMLAnchorElement>('a[href]');
    const target = link?.target.trim().toLowerCase() ?? '';
    const url = link && new URL(link.href, location.href);
    if (
      link &&
      url &&
      !link.hasAttribute('download') &&
      (target === '' || target === '_self') &&
      /^https?:$/.test(url.protocol) &&
      url.origin === location.origin &&
      routeKeyOf(url.pathname, url.search) !== capturePageIdentity().routeKey
    ) {
      this.finish();
      return;
    }
    if (event.defaultPrevented) return;
    const field = this.field();
    const button = field && findSendButton(field, SEND_SITE_POLICIES.gemini.sendContainerSelectors);
    if (field && button?.contains(event.target)) this.arm(field);
  };

  private readonly onInput = (event: Event): void => {
    // The first route may precede its user DOM; the next draft cannot cancel that accepted send.
    this.check();
    if (this.stopped) return;
    const field = this.field();
    if (!field || !(event.target instanceof Node) || !field.contains(event.target)) return;
    if (
      this.intent &&
      isCurrentForkReceiver(this.handoff.receiver) &&
      !this.policy.isEmpty(field) &&
      normalize(this.policy.readText(field)) !== this.intent.text
    )
      this.intent = null;
    this.check();
  };

  private readonly check = (): void => {
    if (this.stopped) return;
    const { receiver, deadline } = this.handoff;
    const current = capturePageIdentity();
    if (
      Date.now() >= deadline ||
      current.origin !== receiver.origin ||
      isDifferentAccount(receiver, current)
    ) {
      this.finish();
      return;
    }
    if (this.destination && this.destination.routeKey !== current.routeKey) {
      this.finish();
      return;
    }
    if (current.routeKey === receiver.routeKey) return;
    const prefix = `${receiver.pathname.replace(/\/$/, '')}/`;
    const suffix = current.pathname.startsWith(prefix) ? current.pathname.slice(prefix.length) : '';
    if (!this.intent) {
      logger.warn('[Fork] Pending link abandoned: route changed before a send');
      this.finish();
      return;
    }
    if (!suffix || suffix.includes('/')) {
      this.finish();
      return;
    }
    // Pin the first route before its user DOM arrives; a later route cannot steal the handoff.
    this.destination ??= current;
    const intent = this.intent;
    const findSent = (view: GeminiTurnView) =>
      userTurns(view).find((turn) => {
        if (intent.turns.has(turn)) return false;
        const id = makeTurnId(turn, 0);
        return !intent.ids.has(id) && normalize(turnText(turn)) === intent.text;
      });
    const firstUser = resolveGeminiTurnOperation(
      findSent,
      (turn) => turn !== undefined,
      intent.view ?? undefined,
    ).value;
    if (!firstUser) return;

    const { pendingFork, getConversationTitle } = this.handoff;
    const createdAt = Date.now();
    const source: ForkNode = {
      turnId: pendingFork.sourceTurnId,
      conversationId: pendingFork.sourceConversationId,
      conversationUrl: pendingFork.sourceUrl,
      conversationTitle: pendingFork.sourceTitle,
      forkGroupId: pendingFork.forkGroupId,
      forkIndex: pendingFork.sourceForkIndex,
      createdAt,
    };
    const destination: ForkNode = {
      // The server id makes the first branch indicator visible before history aliases load.
      turnId: makeTurnId(firstUser, 0),
      conversationId: suffix,
      conversationUrl: current.href,
      conversationTitle: getConversationTitle(),
      forkGroupId: pendingFork.forkGroupId,
      forkIndex: pendingFork.nextForkIndex,
      createdAt,
    };
    this.writing = true;
    this.finish();
    // Both payloads belong to the accepted send; feature/page retirement cannot split the writes.
    void this.writePair(source, destination);
  };

  private async writePair(source: ForkNode, destination: ForkNode): Promise<void> {
    try {
      await ForkNodesService.addForkNode(source);
      await ForkNodesService.addForkNode(destination);
      if (this.uiAlive && isCurrentDestination(this.handoff.receiver, destination.conversationUrl))
        await this.handoff.onLinked();
    } catch (error) {
      if (!isExtensionContextInvalidatedError(error))
        logger.error('[Fork] Failed to create fork nodes', { error });
    } finally {
      this.release(false);
    }
  }
}

function isCurrentDestination(receiver: PageIdentity, href: string): boolean {
  const current = capturePageIdentity();
  const destination = new URL(href);
  return current.href === destination.href && !isDifferentAccount(receiver, current);
}

/** The page owns one finisher, independently of the fork feature's enabled setting. */
class ForkLinkFinisher {
  private active: PendingForkLink | null = null;
  private readonly accepted = new Set<PendingForkLink>();
  private retired = false;

  handoff(options: ForkLinkHandoff): ForkLinkReceipt | null {
    if (this.retired || Date.now() >= options.deadline || !isCurrentForkReceiver(options.receiver))
      return null;
    // An accepted pair is one operation until both background writes settle.
    if (!this.active && this.accepted.size > 0) return null;
    this.active?.stop();
    const operation = new PendingForkLink(options, (writing) => {
      if (this.active === operation) this.active = null;
      if (!writing) this.accepted.delete(operation);
    });
    this.active = operation;
    this.accepted.add(operation);
    return operation;
  }

  stop(): void {
    this.retired = true;
    for (const operation of this.accepted) operation.stop();
    this.accepted.clear();
    this.active = null;
  }
}

let current: ForkLinkFinisher | null = null;

export function startForkLinkFinisher(): () => void {
  current?.stop();
  const owner = new ForkLinkFinisher();
  current = owner;
  return () => {
    owner.stop();
    if (current === owner) current = null;
  };
}

/** Called only after paste/upload handoff; a missing or retired page owner accepts nothing. */
export function handoffPendingForkLink(options: ForkLinkHandoff): ForkLinkReceipt | null {
  return current?.handoff(options) ?? null;
}
