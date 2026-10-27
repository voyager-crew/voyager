// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/c/health" }
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { initializeSiteSelectors } from '@/core/selectors';

import {
  catalogConsumerContext,
  catalogConsumerPage,
  catalogConsumerPatch,
  PluginScope,
} from './catalogConsumerFixture';
import { activateCodeBlockDiagram } from './codeBlockDiagram';
import { copyButtonPrimitive } from './copyButton';
import { quoteReplyPrimitive } from './quoteReply';
import { sendShortcutPrimitive } from './sendShortcut';
import { tableCopyPrimitive } from './tableCopy';
import { turnNavigatorPrimitive } from './turnNavigator';
import type { PrimitiveContext } from './types';
import { vimInputPrimitive } from './vimInput';

// The health API is independent of timeline persistence and its background request protocol.
vi.mock('@/features/timeline/adapters/catalog/activateCatalogTimeline', () => ({
  activateCatalogTimeline: () => undefined,
}));

let scope: PluginScope;
let retire: (() => void) | undefined;
beforeEach(() => {
  vi.mocked(chrome.storage.sync.get).mockImplementation((...args: unknown[]) => {
    const callback = args.find((arg) => typeof arg === 'function');
    if (typeof callback === 'function') callback({});
    return Promise.resolve({});
  });
});
const cases: Array<{ name: string; owner: string; activate: (context: PrimitiveContext) => void }> =
  [
    {
      name: 'copy',
      owner: 'main',
      activate: (context) => {
        void copyButtonPrimitive.activate(
          scope,
          { target: 'assistantTurn', format: 'text' },
          context,
        );
      },
    },
    {
      name: 'table',
      owner: 'main',
      activate: (context) => {
        void tableCopyPrimitive.activate(scope, {}, context);
      },
    },
    {
      name: 'quote',
      owner: 'main',
      activate: (context) => {
        void quoteReplyPrimitive.activate(scope, {}, context);
      },
    },
    {
      name: 'diagram',
      owner: 'main',
      activate: (context) =>
        activateCodeBlockDiagram(scope, {}, context, {
          name: 'mermaid',
          kind: 'mermaid',
          matches: () => false,
          prepare: async () => true,
          render: async () => {},
        }),
    },
    {
      name: 'timeline',
      owner: 'main',
      activate: (context) => {
        void turnNavigatorPrimitive.activate(scope, {}, context);
      },
    },
    {
      name: 'send shortcut',
      owner: 'form',
      activate: (context) => {
        void sendShortcutPrimitive.activate(scope, {}, context);
      },
    },
    {
      name: 'Vim',
      owner: 'form',
      activate: (context) => {
        void vimInputPrimitive.activate(scope, {}, context);
      },
    },
  ];
afterEach(async () => {
  await scope?.dispose();
  retire?.();
  retire = undefined;
  document.body.replaceChildren();
});

it.each(cases)(
  '$name health no longer counts an alias after its native owner becomes a dialog',
  async ({ owner, activate }) => {
    scope = new PluginScope();
    catalogConsumerPage();
    if (owner === 'main') retire = await catalogConsumerPatch();
    else {
      const input = document.querySelector('textarea')!;
      input.removeAttribute('id');
      input.className = 'renamed-input';
      const session = initializeSiteSelectors('chatgpt', {
        host: 'chatgpt.com',
        doc: document,
        lifetime: new AbortController().signal,
        bundledRevision: 0,
        read: async () => ({
          id: 'chatgpt',
          catalogRevision: 1,
          selectors: { composer: '.renamed-input', sendButton: 'form button' },
        }),
      });
      await session.ready;
      retire = session.stop;
    }
    let count = () => -1;
    activate({
      ...catalogConsumerContext(),
      setTargetCounter: (counter) => {
        count = counter;
      },
    });
    expect(count()).toBe(1);
    document.querySelector(owner)!.setAttribute('role', 'dialog');
    expect(count()).toBe(0);
    document.querySelector(owner)!.removeAttribute('role');
    expect(count()).toBe(1);
  },
);
