/**
 * PluginHost — orchestrates the plugin lifecycle for the current page.
 *
 * Flow on start():
 *   1. resolve the SiteAdapter for the current URL (may be null on unknown sites)
 *   2. load manifests from all configured sources (builtin, bundled catalog,
 *      cached per-host remote catalog)
 *   3. load per-plugin enable state from storage, and the page's device class
 *      (`formFactor`). On Gemini / AI Studio the
 *      legacy switches packaged official plugins follow are read beside this,
 *      off the op chain: those plugins join in the reconcile after that read
 *      lands, once the content script admits them (`officialAdmission.ts`)
 *   4. reconcile: mount every plugin that (matches URL) AND (is enabled) AND
 *      (satisfies the engine version) AND (is not entitlement-locked) AND
 *      (wins the page-wide runtimes it needs, `resourceArbiter.ts`); unmount
 *      the rest. A winner whose runtime is still shutting down elsewhere waits
 *      for that release (`releaseLedger.ts`) off the op chain
 *   5. subscribe to state changes and re-reconcile (live enable/disable)
 *   6. subscribe to this host's remote catalog cache and to the user's local
 *      plugins, and reload on content change
 *   7. ask the background for a due catalog check on eligible top-frame pages.
 *      Native page startup requests locator checks; official plugins remain packaged.
 *
 * All providers (registry, sources, entitlement) are injected so the host is
 * fully unit-testable and the monetization/marketplace seams can be swapped
 * without touching this class.
 */
import { logger } from '@/core/services/LoggerService';
import type { FormFactor } from '@/core/types/formFactor';
import { isExtensionContextInvalidatedError } from '@/core/utils/extensionContext';
import { requestPageFormFactor } from '@/core/utils/formFactor';

import { LocalEntitlementProvider } from '../entitlement/LocalEntitlementProvider';
import { subscribeLocalPlugins } from '../local/localPluginStore';
import { subscribeHostCatalog } from '../remote/hostCatalogCache';
import { catalogHostFromUrl } from '../remote/hostCatalogPolicy';
import { resolveSiteAdapterForUrl, resolveSiteOverride } from '../remote/siteOverride';
import { SiteRegistry } from '../sites/registry';
import { createDefaultPluginSources, listPluginManifests } from '../sources/defaultSources';
import { type PluginStateMap, loadPluginState, subscribePluginState } from '../storage/pluginState';
import type {
  EntitlementProvider,
  PluginManifest,
  PluginSource,
  PluginSourceContext,
  SiteAdapter,
} from '../types';
import {
  type FrozenVersions,
  freezeUpdatedPrimitives,
  runningManifests,
  staleMountedIds,
} from './catalogReloadPlan';
import type { DeclarativeEngine } from './declarativeEngine';
import { createHostEngine } from './hostEngine';
import {
  type LegacySettingsSource,
  type LegacySnapshotFeed,
  openLegacySnapshotFeed,
} from './legacySnapshotFeed';
import { mountOrUpdate, unmountWhere } from './mountedSettings';
import { CLOSED_ADMISSION, type OfficialAdmission } from './officialAdmission';
import { OpChain } from './opChain';
import { evaluatePlugin, resolveRunSettings, targetsPage } from './pluginEligibility';
import {
  type PluginHostOptions,
  detectTopFrame,
  maybeRequestCatalogRefresh,
  sendCatalogRefreshRequest,
} from './pluginHostOptions';
import type { PluginStatus } from './pluginStatus';
import { collectPluginStatuses } from './pluginStatuses';
import { legacySettingsForPage } from './promptCoverageSettings';
import { reloadWithPromptManager } from './promptManagerReload';
import type { PluginBlock, WishVerdict } from './reconcileArbitration';
import { ReleaseLedger } from './releaseLedger';
import { arbitrate, nextHolders } from './resourceArbiter';
import { type SurfaceSwitch, surfaceSwitchForUrl } from './surfaceSwitch';

export type { PluginHostOptions };

export class PluginHost {
  private readonly url: string;
  private readonly registry: SiteRegistry;
  private readonly sources: readonly PluginSource[];
  private readonly entitlement: EntitlementProvider;
  private readonly doc: Document;
  private readonly context: PluginSourceContext;
  private readonly requestCatalogRefresh: (host: string) => void;
  private readonly isTopFrame: boolean;
  private readonly initialAdapter: Promise<SiteAdapter | null> | undefined;
  private readonly readFormFactor: () => Promise<FormFactor>;

