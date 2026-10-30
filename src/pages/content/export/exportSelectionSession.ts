import { resolveExportErrorMessage } from '../../../features/export/ui/ExportErrorMessage';
import { showExportAlert } from '../../../features/export/ui/exportToasts';
/**
 * Message selection mode shown before an export is written.
 *
 * Puts a checkbox on every message and a bar with Select all / Only user /
 * Only AI / count / Export / Cancel at the top of the conversation, keeps both
 * in sync while the host lazy-loads more messages, and ends on Export, Cancel,
 * Escape or a route change. The session's phases and data live in the state
 * machine of `exportSelectionMachine.ts`; this module owns the DOM: it mounts
 * the UI once, renders every state into it, and removes it synchronously when
 * the machine leaves the statuses that show it.
 */
import { startMachine } from '../../../features/plugins/runtime/stateMachine';
import type { ChatGptTurnRole } from './adapter/type';
import type { ExportMessage } from './conversationCollector';
import type { ExportTranslate } from './exportLocale';
import { type ConversationAnchors, alignToConversationCenter } from './exportOverlayUi';
import {
  type ExportSelectionEvent,
  type ExportSelectionState,
  type SelectionUiState,
  exportSelectionMachine,
  hasSelectionUi,
  initialSelectionState,
  isAllSelected,
  isOnlyRoleSelected,
  toSelectionMessages,
} from './exportSelectionMachine';
import { reconcileExistingSelectionHost } from './selectionUtils';

export interface ExportSelectionConfirmation {
  /**
   * Snapshot the selected message ids and remove the selection UI. Call it
   * after any work that needs the user gesture and before capturing the page.
   */
  takeSelection: () => ReadonlySet<string>;
}

export interface ExportSelectionSessionOptions {
  t: ExportTranslate;
  /** Signal of the export operation; aborting it ends the session. */
  signal?: AbortSignal;
  /** Abort the export operation. Called on Cancel, Escape and a route change. */
  abortExport: () => void;
  /** Selectable messages currently on the page, in reading order. */
  readMessages: () => ExportMessage[];
  /** Message to preselect once it appears (e.g. from a response menu). */
  initialSelectedMessageId: string | null;
  /** Start with every message selected: the source read the whole conversation. */
  selectAllInitially?: boolean;
  /** Conversation landmarks: the bar is centred on them and the root is observed. */
  anchors: ConversationAnchors;
  /** False once the page shows another conversation; the session then cancels itself. */
  isSameConversation: () => boolean;
  /**
   * Resolve roles for messages whose role is unknown (ChatGPT virtual list).
   * Called by the role filters only while some role is still unknown.
   */
  resolveRoles?: (messageIds: ReadonlySet<string>) => Promise<ReadonlyMap<string, ChatGptTurnRole>>;
  /**
   * Export the selection. Runs once, when Export is clicked with at least one
   * message selected; must handle its own errors. The session ends after it
   * settles.
   */
  onConfirm: (confirmation: ExportSelectionConfirmation) => Promise<void>;
}

export interface ExportSelectionSession {
  /** Resolves when the session ends: after export settles, on cancel, or on route change. */
  readonly done: Promise<void>;
  /** Remove the selection UI and end the session without exporting. */
  cancel: () => void;
}

interface SelectionView {
  /** Bind a checkbox to each message and drop bindings of messages that left the page. */
  bind(messages: readonly ExportMessage[]): void;
  render(state: SelectionUiState): void;
  /** Remove every node, class and listener the view added; a no-op once removed. */
  remove(): void;
}

interface MessageBinding {
  readonly host: HTMLElement;
  readonly selector: HTMLElement;
  readonly checkbox: HTMLButtonElement;
  readonly cleanup: () => void;
}

/** Gap between the shared left edge and every checkbox; matches `.gv-export-msg-selector`. */
const SELECTOR_INSET_PX = 8;
/** Width of `.gv-export-msg-checkbox`. */
const CHECKBOX_SIZE_PX = 20;
/** Room the checkbox column takes with a gap on each side; `.gv-export-msg-room` pads by it. */
const COLUMN_ROOM_PX = CHECKBOX_SIZE_PX + 2 * SELECTOR_INSET_PX;
const ROOM_CLASS = 'gv-export-msg-room';
const SVG_NS = 'http://www.w3.org/2000/svg';

function createCloseIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M18 6 6 18M6 6l12 12');
  svg.appendChild(path);
  return svg;
}

const PAINT_CONTAINMENT = /\b(?:paint|strict|content)\b/;

function clipsHorizontalPaint(el: Element): boolean {
  const style = window.getComputedStyle(el);
  const contentVisibility = style.getPropertyValue('content-visibility');
  if (contentVisibility === 'auto' || contentVisibility === 'hidden') return true;
  if (PAINT_CONTAINMENT.test(style.getPropertyValue('contain'))) return true;
  return style.overflowX !== '' && style.overflowX !== 'visible';
}

/**
 * Whether an element between a message and the conversation root would cut off
 * a checkbox placed at `columnLeft`: one that clips its paint and starts right
 * of that column.
 */
function clipsGutterColumn(
  hosts: readonly HTMLElement[],
  root: HTMLElement,
  columnLeft: number,
): boolean {
  const seen = new Set<Element>();
  for (const host of hosts) {
    for (let el: Element | null = host; el && el !== root; el = el.parentElement) {
      if (el === document.body || el === document.documentElement || seen.has(el)) break;
      seen.add(el);
      // A Gemini turn is `content-visibility: auto`, which clips paint and hit-testing to its box,
      // so a checkbox moved into the gutter outside it was invisible and clicks fell through.
      if (el.getBoundingClientRect().left > columnLeft && clipsHorizontalPaint(el)) return true;
    }
  }
  return false;
}

function swallow(ev: Event): void {
  try {
    ev.preventDefault();
  } catch {}
  try {
    ev.stopPropagation();
  } catch {}
}

function createBarButton(className: string, action: string | null, text: string) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  if (action) button.dataset.gvExportAction = action;
  button.textContent = text;
  return button;
}

