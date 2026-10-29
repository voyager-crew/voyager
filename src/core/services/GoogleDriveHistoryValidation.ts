import { isHighlightExportPayloadV1 } from '@/core/types/highlight';
import type { SyncPlatform } from '@/core/types/sync';
import { FOLDER_PLATFORMS } from '@/features/folder/platforms';
import { FolderImportExportService } from '@/features/folder/services/FolderImportExportService';
import { sanitizePluginState } from '@/features/plugins/storage/pluginState';
import { mergeStarState } from '@/features/savedLibrary/starSyncData';
import { decodeStarSyncSources } from '@/features/savedLibrary/starSyncPayload';
import { decodeCatalogTimelinePayload } from '@/features/timeline/catalogHierarchySync';
import { normalizeTimelineHierarchyData } from '@/features/timeline/hierarchyTypes';

import { decodePromptDrivePayload } from './drivePromptPayload';
import { anchorIdentity, isClearedByMarker } from './highlightAnnotationData';
import { isRecognizedSettingsHistory } from './settingsHistoryValidation';

export type SharedHistoryKind =
  | 'prompts'
  | 'plugins'
  | 'forks'
  | 'timelineHierarchy'
  | 'settings'
  | 'starred';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Overflowing JSON numbers would become null when sync serializes the restored content again. */
export function hasFiniteHistoryNumbers(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(hasFiniteHistoryNumbers);
  return !isRecord(value) || Object.values(value).every(hasFiniteHistoryNumbers);
}

/** JSON object key order is incidental; missing fields and array order are not. */
function sameContent(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left)) {
    return (
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => sameContent(item, right[index]))
    );
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  return (
    Object.keys(left).length === Object.keys(right).length &&
    Object.keys(left).every(
      (key) => Object.hasOwn(right, key) && sameContent(left[key], right[key]),
    )
  );
}

export function isLosslessFolderHistory(raw: unknown, platform: SyncPlatform): boolean {
  if (
    !isRecord(raw) ||
    raw.format !== 'gemini-voyager.folders.v1' ||
    !isRecord(raw.data) ||
    !isRecord(raw.data.folderContents)
  ) {
    return false;
  }
  const siteExport = FOLDER_PLATFORMS[platform].folderExport;
  const decoded = siteExport
    ? siteExport.read(raw)
    : (() => {
        const result = FolderImportExportService.validatePayload(raw);
        return result.success
          ? { ok: true as const, payload: result.data }
          : { ok: false as const };
      })();
  if (!decoded.ok || !sameContent(raw.data, decoded.payload.data)) return false;
  return Object.values(decoded.payload.data.folderContents).every(
    (bucket) => new Set(bucket.map((item) => item.conversationId)).size === bucket.length,
  );
}

function isLosslessForkData(data: unknown): boolean {
  if (!isRecord(data) || !isRecord(data.nodes) || !isRecord(data.groups)) return false;
  const groups = new Map<string, Set<string>>();
  for (const [conversationId, bucket] of Object.entries(data.nodes)) {
    // The fork importer indexes plain objects; inherited names cannot hold a node or group list.
    if (conversationId in Object.prototype || !Array.isArray(bucket) || bucket.length === 0) {
      return false;
    }
    const turnsByGroup = new Map<string, Set<string>>();
    for (const node of bucket) {
      if (
        !isRecord(node) ||
        typeof node.turnId !== 'string' ||
        node.conversationId !== conversationId ||
        typeof node.conversationUrl !== 'string' ||
        typeof node.forkGroupId !== 'string' ||
        node.forkGroupId in Object.prototype ||
        typeof node.forkIndex !== 'number' ||
        !Number.isFinite(node.forkIndex) ||
        typeof node.createdAt !== 'number' ||
        !Number.isFinite(node.createdAt) ||
        (node.conversationTitle !== undefined && typeof node.conversationTitle !== 'string')
      ) {
        return false;
      }
      const turns = turnsByGroup.get(node.forkGroupId) ?? new Set<string>();
      if (turns.has(node.turnId)) return false;
      turns.add(node.turnId);
      turnsByGroup.set(node.forkGroupId, turns);
      const members = groups.get(node.forkGroupId) ?? new Set<string>();
      members.add(`${node.conversationId}:${node.turnId}`);
      groups.set(node.forkGroupId, members);
    }
  }
  if (Object.keys(data).length !== 2 || Object.keys(data.groups).length !== groups.size) {
    return false;
  }
  return Object.entries(data.groups).every(([id, entries]) => {
    const expected = groups.get(id);
    return (
      expected !== undefined &&
      Array.isArray(entries) &&
      entries.length === expected.size &&
      new Set(entries).size === entries.length &&
      entries.every((entry) => typeof entry === 'string' && expected.has(entry))
    );
  });
}