  private adapter: SiteAdapter | null = null;
  private engine: DeclarativeEngine | null = null;
  private manifests: readonly PluginManifest[] = [];
  /**
   * Plugins whose newer manifest arrived while this page keeps the mounted
   * version (plan D7): primitive-backed contributions switch only on the next
   * full page load, so the mounted manifest is pinned here until then.
   */
  private readonly frozen: FrozenVersions = new Map();
  private state: PluginStateMap = {};
  /** Null until the initial read; no pass runs before it. */
  private formFactor: FormFactor | null = null;
  private unsubscribeState: (() => void) | null = null;
  private unsubscribeCatalog: (() => void) | null = null;
  private unsubscribeLocal: (() => void) | null = null;
  private unsubscribeSurface: (() => void) | null = null;
  private readonly surfaceSwitch: SurfaceSwitch | null;
  private readonly admission: OfficialAdmission;
  private readonly legacySettings: LegacySettingsSource;
  private unsubscribeAdmission: (() => void) | null = null;
  /** Legacy switches of bound official plugins, narrowed to shared keys off native surfaces. */
  private legacy: LegacySnapshotFeed | null = null;
  /** Whether the site's master switch lets plugins run (always true without one). */
  private surfaceOn = true;
  private started = false;
  /**
   * Monotonic lifecycle generation. start() and stop() each bump it; every
   * async pass captures the value at entry and aborts after any await if it
   * no longer matches, so a pass that straddles a stop→start restart can
   * never touch the new generation's engine (a bare `started` boolean would
   * read true again — the ABA case).
   */
  private generation = 0;
  private readonly opChain = new OpChain();
  /** Last settings pushed per plugin id, for change detection. */
  private readonly pushedSettings = new Map<string, string>();
  /**
   * Unfinished releases of page-wide runtimes. Owned here rather than by an
   * engine, and kept across stop()→start(), so a successor in a rebuilt
   * engine never starts beside a runtime that is still shutting down.
   */
  private readonly releases = new ReleaseLedger();
  /** Plugins holding their runtimes after the last pass; a holder is never displaced. */
  private holders: ReadonlySet<string> = new Set();
  /** Plugins the last pass kept off by a conflict or a pending release. */
  private blocked: ReadonlyMap<string, PluginBlock> = new Map();

  constructor(options: PluginHostOptions = {}) {
    this.url = options.url ?? location.href;
    this.registry = options.registry ?? SiteRegistry.createDefault();
    this.sources = options.sources ?? createDefaultPluginSources();
    this.entitlement = options.entitlement ?? new LocalEntitlementProvider();
    this.doc = options.doc ?? document;
    this.context = { url: this.url, host: catalogHostFromUrl(this.url) };
    this.requestCatalogRefresh = options.requestCatalogRefresh ?? sendCatalogRefreshRequest;
    this.isTopFrame = options.isTopFrame ?? detectTopFrame();
    this.initialAdapter = options.initialAdapter;
    this.readFormFactor = options.formFactor ?? requestPageFormFactor;
    this.surfaceSwitch =
      options.surfaceSwitch === undefined ? surfaceSwitchForUrl(this.url) : options.surfaceSwitch;
    this.admission = options.admission ?? CLOSED_ADMISSION;
    this.legacySettings = legacySettingsForPage(this.url, options.legacySettings);
  }

  get activeAdapter(): SiteAdapter | null {
    return this.adapter;
  }

