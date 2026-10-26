import packaged from '@/features/plugins/catalog/sites/gemini/selector-data/export-toolbar.json';

const CHATGPT_CONTROLS =
  '#conversation-header-actions,[data-testid="share-chat-button"],[data-testid="conversation-options-button"]';

export const BUNDLED_TOOLBAR_CONTROLS = `${packaged['exportToolbar.controls'].join(',')},${CHATGPT_CONTROLS}`;

export function resolveExportToolbarControls(): { readonly selector: string } {
  return { selector: BUNDLED_TOOLBAR_CONTROLS };
}

/** Measurements and mutation admission share the packaged control set. */
export function exportToolbarMutationControls(): string {
  return BUNDLED_TOOLBAR_CONTROLS;
}
