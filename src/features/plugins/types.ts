/**
 * Gemini Voyager — Plugin Ecosystem: core type contracts.
 *
 * Design goals (see ./README.md):
 *  - **Declarative-first.** The default plugin tier ships only data (CSS + JSON
 *    describing DOM operations). The interpreting engine lives in the extension
 *    package, so declarative plugins are Chrome MV3 "remotely-hosted code"
 *    compliant AND are almost certainly *not* GPL derivative works (data read by
 *    a program is not a derivative of it).
 *  - **Site-agnostic.** Plugins target sites via match patterns and reference DOM
 *    through a `SiteAdapter`'s semantic selector map, so a Gemini DOM change only
 *    requires updating the adapter, not every plugin.
 *  - **Extensible contribution points.** New capabilities are added as new keys on
 *    `PluginContributions` / new variants on `DomOperation` — never by letting a
 *    plugin run arbitrary top-level code.
 */

import type { FormFactor } from '@/core/types/formFactor';
import type { TranslationKey } from '@/utils/translations';

import type { BridgePolicySection } from './sites/sections/bridgePolicyData';
import type { SiteExportConfig } from './sites/sections/exportData';
import type { FoldersSection } from './sites/sections/foldersData';
import type { ModelPickerSection } from './sites/sections/modelPickerData';
import type { PageHooksSection } from './sites/sections/pageHooksData';
import type { ProjectsSection } from './sites/sections/projectsData';
import type { PromptSection } from './sites/sections/promptData';

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------

export const KNOWN_SITE_IDS = [
  'gemini',
  'aistudio',
  'chatgpt',
  'claude',
  'deepseek',
  'kimi',
] as const;
export type KnownSiteId = (typeof KNOWN_SITE_IDS)[number];

/**
 * A site identifier. Known ids get editor autocomplete; arbitrary strings are
 * still allowed so third parties can target sites Voyager ships no adapter for.
 */
export type SiteId = KnownSiteId | (string & {});

/** Coarse feature flags describing what a site exposes; lets plugins/host skip
 *  contributions a site can't support. */
export type SiteCapability = 'chat' | 'sidebar' | 'composer' | 'darkMode';

export interface SiteThemeDescriptor {
  /** Element that carries the theme class (e.g. `.theme-host` on Gemini, `body` on AI Studio). */
  readonly hostSelector: string;
  /** Selector present when the site is in light mode. */
  readonly lightSelector: string;
  /** Selector present when the site is in dark mode. */
  readonly darkSelector: string;
}

/**
 * Describes one host site. The plugin host resolves the adapter for the current
 * URL and hands it to the engine so `semantic` selector refs can be resolved.
 */
