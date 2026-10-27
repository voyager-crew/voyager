import type { Mock } from 'vitest';

import { PluginScope } from '@/features/plugins/runtime/pluginScope';
import { startSiteDraftSave } from '@/features/plugins/verbs/draftSave/session';

import { geminiDraftPolicy } from '../geminiDraftPolicy';

/** Real draft session/storage format, with only browser persistence and layout supplied by the test. */
export function createOnlineDraftHarness() {
  const originalLocation = Object.getOwnPropertyDescriptor(window, 'location')!;
  const records: Record<string, unknown> = {};
  const scopes: PluginScope[] = [];
  const route = {
    pathname: '/u/0/app/source',
    hostname: 'gemini.google.com',
    origin: 'https://gemini.google.com',
    search: '',
    hash: '',
    get href() {
      return `${this.origin}${this.pathname}${this.search}${this.hash}`;
    },
  };
  Object.defineProperty(window, 'location', { configurable: true, value: route });
  (chrome.storage.local.get as unknown as Mock).mockImplementation(
    (key: string | null, callback?: (value: Record<string, unknown>) => void) => {
      const value = key === null ? { ...records } : { [key]: records[key] };
      callback?.(value);
      return Promise.resolve(value);
    },
  );
  (chrome.storage.local.set as unknown as Mock).mockImplementation(
    (value: Record<string, unknown>, callback?: () => void) => {
      Object.assign(records, value);
      callback?.();
      return Promise.resolve();
    },
  );
  (chrome.storage.local.remove as unknown as Mock).mockImplementation(
    (keys: string | string[], callback?: () => void) => {
      for (const key of typeof keys === 'string' ? [keys] : keys) delete records[key];
      callback?.();
      return Promise.resolve();
    },
  );

  return {
    records,
    route,
    start() {
      const scope = new PluginScope();
      scopes.push(scope);
      startSiteDraftSave(scope, geminiDraftPolicy(), document);
      return scope;
    },
    async stop() {
      await Promise.all(scopes.map((scope) => scope.dispose()));
      Object.defineProperty(window, 'location', originalLocation);
    },
  };
}

export function showDraftInputs(): void {
  for (const input of document.querySelectorAll('textarea, [contenteditable]')) {
    Object.defineProperty(input, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 100, width: 500 }),
    });
  }
  for (const button of document.querySelectorAll('button')) {
    Object.defineProperty(button, 'offsetParent', { configurable: true, value: document.body });
  }
}

export function typeDraft(input: HTMLTextAreaElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
