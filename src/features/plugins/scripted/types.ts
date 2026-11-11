import type { PluginManifest } from '../types';

export interface ScriptContribution {
  readonly source: string;
}

/** A manifest the local gate accepted with `allowScripted`: tier and script always come together. */
export type ScriptedManifest = PluginManifest & {
  readonly tier: 'scripted';
  readonly contributes: { readonly script: ScriptContribution };
};

export function isScriptedManifest(manifest: PluginManifest): manifest is ScriptedManifest {
  return manifest.tier === 'scripted' && manifest.contributes.script !== undefined;
}

/** Lowercase hex SHA-256 of what a review shows: the plugin's `matches` and its source. */
export type ScriptHash = string & { readonly __brand: 'ScriptHash' };

const SCRIPT_HASH = /^[0-9a-f]{64}$/;

export function parseScriptHash(value: unknown): ScriptHash | undefined {
  return typeof value === 'string' && SCRIPT_HASH.test(value) ? (value as ScriptHash) : undefined;
}

/** A scripted manifest with the hash of its current content. */
export interface ScriptedPlugin {
  readonly manifest: ScriptedManifest;
  readonly reviewHash: ScriptHash;
}

export interface ScriptedEnableEntry {
  /** The content the user reviewed and turned on; any other content is paused. */
  readonly reviewHash: ScriptHash;
  readonly enabledAt: number;
}

export interface ScriptedCrashNotice {
  readonly at: number;
  readonly url: string;
  /** Every plugin that ran on the load that never confirmed, this one included. */
  readonly withIds: readonly string[];
}

/** `StorageKeys.PLUGIN_SCRIPTED_STATE`, device-local and never in a backup. */
export interface ScriptedStateV1 {
  readonly version: 1;
  /** Kill switch: nothing scripted runs while set. */
  readonly stopped: boolean;
  readonly enabled: Readonly<Record<string, ScriptedEnableEntry>>;
  readonly crashNotices: Readonly<Record<string, ScriptedCrashNotice>>;
}

/** A scripted plugin as it ran on one page load: the review hash of the code registered then. */
export interface LoadedScript {
  readonly id: string;
  readonly reviewHash: ScriptHash;
}

/** One tab's page load, `StorageKeys.PLUGIN_SCRIPTED_LOADS` keyed by tab id; background-only writer. */
export type ScriptedLoadRecord =
  | {
      readonly status: 'loading';
      readonly url: string;
      readonly plugins: readonly LoadedScript[];
      readonly startedAt: number;
    }
  | {
      readonly status: 'suspect';
      readonly url: string;
      readonly plugins: readonly LoadedScript[];
      readonly startedAt: number;
    }
  | { readonly status: 'confirmed'; readonly url: string; readonly at: number };

export type UserScriptsAvailability =
  | { readonly kind: 'available' }
  /** `allow-user-scripts` from Chrome 138, `developer-mode` before it. */
  | { readonly kind: 'toggle-off'; readonly needs: 'allow-user-scripts' | 'developer-mode' }
  | { readonly kind: 'unsupported'; readonly browser: 'safari' | 'firefox' | 'mobile' | 'old' };

export type ScriptedPauseReason =
  | 'user-scripts-off'
  | 'unsupported'
  | 'stopped-all'
  | 'crash-guard'
  | 'needs-review'
  /** The browser refused to set up its isolated world, so it is not registered. */
  | 'world-setup';

export type ScriptedRunState =
  | { readonly kind: 'off' }
  | { readonly kind: 'running' }
  | { readonly kind: 'paused'; readonly reason: ScriptedPauseReason };
