import { isHighlightExportPayloadV1, type HighlightExportPayloadV1 } from '@/core/types/highlight';
import type { ForkExportPayload, SyncAccountScope } from '@/core/types/sync';
import { UnrecognizedDriveFileError } from '@/core/utils/driveReadResult';
import { hashString } from '@/core/utils/hash';
import { FolderImportExportService } from '@/features/folder/services/FolderImportExportService';
import { retargetImportedStarState } from '@/features/savedLibrary/starAccountRoute';
import { mergeStarredMessages } from '@/features/savedLibrary/starData';
import { mergeStarState } from '@/features/savedLibrary/starSyncData';
import {
  buildStarsV2,
  decodeStarsV2,
  decodeStarSyncSources,
} from '@/features/savedLibrary/starSyncPayload';
import { normalizeTimelineHierarchyData } from '@/features/timeline/hierarchyTypes';
import {
  mergeFolderData,
  mergeForkNodes,
  mergePrompts,
  mergeTimelineHierarchy,
} from '@/utils/merge';

import { extractRouteUserIdFromUrl } from './AccountIsolationService';
import { decodePromptDrivePayload } from './drivePromptPayload';
import { compareHighlightRecords, resolveHighlightClearMarker } from './highlightAnnotationData';
import { countCloudUploadItems } from './uploadGuard';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new UnrecognizedDriveFileError();
  return Object.fromEntries(Object.entries(value));
}

function matches(url: string, scope: SyncAccountScope): boolean {
  const route = extractRouteUserIdFromUrl(url);
  return route === null || route === scope.routeUserId;
}

/** Only the envelope identity changes at the cloud boundary; local buckets and record ids stay put. */
export function translateCloudIdentity(
  value: unknown,
  from: SyncAccountScope,
  to: SyncAccountScope,
): unknown {
  const raw = record(value);
  if (raw.format === 'gemini-voyager.stars.v2') {
    return buildStarsV2(
      decodeStarsV2(value, from),
      to,
      typeof raw.version === 'string' ? raw.version : '',
    );
  }
  if (raw.format === 'gemini-voyager.annotations.v1') {
    if (!isHighlightExportPayloadV1(value)) throw new UnrecognizedDriveFileError();
    const expected = hashString(from.accountKey);
    if (
      value.accountScope.accountHash !== expected ||
      value.items.some((item) => item.accountHash !== expected)
    ) {
      throw new UnrecognizedDriveFileError();
    }
    const accountHash = hashString(to.accountKey);
    return {
      ...value,
      accountScope: { ...value.accountScope, accountHash },
      items: value.items.map((item) => ({ ...item, accountHash })),
    };
  }
  return value;
}

export function prepareStarredMergeBase(
  value: unknown,
  scope: SyncAccountScope,
  authorized: boolean,
): unknown {
  const raw = record(value);
  if (raw.format !== 'gemini-voyager.starred.v1') return value;
  const held = decodeStarSyncSources(
    { v1: value, ...(authorized ? { v1AccountHash: hashString(scope.accountKey) } : {}) },
    scope,
  );
  return { ...raw, data: held.data };
}

function mergeHighlights(
  current: unknown | null,
  legacy: unknown,
  source: SyncAccountScope,
  target: SyncAccountScope,
): HighlightExportPayloadV1 {
  if (!isHighlightExportPayloadV1(legacy)) throw new UnrecognizedDriveFileError();
  const accepted = translateCloudIdentity(
    { ...legacy, items: legacy.items.filter((item) => matches(item.conversationUrl, source)) },
    source,
    target,
  );
  if (!isHighlightExportPayloadV1(accepted)) throw new UnrecognizedDriveFileError();
  if (current === null) return accepted;
  if (!isHighlightExportPayloadV1(current)) throw new UnrecognizedDriveFileError();
  const items = new Map(current.items.map((item) => [item.id, item]));
  for (const item of accepted.items) {
    const held = items.get(item.id);
    if (!held || compareHighlightRecords(item, held) > 0) items.set(item.id, item);
  }
  const clearMarker = resolveHighlightClearMarker(current.clearMarker, accepted.clearMarker);
  return { ...current, ...(clearMarker ? { clearMarker } : {}), items: [...items.values()] };
}

