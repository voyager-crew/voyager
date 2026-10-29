/** Test conveniences queue the real turn port; production exposes only runExclusive. */
import type { GoogleDriveSyncService } from '../../GoogleDriveSyncService';
import type { GoogleDriveSyncTransfer } from '../../GoogleDriveSyncTransfer';

export function createDriveTestClient(service: GoogleDriveSyncService) {
  return {
    authenticate: service.authenticate.bind(service),
    getState: service.getState.bind(service),
    setMode: service.setMode.bind(service),
    setProvider: service.setProvider.bind(service),
    signOut: service.signOut.bind(service),
    runExclusive: service.runExclusive.bind(service),
    upload: (...args: Parameters<GoogleDriveSyncTransfer['upload']>) =>
      service
        .runExclusive((port) => port.upload(...args))
        .then((result) => result.kind === 'uploaded')
        .catch(() => false),
    download: (...args: Parameters<GoogleDriveSyncTransfer['download']>) =>
      service.runExclusive((port) => port.download(...args)).catch(() => null),
    uploadPromptsOnly: (...args: Parameters<GoogleDriveSyncTransfer['uploadPromptsOnly']>) =>
      service.runExclusive((port) => port.uploadPromptsOnly(...args)).catch(() => false),
    downloadPromptsOnly: (...args: Parameters<GoogleDriveSyncTransfer['downloadPromptsOnly']>) =>
      service
        .runExclusive((port) => port.downloadPromptsOnly(...args))
        .catch((error: unknown) => ({ kind: 'failed' as const, error })),
    uploadHighlightsOnly: (...args: Parameters<GoogleDriveSyncTransfer['uploadHighlightsOnly']>) =>
      service.runExclusive((port) => port.uploadHighlightsOnly(...args)).catch(() => false),
    downloadHighlightsOnly: (
      ...args: Parameters<GoogleDriveSyncTransfer['downloadHighlightsOnly']>
    ) => service.runExclusive((port) => port.downloadHighlightsOnly(...args)).catch(() => null),
    uploadCatalogTimeline: (
      bySite: Parameters<GoogleDriveSyncTransfer['uploadCatalogData']>[0],
      interactive = true,
    ) =>
      service
        .runExclusive((port) => port.uploadCatalogData(bySite, undefined, [], interactive))
        .catch(() => false),
    syncCatalogStars: (
      store: NonNullable<Parameters<GoogleDriveSyncTransfer['uploadCatalogData']>[1]>,
      sites: Parameters<GoogleDriveSyncTransfer['uploadCatalogData']>[2],
      interactive = true,
    ) =>
      service
        .runExclusive((port) => port.uploadCatalogData({}, store, sites, interactive))
        .catch(() => false),
    downloadCatalogTimeline: (
      ...args: Parameters<GoogleDriveSyncTransfer['downloadCatalogTimeline']>
    ) => service.runExclusive((port) => port.downloadCatalogTimeline(...args)).catch(() => null),
    downloadCatalogStars: (...args: Parameters<GoogleDriveSyncTransfer['downloadCatalogStars']>) =>
      service.runExclusive((port) => port.downloadCatalogStars(...args)).catch(() => null),
  };
}
