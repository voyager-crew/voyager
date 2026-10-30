/**
 * States of the export selection session (`exportSelectionSession.ts`).
 *
 *   selecting ──selectRole (unknown roles)──▶ resolvingRoles ──rolesResolved/rolesFailed──▶ selecting
 *   selecting ──exportClicked──▶ confirming ──selectionTaken──▶ exporting ──confirmSettled──▶ ended
 *   any live status ──cancel/externalCancel/route change──▶ ended
 *
 * The selection UI is mounted while the session is in `selecting`,
 * `resolvingRoles` or `confirming`, and removed on entering `exporting` or
 * `ended`. `confirming` (Export clicked, UI still shown while `onConfirm`
 * waits on the user gesture) freezes the selection; `exporting` (UI removed,
 * export running) only waits for `onConfirm` to settle.
 */
import { logger } from '@/core/services/LoggerService';
import type { MachineDefinition, Stay } from '@/features/plugins/runtime/stateMachine';

import type { ChatGptTurnRole } from './adapter/type';
import type { ExportMessage, ExportMessageRole } from './conversationCollector';
import { isAbortError } from './exportCancellation';
import { resolveInitialSelectedMessageIds, shouldRefreshSelectionUi } from './selectionUtils';

export const SELECTION_REFRESH_DELAY_MS = 250;

export type SelectableRole = Exclude<ExportMessageRole, 'unknown'>;

export interface SelectionMessage {
  readonly id: string;
  readonly role: ExportMessageRole;
}

export interface SelectionData {
  /** Selectable messages on the page, in reading order. */
  readonly messages: readonly SelectionMessage[];
  readonly selected: ReadonlySet<string>;
  /** Select all is on: messages that load later are selected too. */
  readonly autoSelectAll: boolean;
  /** Message to preselect once it appears. */
  readonly pendingInitialId: string | null;
}

export type ExportSelectionEndReason =
  | 'exported'
  | 'cancelled'
  | 'routeChanged'
  | 'external'
  | 'initFailed';

export type ExportSelectionState =
  | ({ readonly status: 'selecting' } & SelectionData)
  | ({ readonly status: 'resolvingRoles'; readonly role: SelectableRole } & SelectionData)
  | ({ readonly status: 'confirming' } & SelectionData)
  | { readonly status: 'exporting' }
  | { readonly status: 'ended'; readonly reason: ExportSelectionEndReason };

export type ExportSelectionEvent =
  | { readonly type: 'toggle'; readonly id: string }
  | { readonly type: 'selectAll' }
  | { readonly type: 'selectRole'; readonly role: SelectableRole }
  | { readonly type: 'rolesResolved'; readonly roles: ReadonlyMap<string, ChatGptTurnRole> }
  | { readonly type: 'rolesFailed' }
  | { readonly type: 'exportClicked' }
  | { readonly type: 'selectionTaken' }
  | { readonly type: 'confirmSettled' }
  /** Cancel button, Escape. */
  | { readonly type: 'cancel' }
  /** The caller ended the session (`session.cancel()`) or aborted its export signal. */
  | { readonly type: 'externalCancel' }
  /** `messages` is ignored when the page shows another conversation. */
  | {
      readonly type: 'refreshTick';
      readonly sameConversation: boolean;
      readonly messages: readonly SelectionMessage[];
    }
  | { readonly type: 'initFailed' };

/** Statuses during which the selection UI is on the page. */
export type SelectionUiState = Extract<ExportSelectionState, SelectionData>;

/** `selectAll` starts with every message selected, unless one message was asked for. */
export function initialSelectionState(
  initialSelectedId: string | null,
  selectAll = false,
): ExportSelectionState {
  return {
    status: 'selecting',
    messages: [],
    selected: new Set(),
    autoSelectAll: selectAll && initialSelectedId === null,
    pendingInitialId: initialSelectedId,
  };
}

export function hasSelectionUi(state: ExportSelectionState): state is SelectionUiState {
  return (
    state.status === 'selecting' ||
    state.status === 'resolvingRoles' ||
    state.status === 'confirming'
  );
}

export function isAllSelected(data: SelectionData): boolean {
  return data.messages.length > 0 && data.selected.size === data.messages.length;
}

export function isOnlyRoleSelected(data: SelectionData, role: SelectableRole): boolean {
  const roleIds = data.messages.filter((m) => m.role === role).map((m) => m.id);
  return (
    roleIds.length > 0 &&
    data.selected.size === roleIds.length &&
    roleIds.every((id) => data.selected.has(id))
  );
}

function dataOf(state: SelectionUiState): SelectionData {
  const { messages, selected, autoSelectAll, pendingInitialId } = state;
  return { messages, selected, autoSelectAll, pendingInitialId };
}