export interface SiteAdapter {
  /** Ordered, site-scoped page locators; query logic and safety guards stay packaged. */
  readonly locators?: import('./sites/sections/locatorData').SiteLocatorProfiles;
  /** Catalog source revision, stamped by the shared bundle/publishing pipeline. */
  readonly catalogRevision?: number;
  readonly id: SiteId;
  readonly label: string;
  readonly matches: readonly string[];
  /**
   * Stable semantic key → site-specific CSS selector. Plugins reference keys
   * (not raw selectors) to stay portable across site redesigns.
   */
  readonly selectors: Readonly<Record<string, string>>;
  readonly theme: SiteThemeDescriptor;
  /**
   * Optional brand accent (hex) for Voyager's OWN UI when running on this site —
   * the Prompt Manager, formula-copy toast, popup. Acts as the built-in default;
   * a matching plugin's `theme.brand` overrides it. Omit (e.g. Gemini / AI
   * Studio) to keep Voyager's native green.
   */
  readonly brandColor?: string;
  readonly capabilities: ReadonlySet<SiteCapability>;
  /**
   * Regular expression over `location.pathname` whose first capture group is
   * the conversation id (e.g. `^/chat/([^/?#]+)` on Claude). Consumed by
   * navigation primitives; absent for sites without per-conversation routes.
   */
  readonly conversationIdPattern?: string;
  /** Static router segments site-check reports may retain; all other segments are redacted. */
  readonly routeWords?: readonly string[];
  /** Site-check reports may retain `/u/<n>/` account slot indices on this site. */
  readonly accountSlots?: boolean;
  /** Redacted conversation routes when conversationIdPattern is absent; bundled only. */
  readonly conversationRoutes?: readonly string[];
  /** Packaged overrides of Prompt Manager's catalog adapter defaults. */
  readonly prompt?: PromptSection;
  /**
   * Attributes that keep one user message's identity across re-renders and
   * remounts, read from the `userTurn` element or its nearest ancestor carrying
   * one (the first present wins). Send tracking needs them to tell the message
   * a send produced from older ones mounting; omit them where the site has none.
   */
  readonly turnKeyAttributes?: readonly string[];
  /** Optional page facts for the conversationExport primitive. */
  readonly export?: SiteExportConfig;
  /**
   * Data for the Local Bridge `model.select` op. Optional and isolated: a bad
   * section is dropped without invalidating the adapter (`sectionIssues`).
   */
  readonly modelPicker?: ModelPickerSection;
  /**
   * Data for the Local Bridge `project.*` ops. Optional and isolated like
   * `modelPicker`: a bad section is dropped without invalidating the adapter.
   */
  readonly projects?: ProjectsSection;
  /**
   * Page markers and text fallbacks for the Local Bridge and the model picker.
   * Optional and isolated like `modelPicker`; without it the code's measured
   * defaults stand in where it has them, and every mode reads as unknown.
   */
  readonly pageHooks?: PageHooksSection;
  /**
   * Local Bridge kill switch: the ops this site's remote policy allows. Read by
   * the background's `bridgePolicy` straight from the catalog cache; content
   * code never consults it, and it is deliberately not part of
   * `isSameSiteAdapter`, so a policy change does not remount every plugin.
   */
  readonly bridge?: BridgePolicySection;
  /**
   * Page facts for the `folders` primitive: sidebar, rows, mount anchors, row
   * menu and title rules. Optional and isolated like `modelPicker`; without
   * it a plugin calling `folders` reports `needs-site-data`. What is written,
   * and where, never comes from here (`features/folder/sites/folderSiteTable.ts`).
   */
  readonly folders?: FoldersSection;
}

// ---------------------------------------------------------------------------
// Selector references
// ---------------------------------------------------------------------------

export interface CssSelectorRef {
  readonly kind: 'css';
  readonly selector: string;
}
export interface SemanticSelectorRef {
  readonly kind: 'semantic';
  readonly key: string;
}
export type SelectorRef = CssSelectorRef | SemanticSelectorRef;

/** Authoring sugar accepted in raw manifests: a bare string means a css selector. */
export type RawSelectorRef = string | SelectorRef;

export const cssRef = (selector: string): CssSelectorRef => ({ kind: 'css', selector });
export const semanticRef = (key: string): SemanticSelectorRef => ({ kind: 'semantic', key });

// ---------------------------------------------------------------------------
// Contributions
// ---------------------------------------------------------------------------

export interface StyleContribution {
  /** Raw CSS injected as a <style> element. Classes should be `gv-` prefixed. */
  readonly css: string;
  /** Optional source path when the CSS came from a plugin-authored style file. */
  readonly source?: string;
}

/**
 * Declarative DOM operations interpreted by the bundled engine. Every variant is
 * fully reversible on teardown. New variants are the primary extension point —
 * add a case here + a handler in the engine; never execute plugin-authored code.
 */
export type DomOperation =
  | { readonly op: 'addClass'; readonly target: SelectorRef; readonly className: string }
  | {
      readonly op: 'setAttribute';
      readonly target: SelectorRef;
      readonly name: string;
      readonly value: string;
    }
  | {
      readonly op: 'setStyle';
      readonly target: SelectorRef;
      readonly styles: Readonly<Record<string, string>>;
    }
  | { readonly op: 'hide'; readonly target: SelectorRef }
  | NativeOperation;

/**
 * Invoke a first-party primitive by name with configuration (D9). The
 * handler must exist in `verbs/registry.ts`; `params` are validated by that
 * primitive's own guard. Configuration, never instructions (plan C1).
 */
export interface NativeOperation {
  readonly op: 'native';
  readonly handler: string;
  readonly params: Readonly<Record<string, unknown>>;
}

export type DomOperationKind = DomOperation['op'];

/** True for a plugin whose contributions run first-party JS (a `native` op). */
export function hasNativeOps(manifest: Pick<PluginManifest, 'contributes'>): boolean {
  return (manifest.contributes.domOps ?? []).some((op) => op.op === 'native');
}

