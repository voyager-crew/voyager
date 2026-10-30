import { describe, expect, it } from 'vitest';

import {
  type ExportSelectionEvent,
  type ExportSelectionState,
  type SelectionMessage,
  exportSelectionTransition,
  initialSelectionState,
} from '../exportSelectionMachine';

const known: SelectionMessage[] = [
  { id: '1:u', role: 'user' },
  { id: '1:a', role: 'assistant' },
  { id: '2:u', role: 'user' },
];

function run(state: ExportSelectionState, ...events: ExportSelectionEvent[]): ExportSelectionState {
  return events.reduce(exportSelectionTransition, state);
}

function refresh(messages: readonly SelectionMessage[]): ExportSelectionEvent {
  return { type: 'refreshTick', sameConversation: true, messages };
}

function selecting(messages: readonly SelectionMessage[] = known, initialId: string | null = null) {
  return run(initialSelectionState(initialId), refresh(messages));
}

function selectedOf(state: ExportSelectionState): string[] {
  return 'selected' in state ? [...state.selected].sort() : [];
}

describe('exportSelectionTransition', () => {
  it('toggles a message and ignores ids that are not on the page', () => {
    const state = run(selecting(), { type: 'toggle', id: '1:a' }, { type: 'toggle', id: 'gone' });
    expect(selectedOf(state)).toEqual(['1:a']);
    expect(selectedOf(run(state, { type: 'toggle', id: '1:a' }))).toEqual([]);
  });

  it('starts with everything selected after a whole-thread read, unless one message was asked for', () => {
    expect(selectedOf(run(initialSelectionState(null, true), refresh(known)))).toEqual(
      known.map((m) => m.id).sort(),
    );
    expect(selectedOf(run(initialSelectionState('1:a', true), refresh(known)))).toEqual(['1:a']);
  });

  it('select all keeps selecting messages that load later until it is turned off', () => {
    const all = run(selecting(known.slice(0, 1)), { type: 'selectAll' });
    const grown = run(all, refresh(known));
    expect(selectedOf(grown)).toEqual(['1:a', '1:u', '2:u']);

    const off = run(grown, { type: 'selectAll' });
    expect(selectedOf(off)).toEqual([]);
    expect(selectedOf(run(off, refresh([...known, { id: '3:u', role: 'user' }])))).toEqual([]);
  });

  it('a manual toggle stops select all from picking up new messages', () => {
    const state = run(
      selecting(known.slice(0, 2)),
      { type: 'selectAll' },
      { type: 'toggle', id: '1:u' },
      refresh(known),
    );
    expect(selectedOf(state)).toEqual(['1:a']);
  });

  it('drops selected messages that left the page', () => {
    const state = run(selecting(), { type: 'toggle', id: '2:u' }, refresh(known.slice(0, 2)));
    expect(selectedOf(state)).toEqual([]);
  });

  it('preselects the requested message once it appears, and only once', () => {
    const waiting = selecting(known.slice(0, 1), '1:a');
    expect(selectedOf(waiting)).toEqual([]);
    const shown = run(waiting, refresh(known));
    expect(selectedOf(shown)).toEqual(['1:a']);
    const deselected = run(shown, { type: 'toggle', id: '1:a' }, refresh(known));
    expect(selectedOf(deselected)).toEqual([]);
  });

  it('a role filter on known roles applies at once and toggles off on a second press', () => {
    const users = run(selecting(), { type: 'selectRole', role: 'user' });
    expect(users.status).toBe('selecting');
    expect(selectedOf(users)).toEqual(['1:u', '2:u']);
    expect(selectedOf(run(users, { type: 'selectRole', role: 'user' }))).toEqual([]);
  });

  it('a role filter with unknown roles waits for them, then selects that role', () => {
    const unknown: SelectionMessage[] = [
      { id: 'a', role: 'unknown' },
      { id: 'b', role: 'unknown' },
    ];
    const resolving = run(selecting(unknown), { type: 'selectRole', role: 'assistant' });
    expect(resolving.status).toBe('resolvingRoles');

    const done = run(resolving, {
      type: 'rolesResolved',
      roles: new Map([
        ['a', 'user'],
        ['b', 'assistant'],
      ]),
    });
    expect(done.status).toBe('selecting');
    expect(selectedOf(done)).toEqual(['b']);
  });

  it('a refresh after roles resolved does not make the same role filter look them up again', () => {
    const unknown: SelectionMessage[] = [
      { id: 'a', role: 'unknown' },
      { id: 'b', role: 'unknown' },
    ];
    const resolved = run(
      selecting(unknown),
      { type: 'selectRole', role: 'assistant' },
      {
        type: 'rolesResolved',
        roles: new Map([
          ['a', 'user'],
          ['b', 'assistant'],
        ]),
      },
      refresh(unknown),
    );
    const toggledOff = run(resolved, { type: 'selectRole', role: 'assistant' });
    expect(toggledOff.status).toBe('selecting');
    expect(selectedOf(toggledOff)).toEqual([]);
  });

  it('a failed role lookup returns to selecting with the selection unchanged', () => {
    const unknown: SelectionMessage[] = [{ id: 'a', role: 'unknown' }];
    const state = run(
      selecting(unknown),
      { type: 'toggle', id: 'a' },
      { type: 'selectRole', role: 'user' },
      { type: 'rolesFailed' },
    );
    expect(state.status).toBe('selecting');
    expect(selectedOf(state)).toEqual(['a']);
  });

  it('ignores selection changes and Export while roles resolve, but follows the page', () => {
    const resolving = run(selecting([{ id: 'a', role: 'unknown' }]), {
      type: 'selectRole',
      role: 'user',
    });
    for (const event of [
      { type: 'toggle', id: 'a' },
      { type: 'selectAll' },
      { type: 'selectRole', role: 'assistant' },
      { type: 'exportClicked' },
    ] as const) {
      expect(exportSelectionTransition(resolving, event)).toBe(resolving);
    }
    const grown = run(resolving, refresh([{ id: 'a', role: 'unknown' }, ...known]));
    expect(grown).toMatchObject({ status: 'resolvingRoles', role: 'user' });
  });

  it('cancel during role resolution ends the session and late roles are ignored', () => {
    const resolving = run(selecting([{ id: 'a', role: 'unknown' }]), {
      type: 'selectRole',
      role: 'user',
    });
    const ended = run(resolving, { type: 'cancel' });
    expect(ended).toEqual({ status: 'ended', reason: 'cancelled' });
    expect(run(ended, { type: 'rolesResolved', roles: new Map([['a', 'user']]) })).toBe(ended);
  });

  it('Export needs a selection', () => {
    const empty = selecting();
    expect(exportSelectionTransition(empty, { type: 'exportClicked' })).toBe(empty);
    expect(run(empty, { type: 'toggle', id: '1:u' }, { type: 'exportClicked' }).status).toBe(
      'confirming',
    );
  });

  it('confirming freezes the selection until it is taken', () => {
    const confirming = run(selecting(), { type: 'toggle', id: '1:u' }, { type: 'exportClicked' });
    for (const event of [
      { type: 'toggle', id: '1:a' },
      { type: 'selectAll' },
      { type: 'selectRole', role: 'assistant' },
      { type: 'exportClicked' },
      refresh(known.slice(1)),
    ] as const) {
      expect(exportSelectionTransition(confirming, event)).toBe(confirming);
    }
    expect(run(confirming, { type: 'selectionTaken' })).toEqual({ status: 'exporting' });
  });

  it('leaving the conversation during the permission wait ends the session', () => {
    const confirming = run(selecting(), { type: 'toggle', id: '1:u' }, { type: 'exportClicked' });
    expect(run(confirming, { type: 'refreshTick', sameConversation: false, messages: [] })).toEqual(
      { status: 'ended', reason: 'routeChanged' },
    );
  });

  it('ends when the export settles, whether or not the selection was taken', () => {
    const confirming = run(selecting(), { type: 'toggle', id: '1:u' }, { type: 'exportClicked' });
    expect(run(confirming, { type: 'confirmSettled' })).toEqual({
      status: 'ended',
      reason: 'exported',
    });
    const exporting = run(confirming, { type: 'selectionTaken' });
    expect(exportSelectionTransition(exporting, { type: 'selectionTaken' })).toBe(exporting);
    expect(run(exporting, { type: 'confirmSettled' })).toEqual({
      status: 'ended',
      reason: 'exported',
    });
  });

  it('records why the session ended', () => {
    const confirming = run(selecting(), { type: 'toggle', id: '1:u' }, { type: 'exportClicked' });
    expect(run(confirming, { type: 'cancel' })).toEqual({ status: 'ended', reason: 'cancelled' });
    expect(run(confirming, { type: 'selectionTaken' }, { type: 'externalCancel' })).toEqual({
      status: 'ended',
      reason: 'external',
    });
    expect(
      run(selecting(), { type: 'refreshTick', sameConversation: false, messages: [] }),
    ).toEqual({ status: 'ended', reason: 'routeChanged' });
    expect(run(initialSelectionState(null), { type: 'initFailed' })).toEqual({
      status: 'ended',
      reason: 'initFailed',
    });
  });

  it('an ended session ignores every event', () => {
    const ended = run(selecting(), { type: 'cancel' });
    for (const event of [
      { type: 'selectAll' },
      { type: 'exportClicked' },
      { type: 'confirmSettled' },
      { type: 'externalCancel' },
      refresh(known),
    ] as const) {
      expect(exportSelectionTransition(ended, event)).toBe(ended);
    }
  });
});
