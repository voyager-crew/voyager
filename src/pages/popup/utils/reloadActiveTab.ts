import browser from 'webextension-polyfill';

/** "Reload this page" in the popup: only ever from the user's click. */
export async function reloadActiveTab(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (typeof tab?.id === 'number') await browser.tabs.reload(tab.id);
}
