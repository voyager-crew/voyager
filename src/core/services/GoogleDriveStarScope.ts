import type { SyncAccountScope } from '@/core/types/sync';
import { EXTENSION_VERSION } from '@/core/utils/version';
import { createStarSiteClassifier } from '@/features/savedLibrary/starSitePolicy';
import { mergeStarState, type StarState } from '@/features/savedLibrary/starSyncData';
import {
  buildStarsV2,
  decodeStarSyncSources,
  type StarSyncSources,
} from '@/features/savedLibrary/starSyncPayload';

import { STARRED_FILE_NAME, STARS_FILE_NAME } from './GoogleDriveSyncFileNames';
import type { GoogleDriveDownload } from './GoogleDriveSyncPayloads';

/** A site's row ignores catalog compatibility copies which have their own sync rows/files. */
export function nativeStarBaselineContent(name: string, payload: unknown): unknown {
  const base = name.replace(/\.acct-[^.]+(?=\.json$)/, '');
  if (base !== STARS_FILE_NAME && base !== STARRED_FILE_NAME) return undefined;
  if (!payload || typeof payload !== 'object') throw new Error('invalid_star_payload');
  const state = decodeStarSyncSources(
    base === STARS_FILE_NAME ? { v2: { ...payload, accountScope: undefined } } : { v1: payload },
    null,
  );
  const native = selectSyncScopeStars(state, [], true);
  return base === STARS_FILE_NAME
    ? buildStarsV2(native, null, EXTENSION_VERSION)
    : legacyStarredExport(native.data);
}
import { legacyStarredExport } from './legacyStarredExport';

export function filterDownloadedStarScopes(
  data: GoogleDriveDownload,
  scope: SyncAccountScope | null,
  sites?: readonly string[],
): GoogleDriveDownload {
  if (!sites) return data;
  const starred = data.starred
    ? {
        ...data.starred,
        data: selectSyncScopeStars(
          decodeStarSyncSources(
            { v1: data.starred, v1AccountHash: data.starredAccountHash },
            scope,
          ),
          sites,
          true,
        ).data,
      }
    : null;
  const stars = data.stars
    ? buildStarsV2(
        selectSyncScopeStars(decodeStarSyncSources({ v2: data.stars }, scope), sites, true),
        scope,
        data.stars.version,
      )
    : null;
  return { ...data, starred, stars };
}

export function selectSyncScopeStars(
  state: StarState,
  sites: readonly string[],
  included: boolean,
): StarState {
  const siteOf = createStarSiteClassifier();
  const keep = (id: string, url: string) => {
    const site = siteOf(id, url);
    return (site === null || sites.includes(site)) === included;
  };
  return {
    data: {
      messages: Object.fromEntries(
        Object.entries(state.data.messages)
          .map(
            ([id, items]) => [id, items.filter((item) => keep(id, item.conversationUrl))] as const,
          )
          .filter(([, items]) => items.length),
      ),
    },
    tombstones: state.tombstones.filter((item) => keep(item.conversationId, item.conversationUrl)),
  };
}

export function selectSyncScopeStarSources(
  source: StarSyncSources,
  scope: SyncAccountScope | null,
  sites: readonly string[],
): StarSyncSources {
  const selected: StarSyncSources = {};
  if (source.v2 != null) {
    const state = decodeStarSyncSources({ v2: source.v2 }, scope);
    selected.v2 = buildStarsV2(selectSyncScopeStars(state, sites, true), scope, EXTENSION_VERSION);
  }
  if (source.v1 != null) {
    const state = decodeStarSyncSources(
      { v1: source.v1, v1AccountHash: source.v1AccountHash },
      scope,
    );
    selected.v1 = {
      format: 'gemini-voyager.starred.v1',
      data: legacyStarredExport(selectSyncScopeStars(state, sites, true).data),
    };
    selected.v1AccountHash = source.v1AccountHash;
  }
  return selected;
}

/** Off rows retain their existing compatibility copy without entering this device's store. */
export function retainExcludedStars(
  payload: unknown,
  v2: boolean,
  remote: StarState,
  scope: SyncAccountScope | null,
  sites: readonly string[],
): unknown {
  const incoming = decodeStarSyncSources(v2 ? { v2: payload } : { v1: payload }, scope);
  const excluded = selectSyncScopeStars(remote, sites, false);
  const merged = mergeStarState(
    [incoming.data, excluded.data],
    [...incoming.tombstones, ...excluded.tombstones],
    Date.now(),
  );
  return v2
    ? buildStarsV2(merged, scope, EXTENSION_VERSION)
    : {
        format: 'gemini-voyager.starred.v1',
        exportedAt: new Date().toISOString(),
        version: EXTENSION_VERSION,
        data: legacyStarredExport(merged.data),
      };
}