/** Schema for a user-configurable plugin setting (rendered by the store UI later). */
export interface SettingField {
  readonly type: 'boolean' | 'number' | 'string' | 'color' | 'select';
  readonly label: string;
  readonly default: boolean | number | string;
  /** Disable this control unless another, independent boolean setting resolves to true. */
  readonly enabledBy?: string;
  /** Optional label for the low end of a number/range control. */
  readonly minLabel?: string;
  /** Optional label for the high end of a number/range control. */
  readonly maxLabel?: string;
  readonly options?: readonly { readonly value: string; readonly label: string }[];
  readonly min?: number;
  readonly max?: number;
  /** Marks a setting still being trialled, as the native settings do. */
  readonly experimental?: boolean;
  /**
   * First-party only: reuse the extension's own message keys so a builtin setting shares the
   * native setting's wording. The manifest validator drops it from catalog and remote data.
   */
  readonly messageKeys?: { readonly label: TranslationKey; readonly hint?: TranslationKey };
  /**
   * First-party only: a boolean that works only with one choice of a select. While it is on, the
   * select's other choices are disabled, and turning it on writes that choice in the same write.
   * The manifest validator drops it from catalog and remote data.
   */
  readonly requiresChoice?: { readonly setting: string; readonly value: string };
}
export type SettingsSchema = Readonly<Record<string, SettingField>>;

/** A resolved user-configurable setting value. */
export type PluginSettingValue = string | number | boolean;
/** Resolved setting values for one plugin (keyed by the schema's keys). */
export type PluginSettings = Readonly<Record<string, PluginSettingValue>>;

