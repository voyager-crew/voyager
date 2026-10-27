// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://gemini.google.com/app" }
/**
 * An extension update leaves the old content script running beside the new
 * one until the new one claims the page (`contentScriptHandoff.ts`). Each copy
 * loads its own Vim module, so its own HUD and listeners; the page DOM (the
 * composer and its mode markers) is all they share. Runs the real Vim and
 * formula-copy primitives in a real PluginScope, one module graph per copy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { claimContentScript } from '@/pages/content/contentScriptHandoff';

import { PluginScope } from '../../runtime/pluginScope';
import { geminiAdapter } from '../../sites/adapters/gemini';
import type { PrimitiveContext } from '../types';

const storageMocks = vi.hoisted(() => ({
  get: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock('webextension-polyfill', () => ({
  default: {
    storage: {
      sync: { get: storageMocks.get },
      onChanged: {
        addListener: storageMocks.addListener,
        removeListener: storageMocks.removeListener,
      },
    },
  },
}));

const HUD = '.gv-input-vim-hud';
const COMPOSER_MOUNT_CLASS = 'gv-input-vim-hud-composer-mount';

interface ContentScriptCopy {
  readonly vimInput: typeof import('./index').vimInputPrimitive;
  readonly formulaCopy: typeof import('../formulaCopy').formulaCopyPrimitive;
  readonly startInputVimMode: typeof import('@/pages/content/chatInput/vimMode').startInputVimMode;
}

/** A fresh module graph: what a newly injected content script would load. */
async function loadContentScriptCopy(): Promise<ContentScriptCopy> {
  vi.resetModules();
  const [{ vimInputPrimitive }, { formulaCopyPrimitive }, { startInputVimMode }] =
    await Promise.all([
      import('./index'),
      import('../formulaCopy'),
      import('@/pages/content/chatInput/vimMode'),
    ]);
  return { vimInput: vimInputPrimitive, formulaCopy: formulaCopyPrimitive, startInputVimMode };
}

function primitiveContext(): PrimitiveContext {
  return {
    doc: document,
    adapter: geminiAdapter,
    pluginId: 'local.vim-and-formulas',
    settings: {},
    setTargetCounter: () => {},
  };
}

/** A local plugin whose ops are `[vimInput, formulaCopy]`, in that order. */
function activateLocalPlugin(copy: ContentScriptCopy): PluginScope {
  const scope = new PluginScope();
  const context = primitiveContext();
  copy.vimInput.activate(scope, {}, context);
  copy.formulaCopy.activate(scope, {}, context);
  return scope;
}

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
  field.getBoundingClientRect = () => new DOMRect(20, 400, 420, 64);
  editor.getBoundingClientRect = () => new DOMRect(74, 420, 320, 24);
  return { editor, field };
}

function focusEditor(editor: HTMLElement): void {
  editor.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
}

async function flush(): Promise<void> {
  for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('Vim input across a content-script handoff', () => {
  const stopClaims: Array<() => void> = [];

  beforeEach(() => {
    vi.clearAllMocks();
    storageMocks.get.mockResolvedValue({});
  });

  afterEach(() => {
    for (const stop of stopClaims.splice(0)) stop();
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-gv-formula-copy-owner');
    document.body.innerHTML = '';
  });

  it('retires the old Vim at once while its formula op is still starting, leaving one HUD', async () => {
    const { editor, field } = renderGeminiComposer();
    let finishOldRead!: (value: Record<string, unknown>) => void;
    storageMocks.get.mockImplementationOnce(
      () => new Promise((resolve) => (finishOldRead = resolve)),
    );

    // Old copy: Vim runs, formula copy is still reading its format.
    const oldCopy = await loadContentScriptCopy();
    const oldScope = activateLocalPlugin(oldCopy);
    let oldDisposal: Promise<void> | null = null;
    stopClaims.push(
      claimContentScript(
        () => {
          oldDisposal = oldScope.dispose();
        },
        () => true,
      ),
    );
    await Promise.resolve();
    focusEditor(editor);
    expect(document.querySelectorAll(HUD)).toHaveLength(1);
    expect(editor.dataset.gvVimMode).toBe('insert');

    // New copy claims the page, retiring the old one, then starts its plugin.
    const newCopy = await loadContentScriptCopy();
    stopClaims.push(
      claimContentScript(
        () => {},
        () => false,
      ),
    );
    expect(oldDisposal).not.toBeNull();
    const newScope = activateLocalPlugin(newCopy);
    await Promise.resolve();
    focusEditor(editor);

    expect(document.querySelectorAll(HUD)).toHaveLength(1);
    expect(editor.dataset.gvVimMode).toBe('insert');

    // The old formula read lands and the old scope finishes its teardown.
    finishOldRead({});
    await oldDisposal;
    await flush();

    expect(document.querySelectorAll(HUD)).toHaveLength(1);
    expect(field.querySelector(HUD)).not.toBeNull();
    expect(editor.dataset.gvVimMode).toBe('insert');
    expect(editor.classList.contains('gv-input-vim-mode-insert')).toBe(true);
    expect(field.classList.contains(COMPOSER_MOUNT_CLASS)).toBe(true);

    await newScope.dispose();
    expect(document.querySelectorAll(HUD)).toHaveLength(0);
    expect(editor.dataset.gvVimMode).toBeUndefined();
    expect(field.classList.contains(COMPOSER_MOUNT_CLASS)).toBe(false);
  });

  it("a retired copy's late Vim cleanup keeps the new copy's mode markers and HUD mount", async () => {
    const { editor, field } = renderGeminiComposer();
    const oldCopy = await loadContentScriptCopy();
    const stopOld = await oldCopy.startInputVimMode({ forceEnabled: true });
    focusEditor(editor);

    const newCopy = await loadContentScriptCopy();
    const stopNew = await newCopy.startInputVimMode({ forceEnabled: true });
    focusEditor(editor);
    expect(document.querySelectorAll(HUD)).toHaveLength(2);

    stopOld();

    expect(document.querySelectorAll(HUD)).toHaveLength(1);
    expect(editor.dataset.gvVimMode).toBe('insert');
    expect(editor.classList.contains('gv-input-vim-mode-insert')).toBe(true);
    expect(field.classList.contains(COMPOSER_MOUNT_CLASS)).toBe(true);

    stopNew();
    expect(document.querySelectorAll(HUD)).toHaveLength(0);
    expect(editor.dataset.gvVimMode).toBeUndefined();
    expect(editor.classList.contains('gv-input-vim-mode-insert')).toBe(false);
    expect(field.classList.contains(COMPOSER_MOUNT_CLASS)).toBe(false);
  });
});