/** The legacy reader preserves opaque star metadata, but the account field has a known type. */
function isLosslessLegacyStarHistory(raw: Record<string, unknown>): boolean {
  if (
    raw.format !== 'gemini-voyager.starred.v1' ||
    !isRecord(raw.data) ||
    !isRecord(raw.data.messages)
  ) {
    return false;
  }
  if (
    !Object.values(raw.data.messages).every(
      (bucket) =>
        Array.isArray(bucket) &&
        bucket.every(
          (item) =>
            isRecord(item) && (item.account === undefined || typeof item.account === 'string'),
        ),
    )
  ) {
    return false;
  }
  return sameContent(raw.data, decodeStarSyncSources({ v1: raw }, null).data);
}

export function isLosslessSharedHistory(kind: SharedHistoryKind, raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  if (kind === 'prompts') {
    if (!Array.isArray(raw.items)) return false;
    const decoded = decodePromptDrivePayload(raw);
    return (
      decoded !== null &&
      sameContent(raw.items, decoded.items) &&
      new Set(decoded.items.map((item) => item.id)).size === decoded.items.length
    );
  }
  if (kind === 'starred') return isLosslessLegacyStarHistory(raw);
  if (!isRecord(raw.data)) return false;
  switch (kind) {
    case 'plugins':
      return (
        raw.format === 'gemini-voyager.plugins.v1' &&
        sameContent(raw.data, sanitizePluginState(raw.data))
      );
    case 'forks':
      return raw.format === 'gemini-voyager.forks.v1' && isLosslessForkData(raw.data);
    case 'timelineHierarchy':
      return (
        raw.format === 'gemini-voyager.timeline-hierarchy.v1' &&
        sameContent(raw.data, normalizeTimelineHierarchyData(raw.data))
      );
    case 'settings':
      return raw.format === 'gemini-voyager.settings.v1' && isRecognizedSettingsHistory(raw.data);
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

export function isLosslessStarsHistory(raw: unknown): boolean {
  if (!isRecord(raw) || !Array.isArray(raw.items) || !Array.isArray(raw.tombstones)) {
    return false;
  }
  // Account authority was checked against the filename; navigation retargeting is not corruption.
  const decoded = decodeStarSyncSources({ v2: { ...raw, accountScope: undefined } }, null);
  const messages = new Map<string, unknown[]>();
  for (const item of raw.items) {
    if (!isRecord(item) || typeof item.conversationId !== 'string') return false;
    const bucket = messages.get(item.conversationId) ?? [];
    bucket.push(item);
    messages.set(item.conversationId, bucket);
  }
  if (
    !sameContent({ messages: Object.fromEntries(messages) }, decoded.data) ||
    !sameContent(raw.tombstones, decoded.tombstones)
  ) {
    return false;
  }
  // Test deletion conflicts at the earliest marker time so validity never depends on backup age.
  const earliest = decoded.tombstones.reduce((time, item) => Math.min(time, item.deletedAt), 0);
  return sameContent(decoded, mergeStarState([decoded.data], decoded.tombstones, earliest));
}

export function isLosslessHighlightHistory(raw: unknown, accountHash: string | undefined): boolean {
  if (
    !isHighlightExportPayloadV1(raw) ||
    accountHash === undefined ||
    raw.accountScope.accountHash !== accountHash
  ) {
    return false;
  }
  const idsByConversation = new Map<string, Set<string>>();
  const anchorsByConversation = new Map<string, Set<string>>();
  for (const item of raw.items) {
    if (
      item.accountHash !== accountHash ||
      item.platform !== raw.accountScope.platform ||
      // Imported records use a plain object keyed by id, including before any record is added.
      item.id in Object.prototype ||
      isClearedByMarker(item, raw.clearMarker)
    ) {
      return false;
    }
    const ids = idsByConversation.get(item.conversationId) ?? new Set<string>();
    if (ids.has(item.id)) return false;
    ids.add(item.id);
    idsByConversation.set(item.conversationId, ids);
    if (item.deletedAt !== undefined) continue;
    const anchors = anchorsByConversation.get(item.conversationId) ?? new Set<string>();
    const identity = anchorIdentity(item);
    if (anchors.has(identity)) return false;
    anchors.add(identity);
    anchorsByConversation.set(item.conversationId, anchors);
  }
  return true;
}

export function isLosslessCatalogHierarchyHistory(raw: unknown, site: string): boolean {
  if (!isRecord(raw) || !isRecord(raw.data)) return false;
  const decoded = decodeCatalogTimelinePayload(raw, site);
  return (
    sameContent(raw.data, decoded) &&
    Object.values(decoded).every((bucket) =>
      Object.keys(bucket.deleted ?? {}).every((id) => !Object.hasOwn(bucket.conversations, id)),
    )
  );
}