export interface PluginContributions {
  readonly styles?: readonly StyleContribution[];
  readonly domOps?: readonly DomOperation[];
  readonly settings?: SettingsSchema;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * `declarative` = data only (CSS + JSON), interpreted by the engine. Store-safe
 * everywhere, remote-loadable, non-derivative.
 * `scripted` = ships JS; would run via `chrome.userScripts` (gated behind the
 * user's "Allow User Scripts" toggle) and is unavailable on Safari. Reserved for
 * an advanced tier with no runtime yet: such a plugin reports `needs-handler`.
 */
export type PluginTier = 'declarative' | 'scripted';

/**
 * Plugin classification, shown in the store and used for filtering. Known values
 * get autocomplete; arbitrary strings are allowed so authors aren't boxed in.
 */
export const PLUGIN_CATEGORIES = [
  'render-fix',
  'theme',
  'layout',
  'readability',
  'productivity',
  'integration',
  'other',
] as const;
export type KnownPluginCategory = (typeof PLUGIN_CATEGORIES)[number];
export type PluginCategory = KnownPluginCategory | (string & {});

/**
 * Optional brand theming a plugin contributes for the site(s) it matches. The
 * author declares only a single accent `brand` (hex); Voyager derives the
 * hover / soft / foreground shades via CSS `color-mix`. Overrides the matching
 * `SiteAdapter.brandColor`.
 */
export interface PluginTheme {
  /** Accent colour as a hex string (e.g. `#d97757`). */
  readonly brand: string;
}

export interface LocalizedSettingField {
  readonly label?: string;
  readonly minLabel?: string;
  readonly maxLabel?: string;
  /** Select option value → localized label. */
  readonly options?: Readonly<Record<string, string>>;
}

export interface PluginLocalization {
  readonly name?: string;
  readonly description?: string;
  /** One line describing the latest version (plan D11). */
  readonly changelog?: string;
  readonly settings?: Readonly<Record<string, LocalizedSettingField>>;
}

/**
 * What a plugin needs from the host beyond the engine range (D8).
 * Checked by the status machine; a miss disables the plugin with a reason
 * instead of hiding it.
 */
export interface PluginRequirements {
  /** Primitive names the plugin invokes through `native` ops. */
  readonly handlers?: readonly string[];
  /** Semantic selector keys the plugin expects the site adapter to define. */
  readonly semantic?: readonly string[];
  /**
   * Device classes the plugin runs on. Absent means `["desktop"]`: a phone
   * reports `needs-form-factor` until a plugin adds `"mobile"`. A build that
   * predates the key ignores it and runs the plugin as it always did.
   */
  readonly formFactors?: readonly FormFactor[];
}

export interface PluginManifest {
  /** Globally unique, reverse-dotted (e.g. `vendor.my-plugin`). */
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly author: string;
  /** Classification (e.g. `render-fix`, `theme`, `readability`). */
  readonly category: PluginCategory;
  /** SPDX expression (e.g. `MIT`, `GPL-3.0-or-later`, `Proprietary`). */
  readonly license: string;
  readonly homepage?: string;
  /** Semver range the plugin requires of the host engine (e.g. `>=1.0.0`). */
  readonly engine: string;
  readonly tier: PluginTier;
  /** URL match patterns the plugin applies to (glob subset of Chrome match patterns). */
  readonly matches: readonly string[];
  readonly contributes: PluginContributions;
  /** Optional brand accent for Voyager UI on the matched site(s). */
  readonly theme?: PluginTheme;
  /** Manifest format major; absent means 1. Host files always carry it. */
  readonly format?: number;
  readonly requires?: PluginRequirements;
  /** One line describing the latest version, shown in the popup (plan D11). */
  readonly changelog?: string;
  /**
   * Optional localized metadata and setting labels, keyed by app language code
   * (`en`, `zh`, `zh_TW`, `ja`, …). Per-field fallback to the top-level English
   * fields when a translation is missing.
   */
  readonly i18n?: Readonly<Record<string, PluginLocalization>>;
}

/** Where an installed plugin came from. Drives trust + update behaviour. */
export type PluginSourceRef =
  | { readonly type: 'builtin' }
  | { readonly type: 'local' }
  | { readonly type: 'marketplace'; readonly marketplaceId: string; readonly url?: string }
  | { readonly type: 'host-catalog'; readonly host: string };

/** Whether the user is allowed to run a plugin (paywall seam). */
export type EntitlementState = 'free' | 'entitled' | 'trial' | 'locked';

export interface InstalledPlugin {
  readonly manifest: PluginManifest;
  readonly source: PluginSourceRef;
  readonly enabled: boolean;
  readonly entitlement: EntitlementState;
}

// ---------------------------------------------------------------------------
// Provider seams (swap implementations to add a marketplace / paid store)
// ---------------------------------------------------------------------------

/**
 * Which tier a source belongs to. Drives the merge rules in
 * `listPluginManifestsWithSources`: `builtin` ids are never overridden by a
 * remote entry, `remote` entries win over `bundled` snapshots when compatible,
 * and `local` (user-imported) plugins are merged last under their own
 * `local.*` ids, outside the kill switch. A source without a kind is merged
 * like a bundled snapshot.
 */
export type PluginSourceKind = 'builtin' | 'bundled' | 'remote' | 'local';

/**
 * Where a listing happens. `host` selects the per-host remote catalog; `url`
 * scopes the remote kill switch to plugins that actually target this page.
 */
export interface PluginSourceContext {
  readonly host?: string;
  readonly url?: string;
}

/** A place plugin manifests come from (builtin bundle, bundled snapshot, per-host remote catalog). */
export interface PluginSource {
  readonly id: string;
  readonly kind?: PluginSourceKind;
  list(context?: PluginSourceContext): Promise<readonly PluginManifest[]>;
  /**
   * Remote sources only: legacy authority check for a cached catalog at
   * `context.host`. Alone it cannot revoke snapshot plugins: revocations must
   * come from `listWithAuthority`, together with manifests and authority.
   */
  isAuthoritative?(context?: PluginSourceContext): Promise<boolean>;
  /**
   * Remote sources only: manifests, revocations and authority from ONE cache
   * read, so a background write cannot split their versions. Preferred by the
   * merger when present.
   */
  listWithAuthority?(context?: PluginSourceContext): Promise<PluginSourceListing>;
  /**
   * Remote sources only: the site adapter published for `context.host`, when
   * a usable cached catalog carries one. Replaces the bundled adapter for
   * pages it covers.
   */
  siteOverride?(context?: PluginSourceContext): Promise<SiteAdapter | null>;
}

export interface PluginSourceListing {
  readonly manifests: readonly PluginManifest[];
  readonly authoritative: boolean;
  readonly revoked?: readonly string[];
}

/** Decides whether a plugin may run (always `free` now; account/Stripe later). */
export interface EntitlementProvider {
  getState(pluginId: string): Promise<EntitlementState>;
}
