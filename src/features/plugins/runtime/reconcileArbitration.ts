/**
 * The parts of `PluginHost.reconcile` that decide, rather than act: whether a
 * plugin runs, reserves its resources, or stays off as far as the user's wish
 * and the admission go, and the status of a plugin the page keeps off.
 */
import { ownedFeatureByPluginId } from '../sites/featureOwners';
import {
  type LegacySettingSnapshot,
  type WasChangedLive,
  hasEnableBinding,
} from '../storage/legacySettingBindings';
import type { PluginStateMap } from '../storage/pluginState';
import type { PluginManifest } from '../types';
import { type LegacyReadPhase, isPluginWanted } from './legacySnapshotFeed';
import type { OfficialAdmission } from './officialAdmission';
import type { PluginBlockedReason, PluginStatus } from './pluginStatus';

/**
 * run      wanted and admitted
 * reserve  would run but for an admission still pending: holds its resources
 *          in arbitration, never mounts
 * await    an owner-table official plugin whose legacy switch is still being
 *          read: whether it runs is unknown, so plugins needing its runtimes
 *          wait (`pending`) instead of taking them first; never mounts
 * skip     off
 */
export type WishVerdict = 'run' | 'reserve' | 'await' | 'skip';

const ADMITTED: OfficialAdmission = {
  stateOf: () => 'admitted',
  subscribe: () => () => {},
};

export interface WishInput {
  readonly url?: string;
  readonly state: PluginStateMap;
  /** The legacy switches official plugins follow; null until read (or for good, after a failed read). */
  readonly legacy: LegacySettingSnapshot | null;
  /** Whether that read is still in flight; `failed` and `none` never become a snapshot. */
  readonly legacyPhase: LegacyReadPhase;
  readonly admission: OfficialAdmission;
  /** Shared-data consumers wait on the native feature's start point, while retaining their own switch. */
  readonly admissionId?: string | null;
  /** Whether `id` is an owner-table official plugin. */
  readonly isOwned?: (id: string) => boolean;
  /** Which legacy keys changed live on this page, for a binding that derives its switch. */
  readonly wasChangedLive?: WasChangedLive;
}

const ownedInTable = (pluginId: string): boolean => ownedFeatureByPluginId(pluginId) !== null;

/**
 * The user's wish combined with the content script's admission. Owner-table
 * official features and shared-data consumers may reserve their start point; only a bound
 * official feature awaits its legacy switch. The official feature reserves once that switch has been read and
 * is on, and awaits while that read is in flight. The caller still checks the
 * page, host policy, compatibility and entitlement for `run`, `reserve` and
 * `await`.
 */
export function wishVerdict(input: WishInput, id: string): WishVerdict {
  const { state, legacy, admission } = input;
  const ownedByPlugin = (input.isOwned ?? ownedInTable)(id);
  const admissionId = input.admissionId ?? id;
  const admissionState = admission.stateOf(admissionId);
  if (admissionState === 'denied') return 'skip';
  if (legacy === null && hasEnableBinding(id)) {
    // A failed read never turns into "missing key, default on": the plugin
    // stays off, and nobody waits for a snapshot that will not come.
    return ownedByPlugin && input.legacyPhase === 'loading' ? 'await' : 'skip';
  }
  if (admissionState === 'admitted') {
    // Admission grants access to core data; the consumer still follows its own plugin switch.
    return isPluginWanted(state, legacy, ADMITTED, id, input.wasChangedLive, input.url)
      ? 'run'
      : 'skip';
  }
  if (!ownedByPlugin && admissionId === id) return 'skip';
  return isPluginWanted(state, legacy, ADMITTED, id, input.wasChangedLive, input.url)
    ? 'reserve'
    : 'skip';
}

export interface PluginBlock {
  readonly reason: PluginBlockedReason;
  readonly by?: string;
}

export function blockedStatus(
  manifest: PluginManifest,
  block: PluginBlock,
  extra: Partial<PluginStatus> = {},
): PluginStatus {
  return {
    id: manifest.id,
    version: manifest.version,
    ...extra,
    kind: 'blocked',
    blockedReason: block.reason,
    ...(block.by ? { blockedBy: block.by } : {}),
  };
}