/** A route-named file is a filtered merge source, never a replacement or upload target. */
export function mergeLegacyDrivePayload(
  current: unknown | null,
  legacy: unknown,
  source: SyncAccountScope,
  target: SyncAccountScope,
): unknown {
  const raw = record(legacy);
  switch (raw.format) {
    case 'gemini-voyager.prompts.v1': {
      const incoming = decodePromptDrivePayload(legacy);
      const held = current === null ? null : decodePromptDrivePayload(current);
      if (!incoming || (current !== null && !held)) throw new UnrecognizedDriveFileError();
      return { ...(held ?? incoming), items: mergePrompts(held?.items ?? [], incoming.items) };
    }
    case 'gemini-voyager.folders.v1': {
      const incoming = FolderImportExportService.validatePayload(legacy);
      const held = current === null ? null : FolderImportExportService.validatePayload(current);
      if (!incoming.success || (held && !held.success)) throw new UnrecognizedDriveFileError();
      const data = incoming.data.data;
      const filtered = {
        ...data,
        folderContents: Object.fromEntries(
          Object.entries(data.folderContents).map(([id, items]) => [
            id,
            items.filter((item) => matches(item.url, source)),
          ]),
        ),
      };
      return {
        ...incoming.data,
        data: mergeFolderData(
          held?.success ? held.data.data : { folders: [], folderContents: {} },
          filtered,
        ),
      };
    }
    case 'gemini-voyager.forks.v1': {
      if (
        countCloudUploadItems('forks', legacy) === null ||
        (current !== null && countCloudUploadItems('forks', current) === null)
      )
        throw new UnrecognizedDriveFileError();
      // The guard's boundary parser validated the envelope and every fork node.
      const incoming = legacy as ForkExportPayload;
      const held = current as ForkExportPayload | null;
      const nodes = Object.fromEntries(
        Object.entries(incoming.data.nodes).map(([id, items]) => [
          id,
          items.filter((item) => matches(item.conversationUrl, source)),
        ]),
      );
      return {
        ...incoming,
        data: mergeForkNodes(held?.data ?? { nodes: {}, groups: {} }, { nodes, groups: {} }),
      };
    }
    case 'gemini-voyager.timeline-hierarchy.v1': {
      if (
        countCloudUploadItems('timelineHierarchy', legacy) === null ||
        (current !== null && countCloudUploadItems('timelineHierarchy', current) === null)
      )
        throw new UnrecognizedDriveFileError();
      const incoming = normalizeTimelineHierarchyData(raw.data);
      const data = {
        conversations: Object.fromEntries(
          Object.entries(incoming.conversations).filter(([, value]) =>
            matches(value.conversationUrl, source),
          ),
        ),
      };
      return {
        ...raw,
        data: mergeTimelineHierarchy(
          current === null
            ? { conversations: {} }
            : normalizeTimelineHierarchyData(record(current).data),
          data,
        ),
      };
    }
    case 'gemini-voyager.starred.v1': {
      const incoming = decodeStarSyncSources({ v1: legacy }, source);
      const held = decodeStarSyncSources(
        { v1: current, v1AccountHash: hashString(target.accountKey) },
        target,
      );
      return { ...raw, data: mergeStarredMessages(held.data, incoming.data) };
    }
    case 'gemini-voyager.stars.v2': {
      if (!Array.isArray(raw.items) || !Array.isArray(raw.tombstones))
        throw new UnrecognizedDriveFileError();
      const filter = (item: unknown) =>
        typeof record(item).conversationUrl === 'string' &&
        matches(String(record(item).conversationUrl), source);
      const filtered = {
        ...raw,
        items: raw.items.filter(filter),
        tombstones: raw.tombstones.filter(filter),
      };
      const incoming = retargetImportedStarState(decodeStarsV2(filtered, source), target);
      const held =
        current === null
          ? { data: { messages: {} }, tombstones: [] }
          : decodeStarsV2(current, target);
      return buildStarsV2(
        mergeStarState(
          [held.data, incoming.data],
          [...held.tombstones, ...incoming.tombstones],
          Date.now(),
        ),
        target,
        typeof raw.version === 'string' ? raw.version : '',
      );
    }
    case 'gemini-voyager.annotations.v1':
      return mergeHighlights(current, legacy, source, target);
    default:
      throw new UnrecognizedDriveFileError();
  }
}
