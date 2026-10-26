// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://gemini.google.com/app" }
/**
 * The packaged Gemini Vim plugin must look exactly like the native module it
 * replaces: same composer, same HUD layout. Runs the real manifest params,
 * the real Gemini adapter and the real Vim implementation (no mocks).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import rawManifest from '../catalog/sites/gemini/plugins/vim-input/plugin.json';
import { validateManifest } from '../manifest/validate';
import { PluginScope } from '../runtime/pluginScope';
import { geminiAdapter } from '../sites/adapters/gemini';
import type { PrimitiveContext } from '../verbs/types';

const parsed = validateManifest(rawManifest);
if (!parsed.success) throw new Error(JSON.stringify(parsed.error));
const vimOp = parsed.data.contributes.domOps?.find(
  (op) => op.op === 'native' && op.handler === 'vimInput',
);
if (vimOp?.op !== 'native') throw new Error('Gemini Vim manifest has no vimInput op');
const officialParams: unknown = vimOp.params;

function box(left: number, top: number, width: number, height: number): DOMRect {
  return new DOMRect(left, top, width, height);
}

/** Gemini's prompt composer as the live page nests it. */
function renderGeminiComposer(): { editor: HTMLElement; field: HTMLElement } {
  document.body.innerHTML = `
    <input-area-v2>
      <div class="text-input-field">
        <rich-textarea>
          <div class="ql-editor" contenteditable="true" role="textbox"><p>hello</p></div>
        </rich-textarea>
      </div>
    </input-area-v2>`;
  const field = document.querySelector<HTMLElement>('.text-input-field')!;
  const editor = document.querySelector<HTMLElement>('.ql-editor')!;
  // jsdom has no layout: give the composer and its editor real boxes.
  field.getBoundingClientRect = () => box(20, 400, 420, 64);
  editor.getBoundingClientRect = () => box(74, 420, 320, 24);
  return { editor, field };
}

function primitiveContext(): PrimitiveContext {
  return {
    doc: document,
    adapter: geminiAdapter,
    pluginId: parsed.success ? parsed.data.id : '',
    settings: {},
    setTargetCounter: () => {},
  };
}

/** Fresh Vim module state per run, as each content script would have. */
async function startOfficial(params: unknown): Promise<PluginScope> {
  vi.resetModules();
  const { vimInputPrimitive } = await import('../verbs/vimInput');
  const validated = vimInputPrimitive.validateParams(params);
  if (!validated.success) throw new Error(JSON.stringify(validated.error));
  const scope = new PluginScope();
  vimInputPrimitive.activate(scope, validated.data, primitiveContext());
  await Promise.resolve();
  return scope;
}

function hud(): HTMLElement {
  const huds = document.querySelectorAll<HTMLElement>('.gv-input-vim-hud');
  expect(huds).toHaveLength(1);
  return huds[0];
}

describe('Gemini Vim official plugin presentation', () => {
  beforeEach(() => {
    (chrome.storage.sync.get as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_defaults: unknown, callback: (items: Record<string, unknown>) => void) =>
        callback({ [StorageKeys.INPUT_VIM_MODE]: true }),
    );
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('puts the HUD in the composer gutter exactly where the native module puts it', async () => {
    const { field } = renderGeminiComposer();
    vi.resetModules();
    const { startInputVimMode } = await import('@/pages/content/chatInput/vimMode');
    const stopNative = await startInputVimMode();
    const native = {
      placement: hud().dataset.placement,
      parent: hud().parentElement,
      left: hud().style.getPropertyValue('--gv-input-vim-hud-left'),
    };
    stopNative();
    expect(native).toEqual({ placement: 'composer', parent: field, left: '54px' });

    renderGeminiComposer();
    const scope = await startOfficial(officialParams);
    const official = hud();
    expect(official.dataset.placement).toBe('composer');
    expect(official.parentElement).toBe(document.querySelector('.text-input-field'));
    expect(official.style.getPropertyValue('--gv-input-vim-hud-left')).toBe(native.left);
    await scope.dispose();
    expect(document.querySelector('.gv-input-vim-hud')).toBeNull();
  });

  it('would float the HUD above the editor if the manifest pointed composer at the editor', async () => {
    // The former manifest value: proves this fixture tells the two layouts apart.
    renderGeminiComposer();
    const scope = await startOfficial({ composer: 'rich-textarea [contenteditable="true"]' });
    expect(hud().dataset.placement).toBe('floating');
    await scope.dispose();
  });
});
