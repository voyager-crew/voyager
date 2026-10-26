/**
 * The Local Bridge's page side (spec §3.3): a module-level runtime that lives
 * as long as this document, across plugin remounts. The plugin mount only
 * attaches the current site adapter; every op comes from the background in an
 * `op.start`, so a remount (a catalog update re-mounts every plugin) never
 * starts or retries anything.
 *
 * - At most one op runs. A second `op.start` is refused as `busy`; the same
 *   task id again is acknowledged without a second run.
 * - Detach terminates an interactive op at once. A passive one keeps the
 *   adapter it started with and ends as `bridge-disabled` only when no attach
 *   follows within {@link DETACH_GRACE_MS} (the plugin was turned off).
 * - A challenge seen while an op runs terminates it and tells the person.
 */
import { logger } from '@/core/services/LoggerService';
import { createToaster } from '@/core/ui/toast/toaster';
import type { Toaster } from '@/core/ui/toast/types';
import { isExtensionContextInvalidatedError } from '@/core/utils/extensionContext';
import { isUserEvent } from '@/core/utils/userEvent';
import {
  type BridgeError,
  type BridgeTask,
  type ValidatedBridgeTask,
  bridgeError,
  isOpName,
  supportsOpVersion,
  validateOpParams,
  validateOpResult,
} from '@/features/bridge/protocol';
import {
  type BridgeGrant,
  type BridgeLeaseProbeReply,
  type BridgeOpCancelReply,
  type BridgeOpOutcome,
  type BridgeOpStartAck,
  LEASED_OPS,
  isBridgeMessageType,
} from '@/features/bridge/runtimeMessages';
import { chatgptPageData } from '@/features/plugins/builtin/chatgptPageData';
import type { SiteAdapter } from '@/features/plugins/types';
import { getCurrentLanguage } from '@/utils/i18n';

import { chatgptComposerRootOf } from '../chatgptComposerTargets';
import { CHALLENGE_TOAST_COPY, type ChallengeKind, createChallengeGuard } from './challengeGuard';
import { getDocNonce, isOwnDocNonce } from './docIdentity';
import {
  GRANT_MARGIN_MS,
  type OpContext,
  type OpEnvironment,
  OpFailure,
  OpTermination,
  createOpContext,
  defaultOpEnvironment,
} from './opContext';
import { runTurnsApprove } from './ops/approvalCard';
import { type BlobChunkReader, readBlobReply } from './ops/blobBytes';
import {
  type BlobWriter,
  readBlobCommitReply,
  readBlobCreateReply,
  readBlobWriteReply,
} from './ops/blobUpload';
import { runComposerAttach } from './ops/composerAttach';
import { type ComposerActivity, runComposerSend } from './ops/composerSend';
import { runConversationReady } from './ops/conversationReady';
import { runFilesDownload } from './ops/filesDownload';
import { runModelSelect } from './ops/modelSelect';
import { runProjectOp } from './ops/projectRuntime';
import { runTurnsRead } from './ops/turnsRead';
import { runTurnsWaitReply } from './ops/turnsWaitReply';
import { createPageDownloader } from './pageData/download';
import { createPageDataStore } from './pageData/store';
import type { Defer } from './wake';

export const DETACH_GRACE_MS = 3_000;
const OUTCOME_CACHE_SIZE = 16;
const CANCELLED_MEMORY = 16;
const DONE_RETRY_DELAYS_MS = [1_000, 3_000] as const;
const TOAST_MS = 20_000;
const USER_INPUT_EVENTS = ['keydown', 'beforeinput', 'paste', 'drop', 'pointerdown'] as const;
const COMPOSER_FIELD_SELECTOR = chatgptPageData.composerEditable;

export type RuntimeSend = (message: Record<string, unknown>) => Promise<unknown>;

interface RunningOp {
  readonly taskId: string;
  readonly ctx: OpContext;
  readonly interactive: boolean;
  readonly leaseId?: string;
}

