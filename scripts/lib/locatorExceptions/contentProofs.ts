import type { LocatorLiteralException } from './types';

export const CONTENT_PROOFS_LITERAL_EXCEPTIONS: readonly LocatorLiteralException[] = [
  {
    file: 'src/pages/content/canvasExport/canvasTargets.ts',
    kind: 'proof',
    values: {
      'deep-research-immersive-panel': 1,
      'rich-textarea': 1,
    },
    reason:
      'Canvas code/document/menu proofs reject transcript/research/editor/dialog/action owners; these literals only establish unsafe ownership, not exported content.',
  },
  {
    file: 'src/pages/content/canvasExport/documentTargets.ts',
    kind: 'proof',
    values: {
      'deep-research-immersive-panel': 1,
      'rich-textarea': 1,
    },
    reason:
      'Canvas code/document/menu proofs reject transcript/research/editor/dialog/action owners; these literals only establish unsafe ownership, not exported content.',
  },
  {
    file: 'src/pages/content/canvasExport/menuInjection.ts',
    kind: 'protocol',
    values: {
      'gem-menu-item': 1,
      'gem-menu-item-content': 1,
    },
    reason:
      'gem-menu-item roles/content define the native menu keyboard-focus and clone-style protocol. Reads run inside an already accepted Canvas menu; they select enabled focus peers and restore active styling when Voyager adds/removes its sanitized clone, not an export data source.',
  },
  {
    file: 'src/pages/content/canvasExport/menuTargets.ts',
    kind: 'proof',
    values: {
      'rich-textarea': 1,
      'deep-research-immersive-panel': 1,
    },
    reason:
      'Canvas code/document/menu proofs reject transcript/research/editor/dialog/action owners; these literals only establish unsafe ownership, not exported content.',
  },
  {
    file: 'src/pages/content/deepResearch/dom.ts',
    kind: 'proof',
    values: {
      'user-query': 1,
    },
    reason:
      'The independent research-panel proof rejects native user-query ownership and requires the latest independently accepted assistant transcript owner before a remote panel can count.',
  },
  {
    file: 'src/pages/content/defaultModel/modelPickerMetadata.ts',
    kind: 'proof',
    values: {
      'gem-menu-item': 1,
    },
    reason:
      'hasNativeItemRole treats original gem-menu-item tag/menuitem/menuitemradio roles as native picker identity evidence; a repaired locator cannot invent an actionable model row.',
  },
  {
    file: 'src/pages/content/defaultModel/modelPickerSafety.ts',
    kind: 'proof',
    values: {
      '[value="thinking_level"]': 1,
      'user-query': 1,
      'model-response': 1,
      '[data-message-author-role]': 1,
      '.edit-container': 1,
      '.user-query-container.edit-mode': 1,
      '.user-query-container': 1,
    },
    reason:
      'Native button tag/role, thinking_level witness and picker row identity independently prove model/thinking controls. Exclusions reject editable/hidden/dialog/transcript/settings owners; composed row walking rejects nested controls before title movement.',
  },
  {
    file: 'src/pages/content/researchPack/actionTargets.ts',
    kind: 'proof',
    values: {
      'message-content': 1,
      '.markdown': 1,
      '.markdown-main-panel': 1,
    },
    reason:
      'Research action bar repair must remain under the original response and contain all native action controls without containing answer/thought content.',
  },
  {
    file: 'src/pages/content/responseNotification/pageSnapshot.ts',
    kind: 'proof',
    values: {
      '[data-message-author-role="user"]': 1,
      'user-query': 1,
    },
    reason:
      'Original user-role/native-host evidence is read within the independently accepted turn collection, with a renamed-host fallback. Fixed Copy/feedback control aliases are completion/Stop interaction evidence, not exported response discovery, and cannot be redefined by remote locators.',
  },
  {
    file: 'src/pages/content/usageStatus/usageDom.ts',
    kind: 'proof',
    values: {
      'model-response': 1,
      'user-query': 1,
      'bard-sidenav': 1,
    },
    reason:
      'Usage-root independent owner proof rejects transcript/sidebar/dialog/menu/editor/Voyager islands before accepting remote usage metrics.',
  },
  {
    file: 'src/pages/content/watermarkRemover/generatedImageOwner.ts',
    kind: 'proof',
    values: {
      'user-query': 1,
      'rich-textarea': 1,
    },
    reason:
      'Native generated-download control and source metadata independently prove a repaired generated-image owner; user uploads, editors/forms/dialogs and foreign source origins are rejected before remote data can select a download source.',
  },
];
