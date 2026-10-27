import type { LocatorLiteralException } from './types';

export const CONTENT_STYLES_LITERAL_EXCEPTIONS: readonly LocatorLiteralException[] = [
  {
    file: 'src/pages/content/chatWidth/chatWidthCss.ts',
    kind: 'protocol',
    values: {
      'chat-window-content': 1,
      '.chat-history-scroll-container': 1,
      '.chat-history': 1,
      'infinite-scroller.chat-history': 1,
      'infinite-scroller': 1,
      'user-query': 1,
      'model-response': 1,
      'message-actions': 1,
      main: 1,
      button: 1,
      '.response-container': 1,
      'response-container': 1,
      '.presented-response-container': 1,
      '[data-message-author-role]': 1,
      'input-container': 1,
      'input-area-v2': 1,
      '.user-query-bubble-with-background': 1,
    },
    reason:
      'Complete packaged CSS sink (chat/edit width, fork controls, dormant Gems hider, auto-hide, sidebar width). Remote locator data is not allowed to rewrite CSS.',
  },
  {
    file: 'src/pages/content/chatWidth/pluginHandler.ts',
    kind: 'protocol',
    values: {
      main: 1,
    },
    reason:
      'The native main landmark owns the CSS application observer/lifetime; chat-width styles are a design §6 packaged CSS sink, not a remote data read.',
  },
  {
    file: 'src/pages/content/echarts/view.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'Only packaged CSS for Voyager-owned ECharts diagram/toggle/modal controls remains. The retired wrapper locator methods were removed; current matched button text occurs solely in the CSS sink.',
  },
  {
    file: 'src/pages/content/editInputWidth/editInputWidthCss.ts',
    kind: 'protocol',
    values: {
      main: 1,
      '.edit-container': 1,
      textarea: 1,
      'input-container': 1,
      'input-area-v2': 1,
      '.input-area': 1,
    },
    reason:
      'Complete packaged CSS sink (chat/edit width, fork controls, dormant Gems hider, auto-hide, sidebar width). Remote locator data is not allowed to rewrite CSS.',
  },
  {
    file: 'src/pages/content/editInputWidth/pluginHandler.ts',
    kind: 'protocol',
    values: {
      main: 1,
    },
    reason:
      'The native main landmark scopes the edit-width CSS application observer/lifetime; this is the packaged CSS sink protocol, not an export/input locator winner.',
  },
  {
    file: 'src/pages/content/fork/forkComposer.ts',
    kind: 'proof',
    values: {
      '.edit-container': 1,
      '.user-query-container.edit-mode': 1,
      '.user-query-container': 1,
      '[role="dialog"]': 1,
      '.mat-mdc-dialog-container': 1,
    },
    reason:
      'Fork composer proof/receiver recheck rejects native edit/dialog owners before guarded input prefill; remote input cannot redirect the write into a dialog.',
  },
  {
    file: 'src/pages/content/fork/forkControls.ts',
    kind: 'protocol',
    values: {
      '.user-query-bubble-with-background': 1,
      '.user-query-container': 1,
      'user-query': 1,
      'user-query-content': 1,
      button: 1,
    },
    reason:
      'The template is packaged CSS for Voyager’s own fork control. The native copy-icon-to-button conversion is a fixed action/clone placement relationship under an already accepted user turn, not a new turn locator.',
  },
  {
    file: 'src/pages/content/fork/forkIndicators.ts',
    kind: 'protocol',
    values: {
      'a[href*="/app/"]': 1,
      'a[href*="/gem/"]': 1,
      button: 2,
    },
    reason:
      'Fixed native /app and /gem href routes enumerate links only to parse known conversation identities for fork indicators. Additional button types define Voyager’s own indicator/delete controls.',
  },
  {
    file: 'src/pages/content/fork/index.ts',
    kind: 'protocol',
    values: {
      '[data-test-id="conversation"]': 1,
      'a[href*="/app/"]': 1,
    },
    reason:
      'Conversation-ID-specific native title association for folder-project/fork data; dynamic escaped ID lookup remains packaged under design §6 identity-specific queries.',
  },
  {
    file: 'src/pages/content/fork/linkFinisher.ts',
    kind: 'proof',
    values: {
      button: 1,
      '[role="dialog"]': 1,
      '.mat-mdc-dialog-container': 1,
      'a[href]': 1,
    },
    reason:
      'Native dialog exclusion rechecks the guarded composer before prefill. Detached-clone button/gv-control stripping defines prompt serialization, while clicked anchor URL checks distinguish navigation from send completion; all remain fixed source/event protocols.',
  },
  {
    file: 'src/pages/content/gemsHider/index.ts',
    kind: 'protocol',
    values: {
      'expandable-section': 1,
      button: 3,
    },
    reason:
      'The dormant Gems hider keeps its packaged CSS sink. Conditional span/button construction and assigned role=button affect Voyager’s own toggle and bar controls; no newly active native locator path is introduced.',
  },
  {
    file: 'src/pages/content/sidebarAutoHide/controller.ts',
    kind: 'protocol',
    values: {
      'bard-sidenav': 1,
    },
    reason:
      'Complete packaged CSS sink (chat/edit width, fork controls, dormant Gems hider, auto-hide, sidebar width). Remote locator data is not allowed to rewrite CSS.',
  },
  {
    file: 'src/pages/content/sidebarAutoHide/fullHide.ts',
    kind: 'protocol',
    values: {
      'bard-sidenav': 1,
    },
    reason:
      'Complete packaged CSS sink (chat/edit width, fork controls, dormant Gems hider, auto-hide, sidebar width). Remote locator data is not allowed to rewrite CSS.',
  },
  {
    file: 'src/pages/content/sidebarAutoHide/hoverIntent.ts',
    kind: 'protocol',
    values: {
      textarea: 1,
    },
    reason:
      'Native input/textarea focus check prevents collapsing sidebar while editing, including shadow activeElement; editor focus safety stays packaged.',
  },
  {
    file: 'src/pages/content/sidebarAutoHide/popupTargets.ts',
    kind: 'proof',
    values: {
      '[role="dialog"]': 1,
    },
    reason:
      'Popup collections must equal independently native dialog/alertdialog/menu roles; remote hover exclusions cannot hide a native popup.',
  },
  {
    file: 'src/pages/content/sidebarAutoHide/sidebarDom.ts',
    kind: 'protocol',
    values: {
      button: 2,
    },
    reason:
      'Native toggle icon/legacy-host matches are obtained from packaged sidebar data after the guarded remote toggle is tried. closest/querySelector(button) converts those accepted wrappers/icons to the fixed actionable button; it does not replace online toggle discovery.',
  },
  {
    file: 'src/pages/content/sidebarWidth/buttonTargets.ts',
    kind: 'proof',
    values: {
      '.buttons': 5,
      '[role="dialog"]': 1,
    },
    reason:
      'sidebarWidth.buttons occurrences are profile keys/indexes, not CSS. The action-forwarding proof independently rejects dialogs/menus/Voyager layers and requires original enabled native button/icon ownership; catalog geometry alone cannot authorize a click.',
  },
  {
    file: 'src/pages/content/sidebarWidth/hitGuards.ts',
    kind: 'protocol',
    values: {
      '.buttons': 1,
    },
    reason:
      'sidebarWidth.buttons is only a profile key tested in remoteKeys to choose the guarded action reader; it is not a .buttons lookup.',
  },
  {
    file: 'src/pages/content/sidebarWidth/sidebarWidthCss.ts',
    kind: 'protocol',
    values: {
      '#app-root': 1,
      'bard-sidenav': 1,
      main: 1,
      button: 1,
      textarea: 1,
      '.top-bar-actions': 1,
      'top-bar-actions': 1,
      'side-nav-sparkle-button': 1,
      'side-nav-menu-button': 1,
    },
    reason:
      'Complete packaged CSS sink (chat/edit width, fork controls, dormant Gems hider, auto-hide, sidebar width). Remote locator data is not allowed to rewrite CSS.',
  },
  {
    file: 'src/pages/content/wavedrom/view.ts',
    kind: 'protocol',
    values: {
      button: 1,
    },
    reason:
      'Only packaged CSS for Voyager-owned WaveDrom diagram/toggle/modal controls remains. The retired wrapper locator methods were removed; the remaining matched button text is solely CSS sink content.',
  },
];