function syncMessages(data: SelectionData, read: readonly SelectionMessage[]): SelectionData {
  // The page reads some roles as unknown; a refresh must not forget roles resolved earlier.
  const knownRoles = new Map(data.messages.map((m) => [m.id, m.role]));
  const messages = read.map((m) =>
    m.role === 'unknown' ? { ...m, role: knownRoles.get(m.id) ?? 'unknown' } : m,
  );
  const ids = messages.map((m) => m.id);
  let selected = data.autoSelectAll
    ? new Set(ids)
    : new Set(ids.filter((id) => data.selected.has(id)));
  let pendingInitialId = data.pendingInitialId;
  const initial = resolveInitialSelectedMessageIds(ids, pendingInitialId);
  if (initial.size > 0) {
    selected = new Set([...selected, ...initial]);
    pendingInitialId = null;
  }
  return { ...data, messages, selected, pendingInitialId };
}

function selectOnlyRole(data: SelectionData, role: SelectableRole): SelectionData {
  const selected = isOnlyRoleSelected(data, role)
    ? new Set<string>()
    : new Set(data.messages.filter((m) => m.role === role).map((m) => m.id));
  return { ...data, selected, autoSelectAll: false };
}

function endOnCancel(
  state: ExportSelectionState,
  event: ExportSelectionEvent,
): ExportSelectionState | null {
  if (event.type === 'cancel') return { status: 'ended', reason: 'cancelled' };
  if (event.type === 'externalCancel') return { status: 'ended', reason: 'external' };
  // Every status that still shows the bar ends on a route change, including the permission wait.
  if (event.type === 'refreshTick' && !event.sameConversation && hasSelectionUi(state)) {
    return { status: 'ended', reason: 'routeChanged' };
  }
  return null;
}

function selectingTransition(
  state: Extract<ExportSelectionState, { status: 'selecting' }>,
  event: ExportSelectionEvent,
): ExportSelectionState {
  const data = dataOf(state);
  switch (event.type) {
    case 'toggle': {
      if (!data.messages.some((m) => m.id === event.id)) return state;
      const selected = new Set(data.selected);
      if (!selected.delete(event.id)) selected.add(event.id);
      return { status: 'selecting', ...data, selected, autoSelectAll: false };
    }
    case 'selectAll':
      return isAllSelected(data)
        ? { status: 'selecting', ...data, selected: new Set(), autoSelectAll: false }
        : {
            status: 'selecting',
            ...data,
            selected: new Set(data.messages.map((m) => m.id)),
            autoSelectAll: true,
          };
    case 'selectRole':
      return data.messages.some((m) => m.role === 'unknown')
        ? { status: 'resolvingRoles', role: event.role, ...data, autoSelectAll: false }
        : { status: 'selecting', ...selectOnlyRole(data, event.role) };
    case 'exportClicked':
      return data.selected.size > 0 ? { status: 'confirming', ...data } : state;
    case 'refreshTick':
      return { status: 'selecting', ...syncMessages(data, event.messages) };
    case 'initFailed':
      return { status: 'ended', reason: 'initFailed' };
    default:
      return state;
  }
}

function resolvingRolesTransition(
  state: Extract<ExportSelectionState, { status: 'resolvingRoles' }>,
  event: ExportSelectionEvent,
): ExportSelectionState {
  const data = dataOf(state);
  switch (event.type) {
    case 'rolesResolved': {
      const messages = data.messages.map((m) => ({ ...m, role: event.roles.get(m.id) ?? m.role }));
      return { status: 'selecting', ...selectOnlyRole({ ...data, messages }, state.role) };
    }
    case 'rolesFailed':
      return { status: 'selecting', ...data };
    case 'refreshTick':
      return { ...state, ...syncMessages(data, event.messages) };
    default:
      return state;
  }
}

export function exportSelectionTransition(
  state: ExportSelectionState,
  event: ExportSelectionEvent,
): ExportSelectionState {
  if (state.status === 'ended') return state;
  const ended = endOnCancel(state, event);
  if (ended) return ended;
  switch (state.status) {
    case 'selecting':
      return selectingTransition(state, event);
    case 'resolvingRoles':
      return resolvingRolesTransition(state, event);
    case 'confirming':
      // onConfirm owns this selection now: a second Export, a checkbox or a refresh
      // during its permission wait must not start another export or change it.
      if (event.type === 'selectionTaken') return { status: 'exporting' };
      // onConfirm returned without taking the selection: still remove the UI.
      if (event.type === 'confirmSettled') return { status: 'ended', reason: 'exported' };
      return state;
    case 'exporting':
      return event.type === 'confirmSettled' ? { status: 'ended', reason: 'exported' } : state;
  }
}

export interface ExportSelectionConfirmationHandle {
  takeSelection: () => ReadonlySet<string>;
}

