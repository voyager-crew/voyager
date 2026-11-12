import { readFileSync, readdirSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DeclarativeEngine } from '../runtime/declarativeEngine';
import type { PluginManifest, PluginSettingValue } from '../types';
import { BundledCatalogPluginSource } from './BundledCatalogPluginSource';
import {
  adapterFor,
  answerSyncStorageReads,
  defaultSettings,
} from './__tests__/bundledPluginHarness';

/**
 * Plan §8 / P2 acceptance: every bundled declarative plugin must mount, accept
 * a settings change and unmount without leaving a trace on the host document.
 * The checks are generic on purpose so a new plugin is covered the moment its
 * files land under `catalog/sites/<site>/plugins/<id>/`.
 *
 * Primitives run for real. A page-wide runtime (formula copy, Vim input)
 * starts asynchronously, so the test waits until it has attached its page
 * listeners, then awaits the unmount's own teardown before checking that
 * every page and storage listener it added is gone again.
 */

/** Primitives whose runtime is one per page and starts asynchronously. */
const PAGE_RUNTIME_HANDLERS: ReadonlySet<string> = new Set(['formulaCopy', 'vimInput']);

interface ListenerRecord {
  readonly target: EventTarget;
  readonly type: string;
  readonly listener: unknown;
  readonly capture: boolean;
}

function captureOf(options: boolean | AddEventListenerOptions | undefined): boolean {
  return typeof options === 'boolean' ? options : options?.capture === true;
}

/**
 * Listeners added to the document or window since `track()`, minus those
 * removed again (same target, type, listener and capture, as the DOM matches
 * them), and `storage.onChanged` listeners likewise.
 */
function trackListeners() {
  const page: ListenerRecord[] = [];
  const storage: unknown[] = [];
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  const isPage = (target: EventTarget): boolean => target === document || target === window;
  const sameAs = (record: ListenerRecord, other: ListenerRecord): boolean =>
    record.target === other.target &&
    record.type === other.type &&
    record.listener === other.listener &&
    record.capture === other.capture;
  const drop = (record: ListenerRecord): void => {
    const index = page.findIndex((entry) => sameAs(entry, record));
    if (index >= 0) page.splice(index, 1);
  };
  const spies = [
    vi
      .spyOn(EventTarget.prototype, 'addEventListener')
      .mockImplementation(function (this: EventTarget, type, listener, options) {
        const record = { target: this, type, listener, capture: captureOf(options) };
        if (isPage(this) && !page.some((entry) => sameAs(entry, record))) {
          page.push(record);
          // An aborted `signal` removes the listener as removeEventListener would.
          const signal = typeof options === 'object' ? options.signal : undefined;
          signal?.addEventListener('abort', () => drop(record), { once: true });
        }
        add.call(this, type, listener, options);
      }),
    vi
      .spyOn(EventTarget.prototype, 'removeEventListener')
      .mockImplementation(function (this: EventTarget, type, listener, options) {
        drop({ target: this, type, listener, capture: captureOf(options) });
        remove.call(this, type, listener, options);
      }),
  ];
  const onChanged = chrome.storage.onChanged;
  (onChanged.addListener as unknown as Mock).mockImplementation((listener: unknown) => {
    storage.push(listener);
  });
  (onChanged.removeListener as unknown as Mock).mockImplementation((listener: unknown) => {
    const index = storage.indexOf(listener);
    if (index >= 0) storage.splice(index, 1);
  });
  return {
    page: () => page.map((entry) => entry.type),
    storage: () => storage.length,
    stop: () => {
      for (const spy of spies) spy.mockRestore();
      (onChanged.addListener as unknown as Mock).mockReset();
      (onChanged.removeListener as unknown as Mock).mockReset();
    },
  };
}

function startsPageRuntime(manifest: PluginManifest): boolean {
  return (manifest.contributes.domOps ?? []).some(
    (op) => op.op === 'native' && PAGE_RUNTIME_HANDLERS.has(op.handler),
  );
}

/** A value different from the default for every declared setting. */
function changedSettings(manifest: PluginManifest): Record<string, PluginSettingValue> {
  return Object.fromEntries(
    Object.entries(manifest.contributes.settings ?? {}).map(([key, field]) => {
      if (field.type === 'boolean') return [key, field.default !== true];
      if (field.type === 'number') {
        const current = Number(field.default);
        const next =
          current === field.min ? (field.max ?? current + 1) : (field.min ?? current - 1);
        return [key, next];
      }
      return [key, `${String(field.default)}-changed`];
    }),
  );
}

/** The root element's attributes; an emptied `class` counts as none. */
function rootAttributes(): readonly string[] {
  return [...document.documentElement.attributes]
    .filter((attribute) => attribute.name !== 'class' || attribute.value.trim() !== '')
    .map((attribute) => `${attribute.name}=${attribute.value}`)
    .sort();
}

/** Head markup minus the engine's one-time base stylesheet, which persists by design. */
function headWithoutBaseStyle(): string {
  const clone = document.head.cloneNode(true) as HTMLElement;
  clone.querySelector('#gv-plugin-base-style')?.remove();
  return clone.innerHTML;
}

