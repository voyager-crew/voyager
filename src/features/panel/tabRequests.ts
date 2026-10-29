import { NATIVE_HEALTH_STATUS_MESSAGE } from '@/core/gemini/nativeHealth';
import { CHATGPT_EXPORT_OPEN_MESSAGE } from '@/features/plugins/builtin/chatgptExport/openMessage';
import { PLUGIN_STATUS_MESSAGE } from '@/features/plugins/runtime/messages';

/** The popup's current top-frame requests. Never accept a destination tab from the panel. */
export const PANEL_TAB_REQUEST_TYPES = [
  NATIVE_HEALTH_STATUS_MESSAGE,
  PLUGIN_STATUS_MESSAGE,
  'gv.folders.getStructureForAI',
  'gv.folders.reload',
  'gv.sync.requestData',
  'gv.account.getContext',
  CHATGPT_EXPORT_OPEN_MESSAGE,
] as const;

type PanelTabRequestType = (typeof PANEL_TAB_REQUEST_TYPES)[number];
export type PanelTabRequest = { type: PanelTabRequestType } | { action: 'sync_to_ide' };

/** Strip extra fields as well as rejecting unknown requests; no arbitrary tab commands. */
export function parsePanelTabRequest(value: unknown): PanelTabRequest | null {
  if (!value || typeof value !== 'object') return null;
  if ('type' in value) {
    const type = PANEL_TAB_REQUEST_TYPES.find((type) => type === value.type);
    return type ? { type } : null;
  }
  return 'action' in value && value.action === 'sync_to_ide' ? { action: 'sync_to_ide' } : null;
}
