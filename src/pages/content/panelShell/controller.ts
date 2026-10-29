/**
 * The panel window's lifecycle on the host page: ask the background for a
 * one-time token, mount its plain panel URL and privately bootstrap that frame, take the panel
 * page's window messages (only from that frame, only from the extension's
 * origin), close on Esc and outside presses, keep the background's context
 * current, and give focus back where it was.
 */
import { logger } from '@/core/services/LoggerService';
import { isVoyagerLayerEvent } from '@/core/ui/layer';
import { isExtensionContextInvalidatedError } from '@/core/utils/extensionContext';
import { isUserEvent } from '@/core/utils/userEvent';
import {
  PANEL_MESSAGE,
  PANEL_PAGE_PATH,
  PANEL_SHELL_MESSAGE,
  type PanelContext,
  type PanelShellMessage,
  parsePanelShellMessage,
  parsePanelTokenIssueReply,
} from '@/features/panel/protocol';
import { type Machine, type Stay, startMachine } from '@/features/plugins/runtime/stateMachine';
import { getTranslationSync } from '@/utils/i18n';

import { announceSurfaceOpened, onOtherSurfaceOpened } from '../floatingSurfaces';
import { readPanelContext, watchPanelContext } from './context';
import type { Entry } from './entry';
import { type FocusSnapshot, captureFocus } from './focus';
import { type PanelFrame, createPanelFrame } from './frame';
import {
  PANEL_CLOSED,
  type PanelAnchor,
  type PanelEvent,
  type PanelState,
  isPanelOpen,
  transitionPanel,
} from './panelMachine';
import { type PanelPoint, readPanelPosition, writePanelPosition } from './positions';
import { createPreviewRelay } from './previewRelay';
import type { ShellToast } from './toast';

/** A press on the entry this recent is what opened the panel: its focus is the page's. */
const PRESS_MS = 1500;

export interface PanelControllerDeps {
  /** The entry on the ball now, if the ball shows one. */
  entry(): Entry | null;
  /** Whether a press on the ball toggles the panel, so it is not an outside press. */
  ballTogglesPanel(): boolean;
  readonly toast: ShellToast;
  /** The panel opened or closed (requesting counts as open). */
  onOpenChange(open: boolean): void;
}

export interface PanelOpenOptions {
  /** The panel shortcut asked: the panel page draws focus rings (`#keyboard`). */
  readonly keyboard?: boolean;
}

export interface PanelController {
  open(anchor: PanelAnchor, options?: PanelOpenOptions): void;
  toggle(anchor: PanelAnchor, options?: PanelOpenOptions): void;
  close(): void;
  isOpen(): boolean;
  /** A press on the entry began: remember the page's focus before it can move. */
  notePress(): void;
  stop(): Promise<void>;
}

type PanelStay<K extends PanelState['status']> = Stay<
  Extract<PanelState, { readonly status: K }>,
  PanelEvent
>;

/**
 * `chrome-extension://<id>`, as `event.origin` names the panel page. Read from
 * the root URL rather than `URL.origin`, which some engines report as "null"
 * for a scheme they do not know.
 */
function extensionOrigin(): string | null {
  try {
    return chrome.runtime.getURL('').replace(/\/+$/, '') || null;
  } catch {
    return null;
  }
}

async function send(message: unknown): Promise<unknown> {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    if (!isExtensionContextInvalidatedError(error)) throw error;
    return null;
  }
}

/**
 * The panel cannot open here: offer the popup, as Prompt Manager's settings
 * button does. `life` ends with the shell, which the reply may outlive.
 */
async function openPopupInstead(toast: ShellToast, life: AbortSignal): Promise<void> {
  let opened = false;
  try {
    const reply = (await send({ type: 'gv.openPopup' })) as { ok?: unknown } | null;
    opened = reply?.ok === true;
  } catch {
    opened = false;
  }
  if (!opened && !life.aborted) {
    toast.show({
      render: () => [document.createTextNode(getTranslationSync('pm_settings_fallback'))],
    });
  }
}

