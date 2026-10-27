import type { LocatorLiteralException } from './types';

export const CONTENT_PROOFS_LITERAL_EXCEPTIONS: readonly LocatorLiteralException[] = [
  {
    file: 'src/pages/content/canvasExport/canvasTargets.ts',
    kind: 'proof',
    values: {
      'deep-research-immersive-panel': 1,
      'rich-textarea': 1,
      '[role="dialog"]': 1,
      button: 1,
      textarea: 1,
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
      form: 1,
      '[role="dialog"]': 1,
      button: 1,
      textarea: 1,
    },
    reason:
      'Canvas code/document/menu proofs reject transcript/research/editor/dialog/action owners; these literals only establish unsafe ownership, not exported content.',
  },
  {
    file: 'src/pages/content/canvasExport/menuInjection.ts',
    kind: 'protocol',
    values: {
      'gem-menu-item': 1,
      '[role="menuitem"]': 1,
      'gem-menu-item-content': 1,
    },
    reason:
      'gem-menu-item roles/content define the native menu keyboard-focus and clone-style protocol. Reads run inside an already accepted Canvas menu; they select enabled focus peers and restore active styling when Voyager adds/removes its sanitized clone, not an export data source.',
  },
  {
    file: 'src/pages/content/canvasExport/menuTargets.ts',
    kind: 'proof',
    values: {
      form: 1,
      'rich-textarea': 1,
      '[role="dialog"]': 1,
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
    file: 'src/pages/content/defaultModel/autoApply.ts',
    kind: 'protocol',
    values: {
      'a[href]': 1,
    },
    reason:
      'a[href] resolves a real clicked link for native model-switch navigation/account route handling. The subsequent URL parsing, current origin/route and modifier rules define event ownership, not page-locator discovery.',
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
      button: 4,
      '[value="thinking_level"]': 1,
      '[hidden]': 1,
      '[aria-hidden="true"]': 1,
      '[role="dialog"]': 1,
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
    file: 'src/pages/content/defaultModel/modelPickerSelectors.ts',
    kind: 'proof',
    values: {
      '[role="menuitem"]': 1,
    },
    reason:
      'isNativeComposer rejects alertdialog/menu/menuitem ownership and requires the one independently native main editable, so repaired model-focus locators cannot focus menu/dialog previews.',
  },
  {
    file: 'src/pages/content/nativeHealth/pageEvidence.ts',
    kind: 'proof',
    values: {
      button: 1,
      '[role="button"]': 1,
      textarea: 1,
      main: 1,
    },
    reason:
      'Native main landmarks and button/editor/content exclusions supply independent rendered-page health evidence. Health proof must remain separate from the repaired locators it diagnoses.',
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
    file: 'src/pages/content/researchPack/panel.ts',
    kind: 'protocol',
    values: {
      button: 6,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own panel controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/content/researchPack/templatesSection.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own templatesSection controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/content/researchPack/turnButtons.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own turnButtons controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/content/researchPack/turnCapture.ts',
    kind: 'protocol',
    values: {
      'a[href]': 1,
    },
    reason:
      'a[href] enumerates standard outbound links within the already accepted answer owner, excluding packaged thoughts/action bars; URL/source serialization is design §6 rather than a renamable answer locator.',
  },
  {
    file: 'src/pages/content/responseNotification/pageSnapshot.ts',
    kind: 'proof',
    values: {
      button: 6,
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
      '[role="dialog"]': 1,
    },
    reason:
      'Usage-root independent owner proof rejects transcript/sidebar/dialog/menu/editor/Voyager islands before accepting remote usage metrics.',
  },
  {
    file: 'src/pages/content/usageStatus/usagePill.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'Voyager constructs or assigns native button type/role to its own usagePill controls. document.createElement is the HTML-construction exception; helper/JSX/type/role uses define owned markup and never query host elements.',
  },
  {
    file: 'src/pages/content/watermarkRemover/downloadButton.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'closest(button) maps a packaged native generated-download icon to its real action control after original generated-image ownership is checked; this is native download interception/event ownership.',
  },
  {
    file: 'src/pages/content/watermarkRemover/generatedImageOwner.ts',
    kind: 'proof',
    values: {
      button: 1,
      'user-query': 1,
      'rich-textarea': 1,
      form: 1,
      '[role="dialog"]': 1,
    },
    reason:
      'Native generated-download control and source metadata independently prove a repaired generated-image owner; user uploads, editors/forms/dialogs and foreign source origins are rejected before remote data can select a download source.',
  },
  {
    file: 'src/pages/content/watermarkRemover/generatedImageTargets.ts',
    kind: 'proof',
    values: {
      button: 1,
    },
    reason:
      'The candidate must equal the packaged/native download icon witness, and its actionable native button must remain inside the proven image root. Catalog spelling alone cannot supply that action ownership.',
  },
  {
    file: 'src/pages/content/watermarkRemover/previewRuntime.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'The preview download path converts an independently native generated-download icon to its button before delegating the real native action. It preserves packaged click/download protocol instead of allowing remote locators to manufacture an action.',
  },
];
