/**
 * DeclarativeEngine — interprets a plugin's declarative contributions
 * (`styles` + `domOps`) against a Document. This is the "logic in the package"
 * half of the MV3-compliant design: plugins are data, this engine is the code.
 *
 * Guarantees:
 *  - **Reversible.** Every applied change is bookkept so `unmount()` restores the
 *    DOM exactly (removes injected styles/classes, restores overwritten
 *    attributes/inline styles).
 *  - **Composable across plugins.** Class/attribute/style changes are tracked in
 *    engine-level, ref-counted ledgers — NOT per-plugin "original value" copies.
 *    When two plugins touch the same class/attribute/style, the *true* pre-plugin
 *    original is captured once; unmounting one plugin restores the value of the
 *    other still-active plugin (last writer wins), and only the last release
 *    restores the original. This is what makes a multi-plugin marketplace safe.
 *  - **Idempotent.** Re-applying ops never duplicates work (a plugin owns a given
 *    class/attr/style once; re-application just re-asserts the DOM value, which
 *    also re-heals SPA re-renders that stripped it).
 *  - **No observer loop.** The MutationObserver watches `childList`+`subtree`
 *    only, so the engine's own class/attribute/style mutations never retrigger
 *    it. Re-application happens only when new nodes appear (SPA re-renders),
 *    coalesced to one pass per animation frame.
 *  - **Platform-agnostic.** Pure DOM APIs — works identically on Chrome, Firefox
 *    and Safari.
 */
import { logger } from '@/core/services/LoggerService';

import {
  PLUGIN_BASE_STYLE_ID,
  PLUGIN_HIDDEN_CLASS,
  PLUGIN_MARKER_ATTR,
  PLUGIN_STYLE_ID_PREFIX,
} from '../constants';
import { renderSettingTemplate, styleSheetIssue } from '../manifest/sinkGuards';
import type {
  DomOperation,
  PluginManifest,
  PluginSettings,
  SelectorRef,
  SiteAdapter,
} from '../types';
import { DomEffectLedger } from './domEffectLedger';
import { type HealthMonitorOptions, type HealthSample, HealthMonitor } from './healthMonitor';
import { type NativeHandler, getNativeHandler } from './nativeHandlers';
import { diagnoseOps } from './opDiagnostics';
import { PluginScope } from './pluginScope';
import {
  type PrimitiveEnv,
  type PrimitiveSlot,
  activatePrimitives,
  updatePrimitiveSettings,
} from './primitiveLifecycle';
import { resolveSemanticElements } from './semanticElements';
import { applyOpToElement, isTargetedOp } from './targetedOps';

interface ActivePlugin extends PrimitiveSlot {
  styleEl: HTMLStyleElement | null;
  /** Current resolved setting values for CSS, DOM operations and native params. */
  settings: PluginSettings;
  /** First-party start/stop bound to a builtin plugin id (see nativeHandlers). */
  nativeHandler?: NativeHandler;
  /** Side-effect ledger for a scope-based (`activate`) native handler. */
  scope?: PluginScope;
  /** Serializes settings-driven scope restarts (dispose → re-activate). */
  scopeRestart?: Promise<void>;
}

export interface DeclarativeEngineOptions {
  /** Only an installed remote page profile needs to distinguish native decorations from our UI. */
  readonly trackNativeDecorations?: boolean;
  /** Document to operate on. Defaults to ambient `document` (override in tests). */
  readonly doc?: Document;
  /** Adapter used to resolve `semantic` selector refs. May be null (unknown site). */
  readonly adapter?: SiteAdapter | null;
  /** Health verdict changes (plan D12): `noEffect` true = flagged; `zeroOps` the ops that found nothing. */
  readonly onHealthChange?: HealthMonitorOptions['onChange'];
  /** Test hook: DOM silence before a health verdict. */
  readonly healthQuietMs?: number;
  readonly healthMaxWaitMs?: number;
  /**
   * Whether the health monitor watches a plugin that addresses the page
   * (default: every one). Packaged official plugins on by default opt out.
   */
  readonly shouldTrackHealth?: (manifest: PluginManifest) => boolean;
  /**
   * Every unmount, with the manifest that was mounted and a promise that
   * settles once its scopes have finished tearing down (a pending async
   * startup included). Never rejects.
   */
  readonly onRelease?: (manifest: PluginManifest, released: Promise<void>) => void;
  /** Handed to primitives as `context.inspectPlugins` (the host's statuses and manifests). */
  readonly inspectPlugins?: PrimitiveEnv['inspectPlugins'];
}

