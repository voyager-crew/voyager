import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DialogNode } from '@/features/contextSync/types';
import { PluginScope } from '@/features/plugins/runtime/pluginScope';
import { setCachedLanguage } from '@/utils/i18n';

import { activateGeminiContextSync } from '../pluginHandler';

const { captureDialogue, syncToIDE } = vi.hoisted(() => ({
  captureDialogue: vi.fn(),
  syncToIDE: vi.fn(),
}));

vi.mock('../capture', () => ({
  ContextCaptureService: { getInstance: () => ({ captureDialogue }) },
}));
vi.mock('@/features/contextSync/services/SyncService', () => ({
  SyncService: { getInstance: () => ({ syncToIDE }) },
}));

type Listener = Parameters<typeof chrome.runtime.onMessage.addListener>[0];
let listeners: Set<Listener>;
let scope: PluginScope;

function dispatch(request: unknown, respond = vi.fn()) {
  return Array.from(listeners, (listener) => listener(request, {}, respond));
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(async () => {
  vi.clearAllMocks();
  await setCachedLanguage('en');
  listeners = new Set();
  vi.mocked(chrome.runtime.onMessage.addListener).mockImplementation((listener) => {
    listeners.add(listener);
  });
  vi.mocked(chrome.runtime.onMessage.removeListener).mockImplementation((listener) => {
    listeners.delete(listener);
  });
  captureDialogue.mockResolvedValue([]);
  syncToIDE.mockResolvedValue({ received: true });
  scope = new PluginScope();
});

afterEach(async () => {
  await scope.dispose();
  await setCachedLanguage('en');
});

describe('Gemini Context Sync plugin handler', () => {
  it('keeps the popup response channel open and returns the broker result', async () => {
    activateGeminiContextSync(scope);
    const data = [{ text: 'captured conversation' }] as DialogNode[];
    captureDialogue.mockResolvedValue(data);
    const respond = vi.fn();
    expect(dispatch({ action: 'sync_to_ide' }, respond)).toEqual([true]);
    await settle();
    expect(syncToIDE).toHaveBeenCalledWith(data);
    expect(respond).toHaveBeenCalledWith({ status: 'success', data: { received: true } });
  });

  it('ignores unrelated or malformed messages', () => {
    activateGeminiContextSync(scope);
    const respond = vi.fn();
    for (const message of [null, false, 'sync_to_ide', {}, { type: 'gv.syncToIDE' }]) {
      expect(dispatch(message, respond)).toEqual([undefined]);
    }
    expect(captureDialogue).not.toHaveBeenCalled();
    expect(respond).not.toHaveBeenCalled();
  });

  it('off refuses queued callbacks in the current app language without capturing', async () => {
    activateGeminiContextSync(scope);
    const staleListener = Array.from(listeners)[0];
    await scope.dispose();
    expect(dispatch({ action: 'sync_to_ide' })).toEqual([]);
    const respond = vi.fn();
    expect(staleListener({ action: 'sync_to_ide' }, {}, respond)).toBeUndefined();
    expect(respond).toHaveBeenCalledWith({
      status: 'error',
      message: 'Context Sync is disabled.',
    });
    await setCachedLanguage('zh');
    respond.mockClear();
    expect(staleListener({ action: 'sync_to_ide' }, {}, respond)).toBeUndefined();
    expect(respond).toHaveBeenCalledWith({
      status: 'error',
      message: '上下文同步已关闭。',
    });
    expect(captureDialogue).not.toHaveBeenCalled();
    expect(syncToIDE).not.toHaveBeenCalled();
  });

  it('finishes an accepted capture and transfer after the plugin is turned off', async () => {
    let finishCapture!: (data: DialogNode[]) => void;
    captureDialogue.mockReturnValue(
      new Promise<DialogNode[]>((resolve) => (finishCapture = resolve)),
    );
    activateGeminiContextSync(scope);
    const respond = vi.fn();
    dispatch({ action: 'sync_to_ide' }, respond);
    await scope.dispose();
    expect(listeners.size).toBe(0);
    finishCapture([]);
    await settle();
    expect(syncToIDE).toHaveBeenCalledOnce();
    expect(respond).toHaveBeenCalledWith({ status: 'success', data: { received: true } });
  });

  it('returns an accepted transfer failure after the plugin is turned off', async () => {
    let failTransfer!: (error: Error) => void;
    syncToIDE.mockReturnValue(new Promise((_, reject) => (failTransfer = reject)));
    activateGeminiContextSync(scope);
    const respond = vi.fn();
    dispatch({ action: 'sync_to_ide' }, respond);
    await settle();
    await scope.dispose();
    failTransfer(new Error('Code Editor Server not responding.'));
    await settle();
    expect(respond).toHaveBeenCalledWith({
      status: 'error',
      message: 'Code Editor Server not responding.',
    });
  });

  it('returns capture errors without sending an incomplete transfer', async () => {
    captureDialogue.mockRejectedValue(new Error('Capture failed'));
    activateGeminiContextSync(scope);
    const respond = vi.fn();
    dispatch({ action: 'sync_to_ide' }, respond);
    await settle();
    expect(syncToIDE).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith({ status: 'error', message: 'Capture failed' });
  });

  it('off then on admits each request once without duplicate listeners', async () => {
    activateGeminiContextSync(scope);
    const stopping = scope.dispose();
    scope = new PluginScope();
    activateGeminiContextSync(scope);
    await stopping;
    const respond = vi.fn();
    expect(listeners.size).toBe(1);
    expect(dispatch({ action: 'sync_to_ide' }, respond)).toEqual([true]);
    await settle();
    expect(captureDialogue).toHaveBeenCalledOnce();
    expect(syncToIDE).toHaveBeenCalledOnce();
    expect(respond).toHaveBeenCalledOnce();
  });
});