  /** Live side-effect ledgers of scope-based plugins, keyed by plugin id. */
  getScopeLedgers(): Record<string, readonly string[]> {
    return this.engine?.getScopeLedgers() ?? {};
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const gen = ++this.generation;
    try {
      // Subscribe to this host's catalog BEFORE the adapter read: a background
      // refresh that CHANGES the catalog while that read is in flight must
      // still reach this instance. Until the engine exists the change is only
      // remembered and the initial pass replays it; afterwards every change
      // reloads + re-mounts on the serialized chain so new/changed plugin CSS
      // applies live without a page reload.
      const formFactorRead = this.readFormFactor(); // beside the reads below, never alone
      let engineReady = false;
      let catalogChangedBeforeEngine = false;
      const onSourceChange = (): void => {
        if (this.generation !== gen) return;
        if (!engineReady) {
          catalogChangedBeforeEngine = true;
          return;
        }
        void this.enqueue(() => this.reloadCatalog(gen));
      };
      const host = this.context.host;
      if (host) this.unsubscribeCatalog = subscribeHostCatalog(host, onSourceChange);
      // An import, update or removal of a local plugin is a catalog change too.
      this.unsubscribeLocal = subscribeLocalPlugins(onSourceChange);
      const requeue = (): void => {
        if (this.generation === gen) void this.enqueue(() => this.reconcile(gen));
      };
      // Visual effects shares its legacy choice on every already-injected page;
      // non-native pages read only those keys. Unbound plugins never wait on it.
      this.legacy = openLegacySnapshotFeed(this.legacySettings, requeue);
      // A published site override beats the bundled adapter for
      // pages it covers; resolved before the engine exists so semantic
      // selectors use the newest site knowledge from the first mount.
      const adapter = await (this.initialAdapter ?? this.resolveAdapter());
      if (this.generation !== gen) return;
      this.adapter = adapter;
      this.engine = this.createEngine(adapter);
      engineReady = true;
      // Subscribe BEFORE the initial reads: a state write that lands while
      // they are in flight must still reach this instance. The callback only
      // enqueues on the serialized chain, so nothing runs ahead of the
      // initial reconcile below.
      let stateFromListener: PluginStateMap | null = null;
      this.unsubscribeAdmission = this.admission.subscribe(requeue);
      this.unsubscribeState = subscribePluginState((next) => {
        if (this.generation !== gen) return;
        stateFromListener = next;
        this.state = next;
        void this.enqueue(() => this.reconcile(gen));
      });
      // The site's master switch follows the same pattern for surface plugins;
      // shared visual effects retain their independent early lifetime.
      let surfaceFromListener: boolean | null = null;
      const surfaceSwitch = this.surfaceSwitch;
      if (surfaceSwitch) {
        this.unsubscribeSurface = surfaceSwitch.subscribe((on) => {
          if (this.generation !== gen) return;
          surfaceFromListener = on;
          this.surfaceOn = on;
          void this.enqueue(() => this.reconcile(gen));
        });
      }
      // The initial read runs ON the chain, so a catalog reload the listener
      // queued meanwhile runs after it and its fresher listing wins.
      await this.enqueue(async () => {
        const manifests = await listPluginManifests(this.sources, this.context);
        const state = await loadPluginState();
        const surfaceOn = surfaceSwitch ? await surfaceSwitch.read() : true;
        const formFactor = await formFactorRead;
        if (this.generation !== gen) return;
        this.formFactor = formFactor;
        this.surfaceOn = surfaceFromListener ?? surfaceOn;
        this.manifests = manifests;
        // A listener revision that arrived mid-read is newer than what we read.
        this.state = stateFromListener ?? state;
        await this.reconcile(gen);
        // A catalog write that landed before the engine existed may have
        // swapped the site adapter this engine was built with: replay it.
        if (catalogChangedBeforeEngine) await this.reloadCatalog(gen);
      });
      if (this.generation !== gen) return;
      logger.info('PluginHost started', {
        site: this.adapter?.id ?? 'unknown',
        manifests: this.manifests.length,
      });
      const page = { host: this.context.host, url: this.url, isTopFrame: this.isTopFrame };
      maybeRequestCatalogRefresh(page, this.manifests, this.state, this.requestCatalogRefresh);
    } catch (error) {
      if (isExtensionContextInvalidatedError(error)) return;
      logger.error('PluginHost start failed', { error: String(error) });
    }
  }

  stop(): void {
    this.started = false;
    this.generation += 1;
    this.unsubscribeState?.();
    this.unsubscribeState = null;
    this.unsubscribeCatalog?.();
    this.unsubscribeCatalog = null;
    this.unsubscribeLocal?.();
    this.unsubscribeLocal = null;
    this.unsubscribeSurface?.();
    this.unsubscribeSurface = null;
    this.unsubscribeAdmission?.();
    this.unsubscribeAdmission = null;
    this.legacy?.stop();
    this.legacy = null;
    this.engine?.unmountAll();
    this.pushedSettings.clear();
    this.frozen.clear();
    // A restart arbitrates from scratch; unfinished releases stay in the ledger.
    this.holders = new Set();
    this.blocked = new Map();
  }

  /** Status of every plugin whose `matches` cover this page (`pluginStatuses.ts`). */
  getStatuses(): readonly PluginStatus[] {
    return collectPluginStatuses({
      url: this.url,
      manifests: this.manifests,
      frozen: this.frozen,
      adapter: this.adapter,
      formFactor: this.formFactor ?? 'desktop', // nothing is listed before it either
      wish: {
        state: this.state,
        legacy: this.legacy?.current() ?? null,
        legacyPhase: this.legacy?.phase() ?? 'none',
        admission: this.admission,
      },
      blocked: this.blocked,
      engine: this.engine,
      doc: this.doc,
    });
  }

  private createEngine(adapter: SiteAdapter | null): DeclarativeEngine {
    return createHostEngine({
      doc: this.doc,
      adapter,
      releases: this.releases,
      inspectPlugins: () => ({
        statuses: this.getStatuses(),
        manifests: runningManifests(this.manifests, this.frozen),
      }),
    });
  }

  /** Serialize reconcile/reload work so async passes never interleave (`opChain.ts`). */
  private enqueue(work: () => Promise<void>): Promise<void> {
    return this.opChain.enqueue(work);
  }