export interface ExportSelectionEffectDeps {
  /** Aborting it ends the session. */
  readonly signal?: AbortSignal;
  readonly conversationRoot: () => Node;
  readonly isSameConversation: () => boolean;
  /** Read the page's messages and bind a checkbox to each; throws like `readMessages`. */
  readonly bindMessages: () => readonly ExportMessage[];
  readonly resolveRoles?: (
    messageIds: ReadonlySet<string>,
  ) => Promise<ReadonlyMap<string, ChatGptTurnRole>>;
  readonly reportRoleError: (error: unknown) => void;
  readonly onConfirm: (confirmation: ExportSelectionConfirmationHandle) => Promise<void>;
  /**
   * Report that onConfirm settled. It starts in `confirming` and usually
   * settles in `exporting`, so it cannot use the `confirming` stay's send.
   */
  readonly confirmSettled: () => void;
  /** Remove the selection UI synchronously; a no-op once removed. */
  readonly removeUi: () => void;
  readonly abortExport: () => void;
  readonly ended: (reason: ExportSelectionEndReason) => void;
}

type SessionStay = Stay<ExportSelectionState, ExportSelectionEvent>;

export function toSelectionMessages(messages: readonly ExportMessage[]): SelectionMessage[] {
  return messages.map((m) => ({ id: m.messageId, role: m.role }));
}

function watchCancel(stay: SessionStay, signal: AbortSignal | undefined): void {
  stay.scope.on(document, 'keydown', (event) => {
    if (event.key === 'Escape') stay.send({ type: 'cancel' });
  });
  if (signal) stay.scope.on(signal, 'abort', () => stay.send({ type: 'externalCancel' }));
}

/** Follow route changes, and lazy-loaded messages while the selection can still change. */
function watchRefresh(
  stay: SessionStay,
  deps: ExportSelectionEffectDeps,
  { followMessages }: { followMessages: boolean },
): void {
  let scheduled = false;
  const refresh = () => {
    scheduled = false;
    if (stay.signal.aborted) return;
    if (!deps.isSameConversation()) {
      stay.send({ type: 'refreshTick', sameConversation: false, messages: [] });
      return;
    }
    // A frozen selection binds no checkbox to messages that load meanwhile.
    if (!followMessages) return;
    try {
      const messages = toSelectionMessages(deps.bindMessages());
      stay.send({ type: 'refreshTick', sameConversation: true, messages });
    } catch {}
  };
  const schedule = () => {
    // The observer can deliver after the stay began tearing down its scope.
    if (scheduled || stay.signal.aborted) return;
    scheduled = true;
    stay.scope.timer(refresh, SELECTION_REFRESH_DELAY_MS);
  };
  try {
    stay.scope.observe(
      deps.conversationRoot(),
      { attributes: true, attributeFilter: ['class'], childList: true, subtree: true },
      (mutations) => {
        if (shouldRefreshSelectionUi(mutations)) schedule();
      },
    );
  } catch {}
  // Mutations that landed while the previous status's observer was torn down.
  schedule();
}

export function exportSelectionMachine(
  deps: ExportSelectionEffectDeps,
): MachineDefinition<ExportSelectionState, ExportSelectionEvent> {
  return {
    id: 'exportSelection',
    transition: exportSelectionTransition,
    effects: {
      selecting: (stay) => {
        watchCancel(stay, deps.signal);
        watchRefresh(stay, deps, { followMessages: true });
      },
      resolvingRoles: (stay) => {
        watchCancel(stay, deps.signal);
        watchRefresh(stay, deps, { followMessages: true });
        const { messages } = stay.state();
        const resolveRoles = deps.resolveRoles;
        if (!resolveRoles) {
          stay.send({ type: 'rolesResolved', roles: new Map() });
          return;
        }
        const ids = new Set(messages.map((m) => m.id));
        void (async () => resolveRoles(ids))().then(
          (roles) => stay.send({ type: 'rolesResolved', roles }),
          (error: unknown) => {
            if (stay.signal.aborted) return;
            if (!isAbortError(error)) deps.reportRoleError(error);
            stay.send({ type: 'rolesFailed' });
          },
        );
      },
      confirming: (stay) => {
        watchCancel(stay, deps.signal);
        watchRefresh(stay, deps, { followMessages: false });
        // Start onConfirm outside this event's drain: a takeSelection call made
        // before its first await must have removed the UI when it returns.
        void Promise.resolve()
          .then(() => {
            if (stay.signal.aborted) return;
            return deps.onConfirm({
              takeSelection: () => {
                // Already taken, or the session was cancelled meanwhile.
                if (stay.signal.aborted) return new Set<string>();
                const { selected } = stay.state();
                stay.send({ type: 'selectionTaken' });
                return new Set(selected);
              },
            });
          })
          .catch((error: unknown) => {
            logger.warn('Export selection confirm failed', { error: String(error) });
          })
          .then(() => deps.confirmSettled());
      },
      exporting: () => {
        // Cleanup before capture/export so selection UI is not included in screenshots.
        deps.removeUi();
      },
      ended: (stay) => {
        const { reason } = stay.state();
        if (reason === 'cancelled' || reason === 'routeChanged') deps.abortExport();
        deps.removeUi();
        deps.ended(reason);
      },
    },
  };
}