export class DeclarativeEngine {
  private readonly doc: Document;
  private readonly adapter: SiteAdapter | null;
  private readonly active = new Map<string, ActivePlugin>();
  private readonly health: HealthMonitor;
  private readonly shouldTrackHealth: (manifest: PluginManifest) => boolean;
  private readonly onRelease?: (manifest: PluginManifest, released: Promise<void>) => void;

  /** Engine-level, ref-counted ledgers shared across plugins (see class doc). */
  private readonly ledger: DomEffectLedger;
  private readonly primitiveEnv: PrimitiveEnv;

  private observer: MutationObserver | null = null;
  private reapplyScheduled = false;

  constructor(options: DeclarativeEngineOptions = {}) {
    this.doc = options.doc ?? document;
    this.adapter = options.adapter ?? null;
    this.shouldTrackHealth = options.shouldTrackHealth ?? (() => true);
    this.onRelease = options.onRelease;
    this.ledger = new DomEffectLedger(this.doc, options.trackNativeDecorations);
    this.primitiveEnv = {
      doc: this.doc,
      adapter: this.adapter,
      isCurrent: (slot) => this.active.get(slot.manifest.id) === slot,
      inspectPlugins: options.inspectPlugins,
    };
    this.health = new HealthMonitor({
      countUserTurns: () => this.countUserTurns(),
      onChange: options.onHealthChange,
      quietMs: options.healthQuietMs,
      maxWaitMs: options.healthMaxWaitMs,
    });
  }

  get activeCount(): number {
    return this.active.size;
  }

  /** Live side-effect ledger per scope-based plugin — debug/leak inspection. */
  getScopeLedgers(): Record<string, readonly string[]> {
    const ledgers: Record<string, readonly string[]> = {};
    for (const [id, entry] of this.active) {
      if (entry.scope) ledgers[id] = entry.scope.getEffects();
    }
    return ledgers;
  }

  isActive(id: string): boolean {
    return this.active.has(id);
  }

  /**
   * Health verdict for a mounted plugin (plan D12): `true` = flagged as having
   * no effect on this page, `false` = healthy, `undefined` = not tracked or
   * no verdict yet. Pure-CSS plugins are never tracked.
   */
  getHealth(id: string): boolean | undefined {
    return this.health.get(id);
  }

  /** `domOps` indexes the last health verdict found nothing for, page-root targets aside. */
  getZeroOps(id: string): readonly number[] {
    return this.health.zeroOps(id);
  }

  /** Force a health evaluation now (tests and debugging). */
  evaluateHealthNow(): void {
    this.health.evaluateNow();
  }

  mount(manifest: PluginManifest, settings: PluginSettings = {}): void {
    if (this.active.has(manifest.id)) return;
    this.ensureBaseStyle();
    const entry: ActivePlugin = {
      manifest,
      styleEl: null,
      settings,
      targetCounters: [],
      primitiveHandles: [],
      primitiveActivations: 0,
    };
    entry.nativeHandler = getNativeHandler(manifest.id);
    this.active.set(manifest.id, entry);
    this.injectStyles(entry);
    this.applyDomOps(entry);
    // First-party builtin plugins run JS via a registered native handler, in
    // lockstep with the declarative lifecycle. Scope-based handlers get a
    // fresh PluginScope per mount; a failed (sync or async) activation pays
    // back whatever it already registered instead of leaving a half-mount.
    if (entry.nativeHandler?.activate) {
      this.activateScope(entry, settings);
    } else {
      entry.nativeHandler?.start?.(settings);
    }
    // `native` ops invoke first-party primitives by name with validated params.
    activatePrimitives(entry, settings, this.primitiveEnv);
    this.trackHealth(entry);
    this.syncObserver();
    logger.info('Plugin mounted', { id: manifest.id });
  }

  /** Plugins that address the page (DOM ops or primitives) get a health verdict. */
  private trackHealth(entry: ActivePlugin): void {
    const ops = entry.manifest.contributes.domOps ?? [];
    if (ops.length === 0 || !this.shouldTrackHealth(entry.manifest)) return;
    this.health.track(entry.manifest.id, () => this.healthSample(entry));
  }

  private healthSample(entry: ActivePlugin): HealthSample {
    const ops = diagnoseOps(this.doc, this.adapter, entry.manifest);
    let total = ops.reduce((sum, op) => sum + op.count, 0);
    for (const count of entry.targetCounters) {
      try {
        total += count();
      } catch {
        // A throwing counter reports nothing.
      }
    }
    return { targets: total, ops };
  }

  private countUserTurns(): number {
    const selector = this.adapter?.selectors.userTurn;
    if (!selector) return 0;
    try {
      return this.doc.querySelectorAll(selector).length;
    } catch {
      return 0;
    }
  }

