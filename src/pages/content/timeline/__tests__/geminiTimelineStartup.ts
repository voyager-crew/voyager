import { CleanupManager } from '@/core/utils/cleanupManager';

/** The actual official manifest, registered handler, legacy settings and native admission seam. */
export async function mountTimelinePluginOnPage(): Promise<() => void> {
  const { createOfficialAdmission } = await import('@/features/plugins/runtime/officialAdmission');
  const { getNativeHandler } = await import('@/features/plugins/runtime/nativeHandlers');
  const { PluginHost } = await import('@/features/plugins/runtime/PluginHost');
  const { BuiltinPluginSource } = await import('@/features/plugins/sources/BuiltinPluginSource');
  const { OFFICIAL_PLUGIN_IDS } = await import('@/features/plugins/sites/featureOwners');
  const { registerBuiltinNativeHandlers } = await import('../../pluginNativeRegistration');
  const { createGeminiBuiltinStartup } = await import('../../geminiBuiltinStartup');
  const cleanup = new CleanupManager();
  const admission = createOfficialAdmission();
  const stopRegistration = getNativeHandler(OFFICIAL_PLUGIN_IDS.geminiTimeline)
    ? undefined
    : registerBuiltinNativeHandlers();
  await createGeminiBuiltinStartup(admission, cleanup).startTimeline();
  admission.close();
  const host = new PluginHost({
    url: location.href,
    sources: [new BuiltinPluginSource()],
    admission,
    doc: document,
    isTopFrame: true,
    requestCatalogRefresh: () => {},
  });
  await host.start();
  return () => {
    host.stop();
    cleanup.executeCleanups();
    stopRegistration?.();
  };
}
