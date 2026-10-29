/**
 * The status `PluginHost` reports for every plugin whose `matches` cover the
 * page (D8). Incompatible and blocked plugins are reported with their
 * reason instead of being hidden; the popup renders these and adds its own
 * permission check. Every plugin that can run here also carries what each of
 * its DOM ops finds on the page now (`opDiagnostics.ts`). Read-only: it
 * decides nothing the reconcile pass acts on.
 */
import type { FormFactor } from '@/core/types/formFactor';

import { hostPolicyRefusal } from '../sites/hostPolicy';
import { matchesAnyPattern } from '../sites/matchPattern';
import { sharedTimelineAdmissionId } from '../sites/sharedTimelinePolicy';
import type { PluginManifest, SiteAdapter } from '../types';
import { hasPrimitive } from '../verbs/registry';
import type { DeclarativeEngine } from './declarativeEngine';
import { diagnoseOps } from './opDiagnostics';
import { type PluginStatus, findIncompatibility } from './pluginStatus';
import {
  type PluginBlock,
  type WishInput,
  blockedStatus,
  wishVerdict,
} from './reconcileArbitration';
import { duplicateResourceClaims } from './resourceClaims';

export interface StatusInput {
  readonly url: string;
  /** Every listed manifest; the ones whose `matches` miss the page are left out. */
  readonly manifests: readonly PluginManifest[];
  /** Plugins kept on their mounted version until a reload (plan D7). */
  readonly frozen: ReadonlyMap<string, { mounted: PluginManifest; pendingVersion: string }>;
  readonly adapter: SiteAdapter | null;
  /** The device class the page runs on (`needs-form-factor`). */
  readonly formFactor: FormFactor;
  /** The wish inputs of the last reconcile, to tell an admission still pending apart. */
  readonly wish: Omit<WishInput, 'admissionId'>;
  /** Plugins the last pass kept off by a conflict or a pending release. */
  readonly blocked: ReadonlyMap<string, PluginBlock>;
  readonly engine: Pick<DeclarativeEngine, 'isActive' | 'getHealth' | 'getZeroOps'> | null;
  /** The page the per-op counts read; counting writes nothing. */
  readonly doc: Document;
}

/** `ops` for a plugin with targeted DOM ops, nothing otherwise. */
function opsDetail(input: StatusInput, manifest: PluginManifest): Partial<PluginStatus> {
  const ops = diagnoseOps(input.doc, input.adapter, manifest);
  return ops.length > 0 ? { ops } : {};
}

export function collectPluginStatuses(input: StatusInput): readonly PluginStatus[] {
  const { url, engine } = input;
  const admission = input.wish.admission;
  const statuses: PluginStatus[] = [];
  for (const listed of input.manifests) {
    if (!matchesAnyPattern(url, listed.matches)) continue;
    const pinned = input.frozen.get(listed.id);
    const manifest = pinned?.mounted ?? listed;
    const pending = pinned ? { pendingVersion: pinned.pendingVersion } : {};
    if (hostPolicyRefusal(url, listed) !== null) {
      statuses.push(blockedStatus(manifest, { reason: 'host-policy' }, pending));
      continue;
    }
    const incompatibility = findIncompatibility({
      manifest,
      adapter: input.adapter,
      hasPrimitive,
      formFactor: input.formFactor,
    });
    if (incompatibility) {
      statuses.push({ ...incompatibility, ...pending });
      continue;
    }
    // Compatible from here on: say what each op finds, mounted or not.
    const detail = { ...pending, ...opsDetail(input, manifest) };
    if (duplicateResourceClaims(manifest).length > 0) {
      statuses.push(blockedStatus(manifest, { reason: 'duplicate-claim' }, detail));
      continue;
    }
    const admissionId = sharedTimelineAdmissionId(url, manifest);
    const admissionState = admissionId ? admission.stateOf(admissionId) : null;
    if (admissionState === 'denied') {
      statuses.push(blockedStatus(manifest, { reason: 'host-policy' }, detail));
      continue;
    }
    if (
      admissionId &&
      admissionState === 'pending' &&
      wishVerdict({ ...input.wish, admissionId, url }, manifest.id) === 'reserve'
    ) {
      statuses.push(blockedStatus(manifest, { reason: 'pending', by: admissionId }, detail));
      continue;
    }
    const base = { id: manifest.id, version: manifest.version, ...detail };
    const block = input.blocked.get(manifest.id);
    if (engine?.isActive(manifest.id)) {
      const zeroOps = engine.getZeroOps(manifest.id);
      statuses.push({
        ...base,
        kind: engine.getHealth(manifest.id) === true ? 'no-effect' : 'mounted',
        ...(zeroOps.length > 0 ? { zeroOps } : {}),
      });
    } else if (block) {
      statuses.push(blockedStatus(manifest, block, detail));
    } else {
      statuses.push({ ...base, kind: 'ready' });
    }
  }
  return statuses;
}