  /** Live-update settings, re-rendering templates and updating or restarting native features. */
  updateSettings(id: string, settings: PluginSettings): void {
    const entry = this.active.get(id);
    if (!entry) return;
    entry.settings = settings;
    if (entry.styleEl) entry.styleEl.textContent = this.renderCss(entry);
    else this.injectStyles(entry);
    this.releasePlugin(id);
    this.applyDomOps(entry);
    const handler = entry.nativeHandler;
    if (handler?.updateSettings) {
      handler.updateSettings(settings);
    } else if (handler?.activate) {
      // Restart-by-default: with no fine-grained updater, correctness comes
      // from a full dispose + re-activate under the new settings. Safe by
      // construction — the scope guarantees complete teardown. Plugins with
      // expensive state opt out by implementing updateSettings.
      this.restartScope(entry, settings);
    }
    // Primitives read settings through their context at activation. Those
    // that can absorb the change in place do so; otherwise restart them under
    // the new values (same safety argument as above).
    updatePrimitiveSettings(entry, settings, this.primitiveEnv);
  }

  /** Create a fresh scope for a scope-based handler and run its activation.
   *  A failed (sync or async) activation pays back whatever it registered. */
  private activateScope(entry: ActivePlugin, settings: PluginSettings): void {
    const handler = entry.nativeHandler;
    if (!handler?.activate) return;
    const scope = new PluginScope();
    entry.scope = scope;
    try {
      const result = handler.activate(scope, settings, this.adapter);
      if (result instanceof Promise) {
        result.catch((error) => {
          logger.error('Plugin activation failed', {
            id: entry.manifest.id,
            error: String(error),
          });
          void scope.dispose();
        });
      }
    } catch (error) {
      logger.error('Plugin activation failed', { id: entry.manifest.id, error: String(error) });
      void scope.dispose();
    }
  }

  /** Dispose the current scope, then re-activate under the new settings.
   *  Serialized per plugin; superseded or unmounted restarts re-activate
   *  nothing (the settings identity check spots a newer update). */
  private restartScope(entry: ActivePlugin, settings: PluginSettings): void {
    const previous = entry.scope;
    entry.scope = undefined;
    entry.scopeRestart = (entry.scopeRestart ?? Promise.resolve()).then(async () => {
      await previous?.dispose();
      if (this.active.get(entry.manifest.id) !== entry) return;
      if (entry.settings !== settings) return;
      this.activateScope(entry, settings);
    });
    // Begin teardown now: an immediate unmount cannot reach the scope held by this queue.
    void previous?.dispose();
  }

  /**
   * Remove the plugin now; the returned promise settles once its scopes have
   * finished tearing down (never rejects). Runtimes that are one per page wait
   * for it before a successor starts (`releaseLedger.ts`).
   */
  unmount(id: string): Promise<void> {
    const entry = this.active.get(id);
    if (!entry) return Promise.resolve();

    // Scope disposal is async (it awaits in-flight startup and async
    // disposers) but claim-once: firing it here and moving on is safe — no
    // effect can double-run or leak, and a remount gets a fresh scope.
    const teardown: Array<Promise<void> | undefined> = [entry.scopeRestart, entry.primitiveRestart];
    if (entry.scope) teardown.push(entry.scope.dispose());
    else entry.nativeHandler?.stop?.();
    if (entry.primitiveScope) teardown.push(entry.primitiveScope.dispose());
    entry.primitiveScope = undefined;
    entry.styleEl?.remove();
    this.releasePlugin(id);
    this.health.forget(id);

    this.active.delete(id);
    this.syncObserver();
    logger.info('Plugin unmounted', { id });
    const released = Promise.allSettled(teardown).then(() => undefined);
    this.onRelease?.(entry.manifest, released);
    return released;
  }

  unmountAll(): void {
    // oxlint-disable-next-line unicorn/no-useless-spread -- snapshot: the loop body mutates the collection
    for (const id of [...this.active.keys()]) void this.unmount(id);
    this.doc.getElementById(PLUGIN_BASE_STYLE_ID)?.remove();
    this.health.dispose();
  }

  /** Re-apply all active plugins' dom ops immediately (exposed for tests + the
   *  rAF scheduler). Idempotent. */
  reapplyNow(): void {
    this.ledger.restoreDetached();
    for (const entry of this.active.values()) this.applyDomOps(entry);
  }

  // --- internals -----------------------------------------------------------

