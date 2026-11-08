import { logger } from '@/core/services/LoggerService';

import { DialogNode, SyncResponse } from '../types';

export class SyncService {
  private static instance: SyncService;
  private readonly DEFAULT_PORT = 3030;

  private constructor() {}

  static getInstance(): SyncService {
    if (!this.instance) {
      this.instance = new SyncService();
    }
    return this.instance;
  }

  private async getServerUrl(): Promise<string> {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['contextSyncPort'], (result) => {
        const port = result.contextSyncPort || this.DEFAULT_PORT;
        resolve(`http://127.0.0.1:${port}/sync`);
      });
    });
  }

  async checkServerStatus(): Promise<boolean> {
    try {
      const url = await this.getServerUrl();
      return new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { type: 'gv.checkSyncStatus', url, timeout: 500 },
          (response) => {
            resolve(!!response?.ok);
          },
        );
      });
    } catch {
      return false;
    }
  }

  async syncToIDE(data: DialogNode[]): Promise<SyncResponse> {
    logger.debug('Syncing to the code editor server', { nodes: data.length });
    try {
      const url = await this.getServerUrl();
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'gv.syncToIDE', url, data }, (response) => {
          if (response && response.ok) {
            resolve(response.data);
          } else {
            reject(new Error(response?.error || 'Code Editor Server not responding.'));
          }
        });
      });
    } catch (err) {
      throw new Error((err as Error).message);
    }
  }
}
