import type { FolderData } from '../types';
import type { FolderWriteReceipt, IFolderStorageAdapter } from './FolderStorageAdapter';
import { createFolderWriter, type FolderWriter } from './folderWriter';

/**
 * AI Studio folder data lives only in `chrome.storage.local`, on every browser.
 * Never route AI Studio through `createFolderStorageAdapter()`: its default
 * adapter mirrors into page localStorage, and AI Studio has never written
 * folder data there.
 *
 * Writes reject instead of resolving `false`, as the direct
 * `chrome.storage.local.set` call they replace did.
 */
export class AIStudioFolderStorageAdapter implements IFolderStorageAdapter {
  private write = createFolderWriter();

  setWriteGate(writer: FolderWriter): void {
    this.write = writer;
  }
  async init(): Promise<void> {
    // Nothing to migrate per key; the sync → local copy runs in the manager's init.
  }

  async loadData(key: string): Promise<FolderData | null> {
    const result = await chrome.storage.local.get(key);
    return (result[key] as FolderData | undefined) ?? null;
  }

  /** Authorization is refreshed immediately before the physical folder write. */
  async saveData(
    key: string,
    data: FolderData,
    _companions?: Record<string, unknown>,
    beforeWrite?: FolderWriteReceipt,
  ): Promise<void> {
    const items = { [key]: data };
    if (beforeWrite) await beforeWrite(items);
    await this.write(key, () => chrome.storage.local.set(items));
  }

  async removeData(key: string): Promise<void> {
    await this.write(key, () => chrome.storage.local.remove(key));
  }

  getBackendName(): string {
    return 'chrome.storage.local (AI Studio)';
  }
}