function createSelectionView(
  t: ExportTranslate,
  anchors: ConversationAnchors,
  current: () => ExportSelectionState,
  send: (event: ExportSelectionEvent) => void,
): SelectionView {
  const cleanupTasks: Array<() => void> = [];
  const bindings = new Map<string, MessageBinding>();

  const isSelected = (id: string) => {
    const state = current();
    return hasSelectionUi(state) && state.selected.has(id);
  };

  document.body.classList.add('gv-export-select-mode');
  cleanupTasks.push(() => document.body.classList.remove('gv-export-select-mode'));

  const bar = document.createElement('div');
  bar.className = 'gv-export-select-bar';
  bar.dataset.gvExportSelectBar = 'true';

  const selectAllBtn = createBarButton(
    'gv-export-select-all-toggle',
    'selectAll',
    t('export_select_mode_select_all'),
  );
  const selectUserBtn = createBarButton(
    'gv-export-select-role-btn',
    'selectUser',
    t('export_select_mode_only_user'),
  );
  const selectAIBtn = createBarButton(
    'gv-export-select-role-btn',
    'selectAI',
    t('export_select_mode_only_ai'),
  );

  const count = document.createElement('div');
  count.className = 'gv-export-select-count';
  count.dataset.gvExportSelectionCount = 'true';
  count.textContent = t('export_select_mode_count').replace('{count}', '0');

  const exportBtn = createBarButton('gv-export-select-export-btn', 'export', t('pm_export'));
  exportBtn.disabled = true;

  const cancelBtn = createBarButton('gv-export-select-cancel-btn', null, '');
  cancelBtn.title = t('pm_cancel');
  cancelBtn.setAttribute('aria-label', t('pm_cancel'));
  cancelBtn.appendChild(createCloseIcon());

  bar.append(selectAllBtn, selectUserBtn, selectAIBtn, count, exportBtn, cancelBtn);
  document.body.appendChild(bar);
  cleanupTasks.push(() => bar.remove());
  cleanupTasks.push(alignToConversationCenter(bar, anchors));

  selectAllBtn.addEventListener('click', (ev) => {
    swallow(ev);
    send({ type: 'selectAll' });
  });
  selectUserBtn.addEventListener('click', (ev) => {
    swallow(ev);
    send({ type: 'selectRole', role: 'user' });
  });
  selectAIBtn.addEventListener('click', (ev) => {
    swallow(ev);
    send({ type: 'selectRole', role: 'assistant' });
  });
  cancelBtn.addEventListener('click', (ev) => {
    swallow(ev);
    send({ type: 'cancel' });
  });
  exportBtn.addEventListener('click', (ev) => {
    swallow(ev);
    const state = current();
    if (state.status === 'selecting' && state.selected.size === 0) {
      showExportAlert(t('export_select_mode_empty'), t, 'warning');
      return;
    }
    send({ type: 'exportClicked' });
  });

  const attach = (msg: ExportMessage): MessageBinding => {
    const host = msg.hostElement;
    host.classList.add('gv-export-msg-host');

    const selector = document.createElement('div');
    selector.className = 'gv-export-msg-selector';
    selector.dataset.gvExportMessageId = msg.messageId;

    const checkbox = document.createElement('button');
    checkbox.type = 'button';
    checkbox.className = 'gv-export-msg-checkbox';
    checkbox.setAttribute('aria-pressed', 'false');
    checkbox.title = t('export_select_mode_toggle');

    const mark = document.createElement('span');
    mark.className = 'gv-export-msg-checkbox-mark';
    checkbox.appendChild(mark);

    const toggle = () => send({ type: 'toggle', id: msg.messageId });
    checkbox.addEventListener('click', (ev) => {
      swallow(ev);
      toggle();
    });
    host.addEventListener('click', toggle);

    selector.appendChild(checkbox);
    host.appendChild(selector);

    return {
      host,
      selector,
      checkbox,
      cleanup: () => {
        host.removeEventListener('click', toggle);
        host.classList.remove('gv-export-msg-host', 'gv-export-msg-selected', ROOM_CLASS);
        selector.remove();
      },
    };
  };

  const removeBinding = (id: string) => {
    bindings.get(id)?.cleanup();
    bindings.delete(id);
  };

  // A user bubble and a response start at different x (Gemini right-aligns the bubble), so each
  // checkbox is moved onto the leftmost message edge to keep them in one column. A ChatGPT reply's
  // text starts at that edge, so a checkbox inside it covered the reply: when the conversation
  // leaves a gutter left of the edge, the column goes there instead. Otherwise the column stays
  // inside the messages, and a message starting under it gets room so its first characters show.
  const alignSelectors = () => {
    const placed = Array.from(bindings.values()).flatMap((binding) => {
      const rect = binding.host.getBoundingClientRect();
      return rect.width > 0 ? [{ binding, left: rect.left }] : [];
    });
    if (placed.length === 0) return;
    const edge = placed.reduce((min, { left }) => Math.min(min, left), Infinity);
    const root = anchors.conversationRoot();
    const gutter = edge - root.getBoundingClientRect().left;
    const gutterOffset = -(CHECKBOX_SIZE_PX + SELECTOR_INSET_PX);
    const inGutter =
      gutter >= COLUMN_ROOM_PX &&
      !clipsGutterColumn(
        placed.map(({ binding }) => binding.host),
        root,
        edge + gutterOffset,
      );
    const offset = inGutter ? gutterOffset : SELECTOR_INSET_PX;
    placed.forEach(({ binding, left }) => {
      binding.selector.style.left = `${Math.round(edge - left) + offset}px`;
      // A Gemini reply's text starts at the turn's left edge, which clips paint, so the checkbox
      // inside covered the reply's first characters. Padding only during selection keeps both.
      const needsRoom = !inGutter && Math.round(left - edge) < COLUMN_ROOM_PX;
      if (binding.host.classList.contains(ROOM_CLASS) !== needsRoom) {
        binding.host.classList.toggle(ROOM_CLASS, needsRoom);
      }
    });
  };
  window.addEventListener('resize', alignSelectors);
  cleanupTasks.push(() => window.removeEventListener('resize', alignSelectors));
  if (typeof ResizeObserver === 'function') {
    const rootResize = new ResizeObserver(() => alignSelectors());
    rootResize.observe(anchors.conversationRoot());
    cleanupTasks.push(() => rootResize.disconnect());
  }

  return {
    bind(messages) {
      const liveIds = new Set(messages.map((m) => m.messageId));
      for (const id of bindings.keys()) {
        if (!liveIds.has(id)) removeBinding(id);
      }
      for (const msg of messages) {
        // Virtual history stays selectable by role/all, but detached snapshots have no visible checkbox.
        if (!msg.hostElement.isConnected) {
          removeBinding(msg.messageId);
          continue;
        }
        const previous = bindings.get(msg.messageId);
        const selected = isSelected(msg.messageId);
        if (reconcileExistingSelectionHost(previous?.host, msg.hostElement, selected)) continue;
        removeBinding(msg.messageId);
        bindings.set(msg.messageId, attach(msg));
      }
      alignSelectors();
    },
    render(state) {
      const frozen = state.status !== 'selecting';
      count.textContent = t('export_select_mode_count').replace(
        '{count}',
        String(state.selected.size),
      );
      exportBtn.disabled = frozen || state.selected.size === 0;
      selectAllBtn.disabled = frozen;
      selectAllBtn.dataset.checked = isAllSelected(state) ? 'true' : 'false';
      selectUserBtn.disabled = frozen;
      selectUserBtn.dataset.checked = isOnlyRoleSelected(state, 'user') ? 'true' : 'false';
      selectAIBtn.disabled = frozen;
      selectAIBtn.dataset.checked = isOnlyRoleSelected(state, 'assistant') ? 'true' : 'false';
      bindings.forEach(({ host, checkbox }, id) => {
        const selected = state.selected.has(id);
        checkbox.setAttribute('aria-pressed', selected ? 'true' : 'false');
        checkbox.dataset.selected = selected ? 'true' : 'false';
        checkbox.disabled = frozen;
        host.classList.toggle('gv-export-msg-selected', selected);
      });
    },
    remove() {
      for (const id of bindings.keys()) removeBinding(id);
      for (const task of cleanupTasks.splice(0)) {
        try {
          task();
        } catch {}
      }
    },
  };
}

