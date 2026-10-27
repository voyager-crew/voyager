import sidebar from '@/features/plugins/catalog/sites/gemini/selector-data/sidebar-packaged.json';

/**
 * Original fallback values and independent native witnesses. Action aliases use the proofs in
 * actions.ts; fixed host, icon and state protocols remain here.
 */
export const GEMINI_PACKAGED_SIDEBAR_SELECTORS = Object.freeze({
  sidenav: sidebar.sidenav.join(', '),
  content: sidebar.content.join(', '),
  contentInner: sidebar.contentInner.join(', '),
  newChat: sidebar.newChat.join(', '),
  actionsContainer: sidebar.actionsContainer.join(', '),
  toggleButton: sidebar.toggleButton.join(', '),
  toggleHost: sidebar.toggleHost.join(', '),
  toggleLegacyHost: sidebar.toggleLegacyHost.join(', '),
  toggleIcon: sidebar.toggleIcon.join(', '),
});