  private ensureBaseStyle(): void {
    if (this.doc.getElementById(PLUGIN_BASE_STYLE_ID)) return;
    const style = this.doc.createElement('style');
    style.id = PLUGIN_BASE_STYLE_ID;
    style.textContent = `.${PLUGIN_HIDDEN_CLASS}{display:none !important;}`;
    this.styleRoot().appendChild(style);
  }

  private styleRoot(): Element {
    return this.doc.head ?? this.doc.documentElement;
  }

  private injectStyles(entry: ActivePlugin): void {
    const css = this.renderCss(entry);
    if (!css) return;
    const style = this.doc.createElement('style');
    style.id = `${PLUGIN_STYLE_ID_PREFIX}${entry.manifest.id}`;
    style.setAttribute(PLUGIN_MARKER_ATTR, entry.manifest.id);
    style.textContent = css;
    this.styleRoot().appendChild(style);
    entry.styleEl = style;
  }

  /** Join the plugin's CSS and substitute `{{key}}` tokens with the current
   *  setting values (falling back to each setting's declared default). This is
   *  bounded parameter substitution over declared keys — NOT a remote
   *  mini-language — so it stays within Chrome's "data, not code" allowance.
   *  Stored setting values never passed the manifest validator, so the rendered
   *  text is checked again and withheld whole when it could fetch remotely. */
  private renderCss(entry: ActivePlugin): string {
    const styles = entry.manifest.contributes.styles;
    if (!styles || styles.length === 0) return '';
    const css = this.renderTemplate(
      entry,
      styles.map((contribution) => contribution.css).join('\n'),
    );
    const issue = styleSheetIssue(css);
    if (issue) {
      logger.warn('Rendered plugin CSS rejected', { id: entry.manifest.id, issue });
      return '';
    }
    return css;
  }

  private renderTemplate(entry: ActivePlugin, value: string): string {
    return renderSettingTemplate(value, entry.manifest.contributes.settings, entry.settings);
  }

  private resolveSelector(ref: SelectorRef): string | null {
    if (ref.kind === 'css') return ref.selector;
    const selector = this.adapter?.selectors[ref.key];
    if (!selector) {
      logger.warn('Unknown semantic selector key', {
        key: ref.key,
        site: this.adapter?.id ?? 'none',
      });
      return null;
    }
    return selector;
  }

  private queryAll(ref: SelectorRef): Element[] {
    if (ref.kind === 'semantic') {
      const elements = resolveSemanticElements(this.doc, this.adapter, ref.key);
      if (elements) return [...elements];
    }
    const selector = this.resolveSelector(ref);
    if (!selector) return [];
    try {
      return Array.from(this.doc.querySelectorAll(selector));
    } catch {
      logger.warn('Invalid selector', { selector });
      return [];
    }
  }

  private applyDomOps(entry: ActivePlugin): void {
    const ops = entry.manifest.contributes.domOps;
    if (!ops) return;
    for (const op of ops) this.applyOp(entry, op);
  }

  private applyOp(entry: ActivePlugin, op: DomOperation): void {
    if (!isTargetedOp(op)) return; // primitives run through activatePrimitives
    const render = (value: string): string => this.renderTemplate(entry, value);
    for (const el of this.queryAll(op.target)) {
      if (!applyOpToElement(this.ledger, entry.manifest.id, el, op, render)) return;
    }
  }

  /** Remove every contribution of `id` from the shared ledgers. */
  private releasePlugin(id: string): void {
    this.ledger.release(id);
  }

  /** Observe only while some active plugin actually has domOps or awaits a
   *  health verdict — pure-CSS plugins get their behaviour from the
   *  stylesheet alone, and paying a MutationObserver callback per DOM change
   *  for them is wasted work. */
  private syncObserver(): void {
    if (this.hasActiveDomOps() || this.health.hasTracked()) this.ensureObserver();
    else this.disconnectObserver();
  }

  private hasActiveDomOps(): boolean {
    for (const entry of this.active.values()) {
      if (entry.manifest.contributes.domOps?.some(isTargetedOp)) return true;
    }
    return false;
  }

  private ensureObserver(): void {
    if (this.observer) return;
    const target = this.doc.body ?? this.doc.documentElement;
    if (!target) return;
    this.observer = new MutationObserver(() => {
      this.health.noteMutation();
      if (this.hasActiveDomOps()) this.scheduleReapply();
    });
    this.observer.observe(target, { childList: true, subtree: true });
  }

  private disconnectObserver(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  private scheduleReapply(): void {
    if (this.reapplyScheduled) return;
    this.reapplyScheduled = true;
    const run = (): void => {
      this.reapplyScheduled = false;
      this.reapplyNow();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 16);
  }
}
