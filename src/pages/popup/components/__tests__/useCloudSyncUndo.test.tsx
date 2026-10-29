import React, { act, useEffect } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CloudSyncUndoResult } from '@/core/services/cloudSyncSnapshotTypes';

import { type CloudSyncUndo, useCloudSyncUndo } from '../useCloudSyncUndo';

const pending = vi.hoisted(() => ({ resolve: (_: unknown) => {} }));
vi.mock('@/core/services/CloudSyncSnapshotService', () => ({
  undoCloudSyncSnapshot: vi.fn(
    () =>
      new Promise((resolve) => {
        pending.resolve = resolve;
      }),
  ),
}));

describe('popup Undo lifetime', () => {
  let root: Root | undefined;
  afterEach(async () => {
    await act(async () => root?.unmount());
    root = undefined;
    vi.unstubAllGlobals();
  });

  async function mount(onSettled: (result: CloudSyncUndoResult) => void) {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    let undo!: CloudSyncUndo;
    function Harness() {
      const value = useCloudSyncUndo(onSettled);
      useEffect(() => {
        undo = value;
      }, [value]);
      return null;
    }
    await act(async () => {
      root = createRoot(document.createElement('div'));
      root.render(<Harness />);
    });
    return () => undo;
  }

  it('drops an undo that settles after the popup closed', async () => {
    const onSettled = vi.fn();
    const undo = await mount(onSettled);
    await act(async () => undo().offer('snapshot-1'));
    await act(async () => undo().undo());
    expect(undo().busy).toBe(true);

    await act(async () => root?.unmount());
    root = undefined;
    pending.resolve({ status: 'absent' });
    await act(async () => {});

    expect(onSettled).not.toHaveBeenCalled();
  });

  it('drops an undo that settles after a new action withdrew the offer', async () => {
    const onSettled = vi.fn();
    const undo = await mount(onSettled);
    await act(async () => undo().offer('snapshot-1'));
    await act(async () => undo().undo());
    await act(async () => undo().withdraw());
    pending.resolve({ status: 'absent' });
    await act(async () => {});

    expect(onSettled).not.toHaveBeenCalled();
    expect(undo().offered).toBe(false);
  });

  it('keeps Undo offered after a failed undo, so it can be retried', async () => {
    const onSettled = vi.fn();
    const undo = await mount(onSettled);
    await act(async () => undo().offer('snapshot-1'));
    await act(async () => undo().undo());
    await act(async () => pending.resolve({ status: 'failed', error: 'quota' }));

    expect(onSettled).toHaveBeenCalledWith({ status: 'failed', error: 'quota' });
    expect(undo().offered).toBe(true);
  });
});