export function createPanelController(deps: PanelControllerDeps): PanelController {
  const origin = extensionOrigin();
  const life = new AbortController();
  const relay = createPreviewRelay();
  const siteKey = (): string => readPanelContext().siteId ?? location.host;
  let frame: PanelFrame | null = null;
  let focus: FocusSnapshot | null = null;
  let press: { snapshot: FocusSnapshot | null; at: number } | null = null;
  let position: PanelPoint | null = null;
  let context: PanelContext | null = null;

  const restoreFocus = (): void => {
    const active = document.activeElement;
    // Only take focus back from the panel itself, or when focus was lost with it.
    if (active && active !== document.body && !(frame?.contains(active) ?? false)) return;
    focus?.restore();
  };

  const anchorCenter = (anchor: PanelAnchor): { x: number; y: number } | null =>
    anchor ? (deps.entry()?.anchorCenter(anchor) ?? null) : null;

  function requesting(stay: PanelStay<'requesting'>): void {
    context = readPanelContext();
    const seed = context;
    void (async () => {
      try {
        const [raw, saved] = await Promise.all([
          send({ type: PANEL_MESSAGE.tokenIssue, payload: { context: seed } }),
          readPanelPosition(siteKey()),
        ]);
        if (stay.signal.aborted) return;
        position = saved;
        const reply = parsePanelTokenIssueReply(raw);
        if (reply?.ok && origin && reply.panelUrl === `${origin}/${PANEL_PAGE_PATH}`) {
          const url = stay.state().keyboard ? `${reply.panelUrl}#keyboard` : reply.panelUrl;
          stay.send({ type: 'issued', url, token: reply.token });
          return;
        }
      } catch (error) {
        if (stay.signal.aborted) return;
        logger.warn('Panel token request failed', { error: String(error) });
      }
      stay.send({ type: 'refused' });
      void openPopupInstead(deps.toast, life.signal);
    })();
  }

  function handle(message: PanelShellMessage, current: PanelFrame, stay: PanelStay<'shown'>): void {
    switch (message.kind) {
      case PANEL_SHELL_MESSAGE.preview:
        relay.push(message);
        return;
      case PANEL_SHELL_MESSAGE.previewEnd:
        relay.end('settle');
        return;
      case PANEL_SHELL_MESSAGE.dragStart:
        current.dragStart();
        return;
      case PANEL_SHELL_MESSAGE.dragMove:
        current.dragMove(message.deltaX, message.deltaY);
        return;
      case PANEL_SHELL_MESSAGE.dragEnd:
        position = current.dragEnd(message.deltaX, message.deltaY);
        void writePanelPosition(siteKey(), position);
        return;
      case PANEL_SHELL_MESSAGE.recenter:
        position = null;
        current.glideToCenter();
        void writePanelPosition(siteKey(), null);
        return;
      case PANEL_SHELL_MESSAGE.fade:
        current.setPeek(message.faded);
        return;
      case PANEL_SHELL_MESSAGE.close:
        stay.send({ type: 'close' });
        return;
      case PANEL_SHELL_MESSAGE.focusReturn:
        focus?.restore();
        return;
      default: {
        const exhaustive: never = message;
        return exhaustive;
      }
    }
  }

  function shown(stay: PanelStay<'shown'>): void {
    const { scope } = stay;
    if (!origin) {
      stay.send({ type: 'gone' });
      return;
    }
    // Opening again while the close plays keeps the frame, and its session.
    const { url, token } = stay.state();
    const current =
      frame ??
      createPanelFrame(url, {
        token,
        origin,
        onInvalidated: () => machine.send({ type: 'gone' }),
      });
    frame = current;
    const seed = context ?? readPanelContext();
    current.setScheme(seed.scheme);
    current.place(position);
    current.playOpen(anchorCenter(stay.state().anchor));
    current.iframe.focus({ preventScroll: true });

    scope.on(window, 'message', (event: Event) => {
      // A page script can dispatch a MessageEvent that names this frame and the
      // extension's origin; only one the browser delivered is trusted.
      if (!isUserEvent(event)) return;
      const { source, origin: sender, data } = event as MessageEvent;
      if (stay.signal.aborted || !origin) return;
      // Only this frame, only the extension: any page can post to the window.
      if (source !== current.iframe.contentWindow || sender !== origin) return;
      const message = parsePanelShellMessage(data);
      if (message) handle(message, current, stay);
    });
    scope.on(window, 'resize', () => current.place(position), { passive: true });
    scope.on(
      window,
      'keydown',
      (event: KeyboardEvent) => {
        if (event.key !== 'Escape' || event.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        stay.send({ type: 'close' });
      },
      { capture: true },
    );
    scope.on(
      document,
      'pointerdown',
      (event: PointerEvent) => {
        const target = event.target;
        if (!(target instanceof Node) || isVoyagerLayerEvent(event)) return;
        const entry = deps.entry();
        if (current.contains(target) || deps.toast.contains(target)) return;
        if (entry?.contains(target)) return;
        if (entry && deps.ballTogglesPanel() && entry.ball.contains(target)) return;
        stay.send({ type: 'close' });
      },
      { capture: true },
    );
    scope.effect(() =>
      watchPanelContext(seed, (next) => {
        context = next;
        current.setScheme(next.scheme);
        void send({ type: PANEL_MESSAGE.contextUpdate, payload: { context: next } }).catch(
          () => {},
        );
      }),
    );
    scope.effect(() => () => {
      relay.end('now');
      current.endInteraction();
    });
  }

  function closing(stay: PanelStay<'closing'>): void {
    restoreFocus();
    const current = frame;
    if (!current) {
      stay.send({ type: 'closed' });
      return;
    }
    void current.playClose(anchorCenter(stay.state().anchor)).then(() => {
      stay.send({ type: 'closed' });
    });
  }

  const machine: Machine<PanelState, PanelEvent> = startMachine<PanelState, PanelEvent>(
    { id: 'panel-shell', transition: transitionPanel, effects: { requesting, shown, closing } },
    PANEL_CLOSED,
  );

  /** Leaving for closed from any phase: the frame goes and the background revokes it. */
  const release = (from: PanelState): void => {
    if (from.status === 'shown') restoreFocus();
    frame?.destroy();
    frame = null;
    relay.end('now');
    void send({ type: PANEL_MESSAGE.close }).catch(() => {});
  };

  machine.subscribe((state, previous) => {
    if (state.status === 'closed' && previous.status !== 'closed') release(previous);
    if (isPanelOpen(state) === isPanelOpen(previous)) return;
    deps.onOpenChange(isPanelOpen(state));
    // Prompt Manager's panel and the Research Pack step aside, as this one does for them.
    if (isPanelOpen(state)) announceSurfaceOpened('voyager-panel');
  });
  const stopSurfaceWatch = onOtherSurfaceOpened('voyager-panel', () => {
    if (isPanelOpen(machine.state)) machine.send({ type: 'close' });
  });

  const open = (anchor: PanelAnchor, toggle: boolean, options: PanelOpenOptions = {}): void => {
    if (!isPanelOpen(machine.state)) {
      const recent = press && Date.now() - press.at < PRESS_MS ? press.snapshot : undefined;
      focus = recent === undefined ? captureFocus() : recent;
    }
    press = null;
    const keyboard = options.keyboard === true;
    machine.send(
      toggle ? { type: 'toggle', anchor, keyboard } : { type: 'open', anchor, keyboard },
    );
  };

  return {
    open: (anchor, options) => open(anchor, false, options),
    toggle: (anchor, options) => open(anchor, true, options),
    close: () => machine.send({ type: 'close' }),
    isOpen: () => isPanelOpen(machine.state),
    notePress() {
      press = { snapshot: captureFocus(), at: Date.now() };
    },
    async stop() {
      life.abort();
      stopSurfaceWatch();
      const wasOpen = machine.state.status !== 'closed';
      await machine.stop();
      frame?.destroy();
      frame = null;
      relay.end('now');
      if (wasOpen) void send({ type: PANEL_MESSAGE.close }).catch(() => {});
    },
  };
}