export interface BridgeRuntime {
  attach(adapter: SiteAdapter | null): void;
  detach(): void;
  /**
   * Stop the op running `taskId`, if any, and refuse it later; zero page
   * events follow. True when an op was running it.
   */
  abort(taskId: string, reason?: string): boolean;
  /** For tests and the message listener: the synchronous replies the background reads. */
  handleOpStart(task: BridgeTask, grant: BridgeGrant): BridgeOpStartAck;
  handleLeaseProbe(leaseId: string): BridgeLeaseProbeReply;
  readonly runningTaskId: string | null;
  readonly attached: boolean;
}

export interface BridgeRuntimeOptions {
  readonly send?: RuntimeSend;
  readonly env?: OpEnvironment;
  readonly now?: () => number;
  /** Where waits look after a wake (see `wake.ts`); the tests' fake clock drives a timer instead. */
  readonly defer?: Defer;
  /** Install the `chrome.runtime.onMessage` listener on first attach. */
  readonly listen?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readGrant(raw: unknown): BridgeGrant | null {
  if (!isRecord(raw)) return null;
  const { docNonce, deadline, leaseId } = raw;
  if (typeof docNonce !== 'string' || typeof deadline !== 'number' || !Number.isFinite(deadline)) {
    return null;
  }
  if (leaseId !== undefined && typeof leaseId !== 'string') return null;
  return leaseId === undefined ? { docNonce, deadline } : { docNonce, deadline, leaseId };
}

function readTask(raw: unknown): BridgeTask | null {
  if (!isRecord(raw)) return null;
  const { taskId, jobId, op, opVersion, deadlineMs, issuedAt } = raw;
  if (typeof taskId !== 'string' || !taskId || typeof jobId !== 'string' || !isOpName(op)) {
    return null;
  }
  if (typeof opVersion !== 'number' || typeof deadlineMs !== 'number') return null;
  if (typeof issuedAt !== 'number') return null;
  return { taskId, jobId, op, opVersion, params: raw.params, deadlineMs, issuedAt };
}

/**
 * How the op's waits were woken, kept with the result's own evidence; a result
 * without evidence (or a failure) leaves them in the debug log.
 */
function withWakes(op: string, data: unknown, ctx: OpContext, hidden: boolean): unknown {
  const wakes = ctx.wakes();
  if (isRecord(data) && isRecord(data.evidence)) {
    return { ...data, evidence: { ...data.evidence, wakes, hidden } };
  }
  logger.debug('Local bridge op wakes', { op, wakes, hidden });
  return data;
}

function outcomeOf(error: unknown): BridgeOpOutcome {
  if (error instanceof OpFailure || error instanceof OpTermination) {
    return { ok: false, error: error.error };
  }
  logger.warn('Local bridge op threw', { error: String(error) });
  return { ok: false, error: bridgeError('unverified', 'The op stopped on an unexpected error.') };
}

export function createBridgeRuntime(options: BridgeRuntimeOptions = {}): BridgeRuntime {
  const now = options.now ?? Date.now;
  // `adapter` is assigned once the plugin attaches; the guard reads it afresh.
  const challenge = createChallengeGuard(document, now, () => adapter?.pageHooks?.accountBlocked);
  const env = options.env ?? defaultOpEnvironment(() => challenge.current(), options.defer);
  const send: RuntimeSend =
    options.send ?? ((message) => chrome.runtime.sendMessage(message) as Promise<unknown>);
  let adapter: SiteAdapter | null = null;
  let attached = false;
  let detachTimer: ReturnType<typeof setTimeout> | null = null;
  let documentListenersInstalled = false;
  let running: RunningOp | null = null;
  let lastUserInputAt = Number.NEGATIVE_INFINITY;
  let toaster: Toaster | null = null;
  const pageData = createPageDataStore(now);
  const pageDownload = createPageDownloader();
  const outcomes = new Map<string, BridgeOpOutcome>();
  /** Tasks cancelled here; an `op.start` for one (it can arrive after its cancel) is refused. */
  const cancelled = new Set<string>();

  const activity: ComposerActivity = {
    hadRecentUserInput: (ms) => now() - lastUserInputAt < ms,
  };

  const deliver = async (message: Record<string, unknown>, retry: boolean): Promise<void> => {
    const delays = retry ? DONE_RETRY_DELAYS_MS : [];
    for (let attempt = 0; ; attempt += 1) {
      try {
        await send(message);
        return;
      } catch (error) {
        if (isExtensionContextInvalidatedError(error) || attempt >= delays.length) return;
        await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
      }
    }
  };

  /** Attachment bytes come from the background, which checks this document holds the task. */
  const chunkReader =
    (taskId: string): BlobChunkReader =>
    async (blobId, offset, length) => {
      try {
        const reply = await send({
          type: 'gv.bridge.blob.read',
          taskId,
          docNonce: getDocNonce(),
          blobId,
          offset,
          length,
        });
        return readBlobReply(reply);
      } catch (error) {
        const reloaded = isExtensionContextInvalidatedError(error);
        return {
          ok: false,
          error: bridgeError(
            reloaded ? 'extension-reloaded' : 'server-unreachable',
            'The attachment could not be read from the extension.',
          ),
        };
      }
    };

  /** A downloaded file goes to the background, which checks this document holds the task. */
  const blobWriter = (taskId: string): BlobWriter => {
    const relay = async <T>(
      message: Record<string, unknown>,
      read: (raw: unknown) => T,
      failed: (error: BridgeError) => T,
    ): Promise<T> => {
      try {
        return read(await send({ ...message, taskId, docNonce: getDocNonce() }));
      } catch (error) {
        const reloaded = isExtensionContextInvalidatedError(error);
        return failed(
          bridgeError(
            reloaded ? 'extension-reloaded' : 'server-unreachable',
            'The download could not be handed to the extension.',
          ),
        );
      }
    };
    const refused = (error: BridgeError) => ({ ok: false as const, error });
    return {
      create: (meta) =>
        relay({ type: 'gv.bridge.blob.create', ...meta }, readBlobCreateReply, refused),
      write: (blobId, offset, base64) =>
        relay(
          { type: 'gv.bridge.blob.write', blobId, offset, base64 },
          readBlobWriteReply,
          refused,
        ),
      commit: (blobId) =>
        relay({ type: 'gv.bridge.blob.commit', blobId }, readBlobCommitReply, refused),
    };
  };

  const showChallengeToast = (kind: ChallengeKind): void => {
    void getCurrentLanguage()
      .catch(() => 'en' as const)
      .then((language) => {
        toaster ??= createToaster();
        toaster.show({
          message: (CHALLENGE_TOAST_COPY[language] ?? CHALLENGE_TOAST_COPY.en)[kind],
          tone: 'error',
          channel: 'gv-bridge-challenge',
          durationMs: TOAST_MS,
        });
      });
  };

  const execute = (
    ctx: OpContext,
    task: ValidatedBridgeTask,
    snapshot: SiteAdapter | null,
  ): Promise<unknown> => {
    switch (task.op) {
      case 'conversation.ready':
        return runConversationReady(ctx, task.params, snapshot);
      case 'model.select':
        return runModelSelect(ctx, task.params, snapshot);
      case 'composer.attach':
        return runComposerAttach(ctx, task.params, snapshot, activity, chunkReader(task.taskId));
      case 'composer.send':
        return runComposerSend(ctx, task.params, snapshot, activity);
      case 'turns.waitReply':
        return runTurnsWaitReply(ctx, task.params, snapshot);
      case 'turns.approve':
        return runTurnsApprove(ctx, task.params);
      case 'turns.read':
        return runTurnsRead(ctx, task.params, snapshot, pageData);
      case 'files.download':
        return runFilesDownload(ctx, task.params, pageData, pageDownload, blobWriter(task.taskId));
      default:
        return (
          runProjectOp(ctx, task, snapshot, chunkReader(task.taskId), pageData) ??
          ctx.fail('unsupported-op', `This page does not run ${task.op}.`)
        );
    }
  };

  const finish = (taskId: string, outcome: BridgeOpOutcome): void => {
    outcomes.set(taskId, outcome);
    for (const oldest of outcomes.keys()) {
      if (outcomes.size <= OUTCOME_CACHE_SIZE) break;
      outcomes.delete(oldest);
    }
    void deliver({ type: 'gv.bridge.op.done', taskId, docNonce: getDocNonce(), outcome }, true);
  };

  const run = async (task: BridgeTask, grant: BridgeGrant): Promise<void> => {
    const interactive = LEASED_OPS.has(task.op);
    const ctx: OpContext = createOpContext({
      taskId: task.taskId,
      op: task.op,
      grant,
      interactive,
      env,
      subscribe: pageData.subscribe,
      onProgress: (progress) =>
        void deliver(
          { type: 'gv.bridge.op.progress', taskId: task.taskId, docNonce: getDocNonce(), progress },
          false,
        ),
    });
    running = { taskId: task.taskId, ctx, interactive, leaseId: grant.leaseId };
    const stopWatching = challenge.watch((kind) =>
      ctx.terminate(kind, 'ChatGPT is asking the person to act on this page.'),
    );
    let outcome: BridgeOpOutcome;
    try {
      if (!supportsOpVersion(task.op, task.opVersion)) {
        ctx.fail('unsupported-op', `Version ${task.opVersion} of ${task.op} is not supported.`);
      }
      const params = validateOpParams(task.op, task.params);
      if (!params.ok) ctx.fail('bad-request', 'Invalid op params.', { issues: params.issues });
      const validated = { ...task, params: params.value } as ValidatedBridgeTask;
      const data = withWakes(task.op, await execute(ctx, validated, adapter), ctx, env.isHidden());
      const checked = validateOpResult(task.op, data);
      outcome = checked.ok
        ? { ok: true, data: checked.value }
        : {
            ok: false,
            error: bridgeError('unverified', 'The page result did not match the protocol.', {
              issues: checked.issues,
            }),
          };
    } catch (error) {
      outcome = outcomeOf(error);
      logger.debug('Local bridge op wakes', { op: task.op, wakes: ctx.wakes() });
    } finally {
      ctx.dispose();
      stopWatching();
      if (running?.ctx === ctx) running = null;
    }
    const stoppedBy = ctx.terminated?.code;
    if (stoppedBy === 'challenge' || stoppedBy === 'account-blocked') showChallengeToast(stoppedBy);
    finish(task.taskId, outcome);
  };

  const noteUserInput = (event: Event): void => {
    if (!isUserEvent(event) || !(event.target instanceof Element)) return;
    if (chatgptComposerRootOf(event.target, adapter)?.querySelector(COMPOSER_FIELD_SELECTOR)) {
      lastUserInputAt = now();
    }
  };

  const onMessage = (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ): boolean => {
    if (!isRecord(message) || !isBridgeMessageType(message.type)) return false;
    // Only the background may drive the page: never another content script or a page frame.
    if (sender.id !== chrome.runtime.id || sender.tab) return false;
    if (message.type === 'gv.bridge.op.start') {
      const task = readTask(message.task);
      const grant = readGrant(message.grant);
      if (!task || !grant) {
        logger.warn('Local bridge ignored a malformed op.start');
        return false;
      }
      sendResponse(runtime.handleOpStart(task, grant));
    } else if (message.type === 'gv.bridge.lease.probe' && typeof message.leaseId === 'string') {
      sendResponse(runtime.handleLeaseProbe(message.leaseId));
    } else if (message.type === 'gv.bridge.op.cancel' && typeof message.taskId === 'string') {
      const reason = typeof message.reason === 'string' ? message.reason : 'cancelled';
      runtime.abort(message.taskId, reason);
      // A running op is terminated (no page event follows) and a later op.start is refused,
      // so this document is done with the task whether or not it was running it.
      const reply: BridgeOpCancelReply = { stopped: true };
      sendResponse(reply);
    } else if (message.type === 'gv.bridge.hello.request') {
      if (attached) void deliver({ type: 'gv.bridge.hello', docNonce: getDocNonce() }, false);
      sendResponse({ attached });
    }
    return false;
  };

  // Installed once and kept for the document's lifetime, like the runtime itself: the 8 s
  // composer-input window must span a remount, and a disabled bridge still answers
  // `op.start` (not-attached) and `lease.probe` (stopped) explicitly. The page data is
  // the document's too: a revisit served from the page's cache sends nothing new to observe.
  const installDocumentListeners = (): void => {
    if (documentListenersInstalled) return;
    documentListenersInstalled = true;
    for (const type of USER_INPUT_EVENTS) document.addEventListener(type, noteUserInput, true);
    if (options.listen !== false) chrome.runtime.onMessage.addListener(onMessage);
    pageData.start();
  };

  const runtime: BridgeRuntime = {
    get runningTaskId() {
      return running?.taskId ?? null;
    },
    get attached() {
      return attached;
    },
    attach(next) {
      if (detachTimer !== null) clearTimeout(detachTimer);
      detachTimer = null;
      adapter = next;
      attached = true;
      installDocumentListeners();
      // The background ignores a repeated hello with a known nonce; a remount may send one.
      void deliver({ type: 'gv.bridge.hello', docNonce: getDocNonce() }, false);
    },
    detach() {
      attached = false;
      if (running?.interactive) {
        running.ctx.terminate('cancelled', 'The bridge plugin was remounted.', {
          reason: 'adapter-reloaded',
        });
      }
      if (detachTimer !== null) clearTimeout(detachTimer);
      detachTimer = setTimeout(() => {
        detachTimer = null;
        if (attached) return;
        running?.ctx.terminate('bridge-disabled', 'The Local Bridge plugin was turned off.');
      }, DETACH_GRACE_MS);
    },
    abort(taskId, reason = 'cancelled') {
      cancelled.add(taskId);
      for (const oldest of cancelled) {
        if (cancelled.size <= CANCELLED_MEMORY) break;
        cancelled.delete(oldest);
      }
      if (running?.taskId !== taskId) return false;
      running.ctx.terminate('cancelled', 'The task was cancelled.', { reason });
      return true;
    },
    handleOpStart(task, grant) {
      if (!isOwnDocNonce(grant.docNonce)) return { accepted: false, reason: 'doc-mismatch' };
      if (running?.taskId === task.taskId) return { accepted: true };
      // The cancel can overtake its op.start: the task must then never begin.
      if (cancelled.has(task.taskId)) return { accepted: false, reason: 'cancelled' };
      const known = outcomes.get(task.taskId);
      if (known) {
        finish(task.taskId, known);
        return { accepted: true };
      }
      if (!attached) return { accepted: false, reason: 'not-attached' };
      if (running) return { accepted: false, reason: 'busy' };
      void run(task, grant);
      return { accepted: true };
    },
    handleLeaseProbe(leaseId) {
      if (!running || running.leaseId !== leaseId) return { stopped: true };
      // After the send click no page event can follow, whatever the op still observes.
      if (running.ctx.pageEventsEnded || running.ctx.signal.aborted) return { stopped: true };
      if (now() >= running.ctx.grant.deadline - GRANT_MARGIN_MS) {
        running.ctx.terminate('timeout', 'The page lease expired.', { reason: 'lease-expired' });
        return { stopped: true };
      }
      return { stopped: false };
    },
  };
  return runtime;
}

let singleton: BridgeRuntime | null = null;

/** The document's one bridge runtime, created on first use. */
export function getBridgeRuntime(): BridgeRuntime {
  singleton ??= createBridgeRuntime();
  return singleton;
}
