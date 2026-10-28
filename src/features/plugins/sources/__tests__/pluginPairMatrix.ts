/**
 * Pairwise combination matrix for the bundled catalog plugins of one site:
 * two plugins touching the same thing must not step on each other.
 *
 * Every pair (A, B) of the site's official plugins runs through one real
 * `DeclarativeEngine`, configured as `PluginHost` configures its own, on a
 * fresh copy of the site's page (`pluginPairFixtures.ts`):
 *
 *  - disable equivalence: one page per pair chains both enable orders with
 *    both disable orders, and disabling either one leaves the page exactly as
 *    enabling the other alone does;
 *  - re-enable: that chain enables a plugin again on the page it was just
 *    disabled from, and the mount must still end as the plugin alone does;
 *  - clean teardown: disabling the last one restores the pristine page;
 *  - order report: when the page with both differs between enable orders, the
 *    difference is collected and printed, not asserted, since a last writer
 *    may legitimately win;
 *  - composer keys: where either plugin listens to the composer's keys,
 *    Enter, Shift+Enter and Ctrl+Enter end the same way in both mount orders
 *    (cancelled or not, send clicks, composer text, what reached the host),
 *    and, unless both own those keys, the same way as with the key owner
 *    alone (or none). Whether a draft survives is not observed here:
 *    `verbs/draftSave/draftSave.test.ts` runs that in both mount orders.
 *
 * Pairs whose primitives claim one exclusive resource are left out: the host
 * never runs them side by side. Each site's summary (pair counts, plugins
 * with no DOM effect on the page, order findings) prints after its run;
 * pass `--silent=false` to see it when everything passes.
 *
 * Timers are fake and every step advances them past the primitives' rescan,
 * restore and send windows, so "settled" means the same thing on every run.
 *
 * Pages are compared through `pageSnapshot` (`pluginPairSnapshot.ts`).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { findComposer, readComposer } from '@/core/services/composer';
import { startSendKeyCoordinator } from '@/core/services/composer/sendKeys/sendKeyCoordinator';
import type { SendSiteId } from '@/core/services/composer/sendKeys/sendSitePolicies';
import { installNativeEditingMock } from '@/tests/nativeEditing';

import { requireBundledSiteAdapter } from '../../catalog/sites';
import { DeclarativeEngine } from '../../runtime/declarativeEngine';
import { claimedResources } from '../../runtime/resourceClaims';
import { tracksPluginHealth } from '../../sites/featureOwners';
import type { PluginManifest, SiteAdapter } from '../../types';
import { BundledCatalogPluginSource } from '../BundledCatalogPluginSource';
import {
  adapterFor,
  answerRuntimeMessages,
  answerSyncStorageReads,
  defaultSettings,
} from './bundledPluginHarness';
import { loadSitePage, sitePage } from './pluginPairFixtures';
import { describeDifference, onlyStylesheetOrder, pageSnapshot } from './pluginPairSnapshot';

/** Longer than every primitive window: rescans (≤1s), draft restore retries (2.5s), send intent (2s). */
const SETTLE_MS = 3_000;

/** Primitives that decide what a key typed into the composer does. */
const COMPOSER_KEY_OWNERS: ReadonlySet<string> = new Set(['sendShortcut', 'vimInput']);
/** Primitives that also listen to composer keys, but only to observe them. */
const COMPOSER_KEY_OBSERVERS: ReadonlySet<string> = new Set(['draftSave', 'quoteReply']);

/** Bound before any test mutes the console. */
const report = console.warn.bind(console);

const SEND_SITES: ReadonlySet<string> = new Set<SendSiteId>(['gemini', 'aistudio']);

export interface PairSkip {
  /** Short plugin ids, in either order. */
  readonly pair: readonly [string, string];
  /** Which of the pair's checks to skip. */
  readonly check: 'dom' | 'keys-order' | 'keys-owner';
  /** What fails, and where the fix belongs. */
  readonly todo: string;
}

export interface PairMatrixOptions {
  /** Known bugs owned elsewhere: their cases are skipped and named, the rest stay asserted. */
  readonly skip?: readonly PairSkip[];
}

interface PluginCase {
  readonly manifest: PluginManifest;
  /** The id without its `voyager.<site>-` prefix, for test names. */
  readonly short: string;
}

// ---- composer keys ----------------------------------------------------------

interface KeyOutcome {
  readonly key: string;
  /** The key event was cancelled. */
  readonly prevented: boolean;
  /** Clicks that reached the send control. */
  readonly sends: number;
  readonly text: string;
  /** Enter key events that reached a document listener the host could own. */
  readonly hostSaw: readonly string[];
}

const KEYS: ReadonlyArray<readonly [string, KeyboardEventInit]> = [
  ['Enter', {}],
  ['Shift+Enter', { shiftKey: true }],
  ['Ctrl+Enter', { ctrlKey: true }],
];