let listeners: ReturnType<typeof trackListeners> | null = null;

beforeEach(answerSyncStorageReads);

afterEach(() => {
  listeners?.stop();
  listeners = null;
  (chrome.storage.sync.get as unknown as Mock).mockReset();
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  document.body.removeAttribute('style');
  document.body.removeAttribute('class');
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('class');
});

describe('bundled plugin lifecycle (parametric)', async () => {
  const manifests = await new BundledCatalogPluginSource().list();
  const sitesDir = resolve(process.cwd(), 'src/features/plugins/catalog/sites');
  // Generate cases from disk: a skipped invalid plugin must still get a failing lifecycle test.
  const diskPlugins = readdirSync(sitesDir, { recursive: true, encoding: 'utf8' })
    .map((path) => path.split(sep).join('/'))
    .filter((path) => /^[^/]+\/plugins\/[^/]+\/plugin\.json$/.test(path))
    .sort()
    .map((path) => ({
      path,
      id: (JSON.parse(readFileSync(resolve(sitesDir, path), 'utf8')) as { id: string }).id,
    }));
  expect(diskPlugins.length).toBeGreaterThan(0);

  for (const { path, id } of diskPlugins) {
    function loadedManifest(): PluginManifest {
      const matches = manifests.filter((manifest) => manifest.id === id);
      expect(matches, `${path}: expected exactly one loaded plugin`).toHaveLength(1);
      return matches[0];
    }

    it(`${id}: mount → updateSettings → unmount restores the host`, async () => {
      const manifest = loadedManifest();
      document.body.className = 'host-class';
      document.body.setAttribute('style', '--host-var: 1px;');
      // Semantic answer operations need real target markup, not an empty body:
      // the DeepSeek code block is long enough for code folding to collapse it,
      // and the table gets a copy toolbar, so their teardown is checked too.
      document.body.innerHTML =
        '<div class="ds-message"><div class="ds-collapsible-text"><p>Question</p></div></div>' +
        '<div class="ds-message"><div class="ds-assistant-message-main-content"><pre><code>sample</code></pre>' +
        '<div class="md-code-block"><div class="md-code-block-banner"><div><div role="button">Copy</div></div></div>' +
        `<pre>${'line\n'.repeat(40)}</pre></div>` +
        '<p>Formula <span class="katex">x</span></p>' +
        '<table><thead><tr><th>Head</th></tr></thead><tbody><tr><td>Cell</td></tr></tbody></table>' +
        '</div></div>' +
        '<textarea class="ds-scroll-area">composer</textarea>';
      const before = {
        head: headWithoutBaseStyle(),
        body: document.body.outerHTML,
        root: rootAttributes(),
      };
      const engine = new DeclarativeEngine({ doc: document, adapter: adapterFor(manifest) });
      const tracked = trackListeners();
      listeners = tracked;

      engine.mount(manifest, defaultSettings(manifest));
      expect(engine.isActive(manifest.id)).toBe(true);
      if (startsPageRuntime(manifest)) {
        // The runtime has really started: its page listeners are attached.
        await vi.waitFor(() => expect(tracked.page()).toContain('click'));
      }
      const styles = manifest.contributes.styles ?? [];
      const styleEl = document.getElementById(`gv-plugin-style-${manifest.id}`);
      if (styles.length > 0) {
        expect(styleEl).not.toBeNull();
        expect(styleEl?.textContent?.length ?? 0).toBeGreaterThan(0);
      }
      // Only ops that address page elements change the host markup (the body,
      // or the root's attributes); a primitive-only plugin (`native` op) runs code instead.
      if (manifest.contributes.domOps?.some((op) => op.op !== 'native')) {
        expect({ body: document.body.outerHTML, root: rootAttributes() }).not.toEqual({
          body: before.body,
          root: before.root,
        });
      }

      engine.updateSettings(manifest.id, changedSettings(manifest));
      expect(engine.isActive(manifest.id)).toBe(true);

      await engine.unmount(manifest.id);
      expect(engine.isActive(manifest.id)).toBe(false);
      expect(tracked.page()).toEqual([]);
      // Only checked for page runtimes: other primitives may start i18n, whose
      // language listener is process-wide by design.
      if (startsPageRuntime(manifest)) expect(tracked.storage()).toBe(0);
      expect(headWithoutBaseStyle()).toBe(before.head);
      expect(document.body.outerHTML).toBe(before.body);
      expect(rootAttributes()).toEqual(before.root);
    });

    it(`${id}: every semantic target resolves on its site adapter`, () => {
      const manifest = loadedManifest();
      const adapter = adapterFor(manifest);
      for (const op of manifest.contributes.domOps ?? []) {
        if (op.op === 'native') continue;
        if (op.target.kind === 'semantic') {
          expect(adapter.selectors[op.target.key], `${manifest.id}: ${op.target.key}`).toBeTruthy();
        }
      }
    });
  }
});
