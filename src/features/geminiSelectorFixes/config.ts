import { isRemotePluginCatalogEnabledAtBuild } from '@/features/plugins/remote/config';

/** Both release switches disable the separate Gemini data channel, including cache use. */
export function isGeminiSelectorRemoteEnabledAtBuild(): boolean {
  const flag: unknown = import.meta.env.VOYAGER_GEMINI_SELECTOR_REMOTE;
  return (
    isRemotePluginCatalogEnabledAtBuild() &&
    !(typeof flag === 'string' && flag.trim().toLowerCase() === 'off')
  );
}