function composerField(adapter: SiteAdapter): HTMLElement {
  const direct = findComposer(adapter, { doc: document });
  if (direct) return direct;
  // Gemini's composer key names the wrapper; the editable lives inside it.
  const wrapper = document.querySelector(adapter.selectors.composer ?? '');
  const field = wrapper?.querySelector<HTMLElement>('[contenteditable="true"], textarea');
  if (!field) throw new Error(`${adapter.id}: the page has no composer`);
  return field;
}

/** The composer holds `draft` with the caret at its end, as after typing it. */
function resetComposer(field: HTMLElement): void {
  field.focus();
  if (field instanceof HTMLTextAreaElement) {
    field.value = 'draft';
    field.setSelectionRange(5, 5);
    return;
  }
  field.innerHTML = '<p>draft</p>';
  const range = document.createRange();
  range.selectNodeContents(field.querySelector('p')!);
  range.collapse(false);
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function keyLabel(event: KeyboardEvent): string {
  const modifiers = [event.ctrlKey && 'Ctrl', event.metaKey && 'Meta', event.shiftKey && 'Shift']
    .filter(Boolean)
    .join('+');
  return modifiers ? `${modifiers}+${event.key}` : event.key;
}

// ---- matrix -----------------------------------------------------------------

/**
 * Waits for an unmount's teardown while advancing the fake clock: a scope
 * awaits a still-pending startup (the timeline's init polls on timers), which
 * a bare `await` would never let finish.
 */
async function untilReleased(released: Promise<void>): Promise<void> {
  let done = false;
  void released.then(() => {
    done = true;
  });
  for (let waited = 0; !done && waited < 10 * SETTLE_MS; waited += 100) {
    await vi.advanceTimersByTimeAsync(100);
  }
  if (!done) throw new Error('teardown did not settle');
}

function shortId(manifest: PluginManifest, siteId: string): string {
  return manifest.id.replace(`voyager.${siteId}-`, '');
}

function handlers(manifest: PluginManifest): string[] {
  return (manifest.contributes.domOps ?? []).flatMap((op) =>
    op.op === 'native' ? [op.handler] : [],
  );
}

function sharedResource(a: PluginManifest, b: PluginManifest): string | undefined {
  const held = new Set(claimedResources(a));
  return claimedResources(b).find((resource) => held.has(resource));
}

function skipFor(
  skips: readonly PairSkip[],
  check: PairSkip['check'],
  a: string,
  b: string,
): PairSkip | undefined {
  return skips.find(
    (skip) =>
      skip.check === check &&
      ((skip.pair[0] === a && skip.pair[1] === b) || (skip.pair[0] === b && skip.pair[1] === a)),
  );
}

function ownsComposerKeys(plugin: PluginCase): boolean {
  return handlers(plugin.manifest).some((handler) => COMPOSER_KEY_OWNERS.has(handler));
}

export function definePluginPairMatrix(siteId: string, options: PairMatrixOptions = {}): void {
  const page = sitePage(siteId);
  const adapter = requireBundledSiteAdapter(siteId);
  const skips = options.skip ?? [];

  describe(`${siteId} plugin pairs`, async () => {
    const manifests = (await new BundledCatalogPluginSource().list()).filter(
      (manifest) => adapterFor(manifest).id === siteId,
    );
    const plugins: PluginCase[] = manifests.map((manifest) => ({
      manifest,
      short: shortId(manifest, siteId),
    }));

    const pairs: Array<readonly [PluginCase, PluginCase]> = [];
    const coMountBlocked: string[] = [];
    for (let i = 0; i < plugins.length; i += 1) {
      for (let j = i + 1; j < plugins.length; j += 1) {
        const resource = sharedResource(plugins[i].manifest, plugins[j].manifest);
        // The host never runs two holders of one resource side by side (reconcileArbitration).
        if (resource)
          coMountBlocked.push(`${plugins[i].short} + ${plugins[j].short} (${resource})`);
        else pairs.push([plugins[i], plugins[j]]);
      }
    }
    const keyPairs = pairs.filter(([a, b]) =>
      [a, b].some((plugin) =>
        handlers(plugin.manifest).some(
          (handler) => COMPOSER_KEY_OWNERS.has(handler) || COMPOSER_KEY_OBSERVERS.has(handler),
        ),
      ),
    );

    const engines: DeclarativeEngine[] = [];
    const alone = new Map<string, string>();
    const together = new Map<string, string>();
    const silentAlone: string[] = [];

    const newEngine = (): DeclarativeEngine => {
      const engine = new DeclarativeEngine({
        doc: document,
        adapter,
        shouldTrackHealth: (manifest) => tracksPluginHealth(manifest.id),
      });
      engines.push(engine);
      return engine;
    };
    const settle = (): Promise<void> => vi.advanceTimersByTimeAsync(SETTLE_MS).then(() => {});
    const freshPage = (): string => {
      loadSitePage(page, adapter);
      return pageSnapshot();
    };
    const enable = async (engine: DeclarativeEngine, plugin: PluginCase): Promise<void> => {
      engine.mount(plugin.manifest, defaultSettings(plugin.manifest));
      await settle();
    };
    const disable = async (engine: DeclarativeEngine, plugin: PluginCase): Promise<void> => {
      await untilReleased(engine.unmount(plugin.manifest.id));
      await settle();
    };
    /** The page with only `plugin` enabled; leaves a fresh page loaded either way. */
    const aloneReference = async (plugin: PluginCase): Promise<string> => {
      const cached = alone.get(plugin.manifest.id);
      if (cached !== undefined) return cached;
      freshPage();
      const engine = newEngine();
      await enable(engine, plugin);
      const snapshot = pageSnapshot();
      await disable(engine, plugin);
      alone.set(plugin.manifest.id, snapshot);
      return snapshot;
    };

    let restoreEditing: (() => void) | null = null;
    beforeAll(async () => {
      // The content script starts the page's send-key coordinator before any plugin.
      if (SEND_SITES.has(siteId)) startSendKeyCoordinator(siteId as SendSiteId);
      // Browsers have an editing engine; newline and quote insertion go through it.
      restoreEditing = installNativeEditingMock();
      // User LaTeX loads KaTeX lazily; fake timers cannot settle its cold first import.
      await import('katex');
    });
    afterAll(() => restoreEditing?.());

    beforeEach(() => {
      vi.useFakeTimers();
      answerSyncStorageReads();
      answerRuntimeMessages();
      // Every mount logs, and the timeline reports the missing background on every start;
      // the matrix prints its own summary instead.
      for (const level of ['info', 'warn', 'error'] as const) {
        vi.spyOn(console, level).mockImplementation(() => {});
      }
      for (const name of document.documentElement.getAttributeNames()) {
        document.documentElement.removeAttribute(name);
      }
    });

    afterEach(async () => {
      for (const engine of engines.splice(0)) engine.unmountAll();
      await vi.advanceTimersByTimeAsync(SETTLE_MS);
      vi.useRealTimers();
      vi.restoreAllMocks();
      document.getSelection()?.removeAllRanges();
      document.head.replaceChildren();
      document.body.replaceChildren();
    });

    afterAll(() => {
      const findings: string[] = [];
      const sheetOrder: string[] = [];
      for (const [a, b] of pairs) {
        const ab = together.get(`${a.manifest.id}|${b.manifest.id}`);
        const ba = together.get(`${b.manifest.id}|${a.manifest.id}`);
        if (ab === undefined || ba === undefined || ab === ba) continue;
        if (onlyStylesheetOrder(ab, ba)) {
          sheetOrder.push(`${a.short} + ${b.short}`);
          continue;
        }
        findings.push(
          `  ${a.short} + ${b.short} (${a.short} first: -, ${b.short} first: +)\n` +
            describeDifference(ab, ba),
        );
      }
      const lines = [
        `[plugin pairs] ${siteId}: ${plugins.length} plugins, ${pairs.length} pairs, ` +
          `${keyPairs.length} composer-key pairs`,
        coMountBlocked.length > 0
          ? `  not co-mounted by the host: ${coMountBlocked.join('; ')}`
          : '',
        silentAlone.length > 0
          ? `  no DOM effect alone on this page: ${silentAlone.join(', ')}`
          : '',
        sheetOrder.length > 0
          ? `  stylesheets in enable order only, so equal-specificity ties go to the later plugin ` +
            `(${sheetOrder.length}): ${sheetOrder.join(', ')}`
          : '',
        findings.length > 0
          ? `  order-dependent pages (${findings.length}):\n${findings.join('\n')}`
          : '  no other order-dependent pages',
      ];
      report(lines.filter(Boolean).join('\n'));
    });

    it('covers every bundled plugin of the site', () => {
      expect(plugins.length).toBeGreaterThan(1);
    });

    it.each(plugins.map((plugin) => ({ plugin, name: plugin.short })))(
      `${siteId}: $name alone renders the same on two fresh pages and tears down clean`,
      async ({ plugin }) => {
        const runs: string[] = [];
        for (let run = 0; run < 2; run += 1) {
          const pristine = freshPage();
          const engine = newEngine();
          await enable(engine, plugin);
          runs.push(pageSnapshot());
          await disable(engine, plugin);
          expect(pageSnapshot(), 'disabling it restores the page').toEqual(pristine);
          if (run === 0 && runs[0] === pristine) silentAlone.push(plugin.short);
        }
        expect(runs[1], 'a second fresh page renders the same').toEqual(runs[0]);
        alone.set(plugin.manifest.id, runs[0]);
      },
    );

    for (const [a, b] of pairs) {
      const skip = skipFor(skips, 'dom', a.short, b.short);
      const title = `${siteId}: ${a.short} + ${b.short} toggle in every enable and disable order on one page and tear down clean`;
      if (skip) {
        it.skip(`${title} — TODO: ${skip.todo}`, () => {});
        continue;
      }
      it(title, async () => {
        const onlyA = await aloneReference(a);
        const onlyB = await aloneReference(b);
        const pristine = freshPage();
        const engine = newEngine();
        /**
         * With `held` enabled, enables `added` and then disables `gone`: the page must be the
         * other one's alone. The first page with both in an order goes to the order report.
         */
        const toggle = async (
          held: PluginCase,
          added: PluginCase,
          gone: PluginCase,
        ): Promise<void> => {
          await enable(engine, added);
          const key = `${held.manifest.id}|${added.manifest.id}`;
          if (!together.has(key)) together.set(key, pageSnapshot());
          await disable(engine, gone);
          const kept = gone === held ? added : held;
          expect(
            pageSnapshot(),
            `enabled ${held.short} → ${added.short}, disabling ${gone.short} leaves exactly ${kept.short}`,
          ).toEqual(kept === a ? onlyA : onlyB);
        };

        await enable(engine, a);
        await toggle(a, b, a);
        // Each later step re-enables, on the same page, the plugin the step before disabled.
        await toggle(b, a, a);
        await toggle(b, a, b);
        await toggle(a, b, b);
        await disable(engine, a);
        expect(
          pageSnapshot(),
          `enabled ${a.short} → ${b.short}, disabling ${b.short} then ${a.short} restores the page`,
        ).toEqual(pristine);
      });
    }

    /** Enter, Shift+Enter and Ctrl+Enter in the composer with `enabled` mounted in that order. */
    const probeKeys = async (enabled: readonly PluginCase[]): Promise<KeyOutcome[]> => {
      freshPage();
      const engine = newEngine();
      for (const plugin of enabled) await enable(engine, plugin);
      const field = composerField(adapter);
      const button = document.querySelector<HTMLElement>(adapter.selectors.sendButton ?? '');
      let sends = 0;
      button?.addEventListener('click', (event) => {
        event.preventDefault();
        sends += 1;
      });
      const hostSaw: string[] = [];
      const host = (event: KeyboardEvent): void => {
        if (event.key === 'Enter') hostSaw.push(keyLabel(event));
      };
      document.addEventListener('keydown', host);
      const results: KeyOutcome[] = [];
      for (const [key, init] of KEYS) {
        resetComposer(field);
        sends = 0;
        hostSaw.length = 0;
        const event = new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
          ...init,
        });
        field.dispatchEvent(event);
        await settle();
        results.push({
          key,
          prevented: event.defaultPrevented,
          sends,
          text: readComposer(field),
          hostSaw: [...hostSaw],
        });
      }
      document.removeEventListener('keydown', host);
      for (const plugin of [...enabled].reverse()) await disable(engine, plugin);
      return results;
    };

    for (const [a, b] of keyPairs) {
      const owners = [a, b].filter(ownsComposerKeys);
      const orderSkip = skipFor(skips, 'keys-order', a.short, b.short);
      const orderTitle = `${siteId}: ${a.short} + ${b.short} handle Enter, Shift+Enter and Ctrl+Enter the same in both mount orders`;
      if (orderSkip) it.skip(`${orderTitle} — TODO: ${orderSkip.todo}`, () => {});
      else
        it(orderTitle, async () => {
          const ab = await probeKeys([a, b]);
          expect(await probeKeys([b, a]), `${b.short} first ends like ${a.short} first`).toEqual(
            ab,
          );
        });

      // Only an owner decides what a key does: the other plugin, an observer or not
      // listening at all, must leave the owner's outcome (or the host's) as it was.
      if (owners.length > 1) continue;
      const reference = owners[0]?.short ?? 'the host page';
      const ownerSkip = skipFor(skips, 'keys-owner', a.short, b.short);
      const ownerTitle = `${siteId}: ${a.short} + ${b.short} end Enter, Shift+Enter and Ctrl+Enter as ${reference} alone does`;
      if (ownerSkip) it.skip(`${ownerTitle} — TODO: ${ownerSkip.todo}`, () => {});
      else
        it(ownerTitle, async () => {
          const alone = await probeKeys(owners);
          expect(await probeKeys([a, b]), `${a.short} first`).toEqual(alone);
          expect(await probeKeys([b, a]), `${b.short} first`).toEqual(alone);
        });
    }
  });
}
