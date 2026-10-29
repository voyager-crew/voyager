import React, { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, expect, vi } from 'vitest';

import type { FolderData } from '@/core/types/folder';
import type { SyncState } from '@/core/types/sync';
import { confirmDriver } from '@/tests/confirmDriver';

import { CloudSyncSettings } from '../CloudSyncSettings';
import { baseState, createCloudSyncChromeMock, flushMicrotasks } from './cloudSyncChromeMock';
import { waitForCloudSyncAction } from './waitForCloudSyncAction';

export const cloudFolders: FolderData = {
  folders: [
    { id: 'cloud', name: 'Cloud', parentId: null, isExpanded: true, createdAt: 2, updatedAt: 2 },
  ],
  folderContents: {},
};
export const localFolders: FolderData = {
  folders: [
    { id: 'local', name: 'Local', parentId: null, isExpanded: true, createdAt: 1, updatedAt: 1 },
  ],
  folderContents: {},
};

type Message = { type?: string; payload?: unknown };

export interface FlowHarness {
  readonly container: HTMLElement;
  send: ReturnType<typeof vi.fn<(message: Message) => Promise<unknown>>>;
  chrome: typeof chrome;
  mount(
    respond: (message: Message) => unknown,
    initial?: Parameters<typeof createCloudSyncChromeMock>[1],
    state?: SyncState,
  ): Promise<void>;
  button(label: string): HTMLButtonElement | undefined;
  click(label: string): Promise<void>;
  /** Waits until the transfer buttons are back on. */
  settled(): Promise<void>;
  payloads(type: string): unknown[];
  status(): string;
  unmount(): Promise<void>;
}

/** Renders the popup's sync card on in-memory storage with the real owners. */
export function setupFlowHarness(): FlowHarness {
  let root: Root | undefined;
  const container = document.createElement('div');
  const h = {
    container,
    async mount(respond, initial, state = baseState) {
      h.send = vi.fn(async (message: Message) =>
        message.type === 'gv.sync.getState'
          ? { ok: true, state }
          : ((await respond(message)) ?? { ok: true }),
      );
      h.chrome = createCloudSyncChromeMock(h.send, initial);
      vi.stubGlobal('chrome', h.chrome);
      await act(async () => {
        root = createRoot(container);
        root.render(<CloudSyncSettings />);
      });
      await flushMicrotasks();
    },
    button: (label) =>
      Array.from(container.querySelectorAll('button')).find(
        (element) => element.textContent?.trim() === label,
      ),
    async click(label) {
      const button = h.button(label);
      expect(button).toBeDefined();
      await act(async () => button!.click());
    },
    settled: () => waitForCloudSyncAction(h.button('syncUpload')),
    payloads: (type) =>
      h.send.mock.calls.filter(([message]) => message.type === type).map(([m]) => m.payload),
    status: () => container.querySelector('[role="status"]')?.textContent ?? '',
    async unmount() {
      await act(async () => root?.unmount());
      root = undefined;
    },
  } as Omit<FlowHarness, 'send' | 'chrome'> as FlowHarness;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    document.body.appendChild(container);
  });
  afterEach(async () => {
    confirmDriver.pressEscape();
    await h.unmount();
    container.replaceChildren();
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  return h;
}