  /**
   * Reload catalog data. Adapter changes rebuild other plugins; an independent
   * Prompt Manager keeps its runtime while its dependencies stay unchanged.
   * Manifest update timing stays in `catalogReloadPlan.ts` (plan D7).
   */
  private async reloadCatalog(gen: number): Promise<void> {
    const engine = this.engine;
    if (!engine || this.generation !== gen) return;
    const [manifests, adapter] = await Promise.all([
      listPluginManifests(this.sources, this.context),
      this.resolveAdapter(),
    ]);
    if (this.generation !== gen) return;
    const listing = {
      previous: new Map(this.manifests.map((manifest) => [manifest.id, manifest])),
      next: manifests,
      isActive: (id: string) => engine.isActive(id),
    };
    freezeUpdatedPrimitives(this.frozen, listing, (manifest) => this.targetsThisPage(manifest));
    this.manifests = manifests;
    this.engine = reloadWithPromptManager({
      engine,
      previous: this.adapter,
      next: adapter,
      manifests: runningManifests(manifests, this.frozen),
      stale: staleMountedIds(listing, this.frozen),
      pushed: this.pushedSettings,
      targetsPage: (manifest) => this.targetsThisPage(manifest),
      create: () => this.createEngine(adapter),
    });
    this.adapter = adapter;
    await this.reconcile(gen);
  }

  private async resolveAdapter(): Promise<SiteAdapter | null> {
    const override = await resolveSiteOverride(this.sources, this.context);
    return resolveSiteAdapterForUrl(this.url, this.registry, override);
  }

  private async reconcile(gen: number): Promise<void> {
    // Snapshot everything the pass reads, so one pass never mixes two state
    // revisions (the storage listener replaces `this.state` outside the op
    // chain). A revision that lands mid-pass gets its own queued pass.
    const engine = this.engine;
    const state = this.state;
    const legacy = this.legacy?.current() ?? null;
    const legacyPhase = this.legacy?.phase() ?? 'none';
    const feed = this.legacy;
    const wasChangedLive = (key: string): boolean => feed?.wasChangedLive(key) ?? false;
    const manifests = runningManifests(this.manifests, this.frozen);
    const formFactor = this.formFactor;
    if (!engine || !formFactor) return;
    const verdicts: Record<Exclude<WishVerdict, 'skip'>, PluginManifest[]> = {
      run: [],
      reserve: [],
      await: [],
    };
    for (const manifest of manifests) {
      if (this.generation !== gen) return;
      const verdict = await evaluatePlugin(
        manifest,
        { state, legacy, legacyPhase, wasChangedLive },
        {
          url: this.url,
          surfaceOn: this.surfaceOn,
          admission: this.admission,
          adapter: this.adapter,
          formFactor,
          entitlement: this.entitlement,
        },
      );
      if (verdict !== 'skip') verdicts[verdict].push(manifest);
    }
    if (this.generation !== gen) return;
    // From here on nothing awaits: the pass acts on one consistent verdict.
    const wanted = verdicts.run;
    // Release what is no longer wanted first, so arbitration below already
    // sees a runtime handed over in this very pass as shutting down.
    const wantedIds = new Set(wanted.map((manifest) => manifest.id));
    unmountWhere(engine, this.pushedSettings, manifests, (id) => !wantedIds.has(id));
    const { granted, blocked } = arbitrate(wanted, verdicts.reserve, this.holders, {
      awaiting: verdicts.await,
      releasingBy: (resource) => this.releases.releasing(resource)?.pluginId ?? null,
    });
    // A running plugin arbitration kept off anyway (a holder never is, so normally none).
    unmountWhere(engine, this.pushedSettings, manifests, (id) => !granted.has(id));
    for (const block of blocked.values()) {
      if (block.reason === 'releasing') this.wakeWhenReleased(block.resources, gen);
    }
    for (const manifest of wanted) {
      if (!granted.has(manifest.id)) continue;
      const settings = resolveRunSettings(manifest, state, legacy);
      mountOrUpdate(engine, this.pushedSettings, manifest, settings);
    }
    this.holders = nextHolders({ granted, blocked }, this.holders, (id) => engine.isActive(id));
    this.blocked = blocked;
  }

  /**
   * Queue a pass for when each busy resource is free again. The op chain
   * itself never waits on a release, so a disposer that never settles blocks
   * only the plugins that need its runtime.
   */
  private wakeWhenReleased(resources: readonly string[], gen: number): void {
    for (const resource of resources) {
      // Keyed by generation: one queued pass per generation and resource.
      this.releases.whenFree(resource, String(gen), () => {
        if (this.generation === gen) void this.enqueue(() => this.reconcile(gen));
      });
    }
  }

  private targetsThisPage(manifest: PluginManifest): boolean {
    return targetsPage(this.url, manifest);
  }
}
