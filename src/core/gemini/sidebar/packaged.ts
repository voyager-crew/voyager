import sidebar from '@/features/plugins/catalog/sites/gemini/selector-data/sidebar-packaged.json';

/** Top-menu metadata can enter a stored record or deletion context; it stays packaged. */
export const GEMINI_PACKAGED_PAGE_TITLE_SELECTORS: readonly string[] = Object.freeze(
  sidebar.pageTitle,
);

/**
 * Native controls and hosts whose online match would have to equal the packaged one before a
 * click, a state read or an animation could use it, so an online fix could never change them.
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