/**
 * Show the selection UI. Throws (after removing the UI) only if reading the
 * initial messages throws.
 */
export function startExportSelectionSession(
  options: ExportSelectionSessionOptions,
): ExportSelectionSession {
  const { t } = options;
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const view = createSelectionView(
    t,
    options.anchors,
    () => machine.state,
    (event) => machine.send(event),
  );
  const bindMessages = () => {
    const messages = options.readMessages();
    view.bind(messages);
    return messages;
  };

  const machine = startMachine(
    exportSelectionMachine({
      signal: options.signal,
      conversationRoot: () => options.anchors.conversationRoot(),
      isSameConversation: options.isSameConversation,
      bindMessages,
      resolveRoles: options.resolveRoles,
      reportRoleError: (error) => showExportAlert(resolveExportErrorMessage(error, t), t),
      onConfirm: options.onConfirm,
      confirmSettled: () => machine.send({ type: 'confirmSettled' }),
      removeUi: () => view.remove(),
      abortExport: options.abortExport,
      ended: () => resolveDone(),
    }),
    initialSelectionState(options.initialSelectedMessageId, options.selectAllInitially),
  );
  machine.subscribe((state) => {
    if (hasSelectionUi(state)) view.render(state);
  });
  void done.then(() => machine.stop());

  // Initial sync. A failure here removes the half-built UI before rethrowing,
  // since the caller never receives a handle to cancel it.
  try {
    const messages = toSelectionMessages(bindMessages());
    machine.send({ type: 'refreshTick', sameConversation: true, messages });
  } catch (error) {
    machine.send({ type: 'initFailed' });
    throw error;
  }
  return { done, cancel: () => machine.send({ type: 'externalCancel' }) };
}
