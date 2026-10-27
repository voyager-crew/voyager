import { vi } from 'vitest';

import { createVimPresentation } from '@/pages/content/chatInput/vimPresentation';
import {
  mockRect,
  nextFrame,
} from '@/pages/content/export/__tests__/persistentExportToolbarHarness';
import { alignToConversationCenter } from '@/pages/content/export/exportOverlayUi';
import { mountPersistentExportToolbar } from '@/pages/content/export/persistentExportToolbar';
import { resolvePromptSiteAdapter } from '@/pages/content/prompt/resolvePromptSiteAdapter';
import { clearOfPromptTrigger } from '@/pages/content/prompt/triggerClearance';

export interface PlacementFixture {
  readonly selector: string;
  readonly target: HTMLElement;
  readonly measure: () => Promise<string>;
  readonly dispose: () => void;
}
const node = (id: string) => document.getElementById(id)!;
function bounds(element: HTMLElement, left: number, width: number, height = 100) {
  mockRect(element, { left, width, height, right: left + width, top: 8, bottom: height + 8 });
}

export function vimFixture(key: string): PlacementFixture {
  const hud =
    '<toolbox-drawer><div id="baseline" class="toolbox-drawer-container"></div></toolbox-drawer>';
  let markup = '';
  let selector = '#target';
  if (key === 'vim.host')
    markup = `${hud}<section id="target"><textarea id="input"></textarea></section>`;
  if (key === 'vim.inputFallback') {
    markup =
      '<section id="baseline"><rich-textarea></rich-textarea></section><section id="target"><div id="marker"></div></section>';
    selector = '#marker';
  }
  if (key === 'vim.mountInput' || key === 'vim.mountChatInput') {
    markup = `${hud}<${key === 'vim.mountInput' ? 'form' : 'fieldset'} id="target"><textarea id="input"></textarea></${key === 'vim.mountInput' ? 'form' : 'fieldset'}>`;
    selector = '#input';
  }
  if (key === 'vim.mountRoot')
    markup =
      '<form id="baseline"><section id="target"><div id="prompt-textarea" contenteditable="true"></div></section></form>';
  if (key === 'vim.mountChatRoot')
    markup =
      '<fieldset id="baseline"><section id="target"><div id="input" data-testid="chat-input" contenteditable="true"></div></section></fieldset>';
  document.body.innerHTML = markup;
  document.querySelectorAll<HTMLElement>('*').forEach((element) => bounds(element, 100, 400));
  const input = node('input') ?? node('prompt-textarea');
  const presentation = createVimPresentation(
    () => ({
      activeInput: input,
      isEnabled: true,
      mode: 'normal',
      buffer: '',
      composerSelector: null,
    }),
    () => input,
  );
  return {
    selector,
    target: node('target'),
    measure: async () => {
      presentation.updateHud();
      return document.querySelector('.gv-input-vim-hud')?.parentElement?.id ?? '';
    },
    dispose: presentation.dispose,
  };
}

export function layoutFixture(key: string): PlacementFixture {
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280);
  let markup =
    '<button aria-label="Upgrade" id="baseline"></button><section id="target"></section>';
  let selector = '#target';
  const alignment = [
    'overlaySidebar',
    'fallbackRoot',
    'alignmentCanvas',
    'alignmentComposer',
  ].includes(key);
  if (key === 'canvasOwner')
    markup =
      '<immersive-panel id="target"><inline-preview><code-immersive-panel></code-immersive-panel></inline-preview></immersive-panel>';
  if (key === 'canvasContent')
    markup = '<immersive-panel><section id="target"></section></immersive-panel>';
  if (key === 'fullscreenCanvas')
    markup =
      '<inline-preview id="target"><code-immersive-panel></code-immersive-panel></inline-preview>';
  if (key === 'inactiveCanvas')
    markup =
      '<immersive-panel id="target"><code-immersive-panel></code-immersive-panel></immersive-panel>';
  if (key === 'turns') markup = '<button aria-label="Upgrade" id="target"></button>';
  if (key === 'overlaySidebar') markup = '<div id="chat-history"></div>';
  if (key === 'fallbackRoot') markup = '<main id="baseline"></main><section id="target"></section>';
  if (key === 'alignmentCanvas')
    markup = '<div id="chat-history"></div><section id="target"></section>';
  if (key === 'alignmentComposer')
    markup = '<rich-textarea id="baseline"></rich-textarea><section id="target"></section>';
  if (key === 'overlaySidebar') selector = '#chat-history';
  document.body.innerHTML = markup;
  if (node('baseline')) bounds(node('baseline'), alignment ? 300 : 1000, alignment ? 500 : 120);
  if (node('target')) bounds(node('target'), alignment ? 600 : 800, alignment ? 500 : 120);
  if (node('chat-history')) bounds(node('chat-history'), 300, 500);
  document
    .querySelectorAll<HTMLElement>('code-immersive-panel')
    .forEach((element) => bounds(element, 400, 600));
  const target = node('target') ?? node('chat-history');
  let dispose = () => {};
  return {
    selector,
    target,
    measure: async () => {
      dispose();
      if (alignment) {
        const bar = document.createElement('div');
        bar.className = 'gv-export-selection-bar';
        document.body.append(bar);
        const stop = alignToConversationCenter(bar, {
          topUserElement: () => null,
          conversationRoot: () => document.body,
        });
        dispose = () => {
          stop();
          bar.remove();
        };
        return bar.style.left;
      }
      const toolbar = mountPersistentExportToolbar({
        label: 'Export',
        tooltip: 'Export',
        onClick: () => {},
      });
      dispose = toolbar.remove;
      await nextFrame();
      return `${toolbar.root.style.getPropertyValue('--gv-persistent-export-right')}/${toolbar.root.classList.contains('gv-hidden')}`;
    },
    dispose: () => dispose(),
  };
}

export function promptFixture(key: string): PlacementFixture {
  document.body.innerHTML =
    key === 'input.clearance'
      ? '<form><section id="target"><textarea></textarea></section></form>'
      : '<section id="target"></section>';
  const target = node('target');
  if (key === 'input.clearance') {
    mockRect(document.querySelector('form')!, {
      left: 500,
      top: 400,
      width: 300,
      height: 150,
      right: 800,
      bottom: 550,
    });
    mockRect(target, { left: 100, top: 100, width: 300, height: 50, right: 400, bottom: 150 });
    mockRect(document.querySelector('textarea')!, {
      left: 150,
      top: 150,
      width: 100,
      height: 30,
      right: 250,
      bottom: 180,
    });
  } else bounds(target, 600, 80);
  return {
    selector: '#target',
    target,
    dispose: () => {},
    measure: async () =>
      JSON.stringify(
        key === 'input.clearance'
          ? clearOfPromptTrigger({ x: 110, y: 110, w: 30, h: 30 })
          : (resolvePromptSiteAdapter(document.location.href).defaultTriggerSpot?.(46) ?? null),
      ),
  };
}
