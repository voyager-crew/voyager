import { OFFICIAL_PLUGIN_IDS } from '../sites/featureOwners';
import type { PluginManifest } from '../types';

const FONT_SIZE_PLUGIN_IDS = new Set([
  OFFICIAL_PLUGIN_IDS.geminiChatFontSize,
  'voyager.chatgpt-reading-typography',
  'voyager.claude-reading-typography',
  'voyager.deepseek-reading-typography',
  'voyager.kimi-reading-typography',
]);

/** The same percentage input and reset in full settings and the floating panel. */
export function isFontSizeSetting(plugin: PluginManifest, key: string): boolean {
  return key === 'fontSize' && FONT_SIZE_PLUGIN_IDS.has(plugin.id);
}
