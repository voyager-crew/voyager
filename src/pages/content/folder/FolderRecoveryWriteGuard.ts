import type { FolderWriter } from './storage/folderWriter';

/** A newer canonical value superseded recovery before the adapter could write. */
export class FolderRecoverySupersededError extends Error {
  constructor() {
    super('Folder recovery was superseded');
    this.name = 'FolderRecoverySupersededError';
  }
}

/** Rechecks one recovery save after each physical write's asynchronous authorization. */
export class FolderRecoveryWriteGuard {
  private readonly checks = new Map<string, () => boolean>();

  constructor(private readonly authorize: FolderWriter) {}

  readonly write: FolderWriter = (key, operation) => {
    const canRecover = this.checks.get(key);
    return this.authorize(key, () => {
      this.requireCurrent(canRecover);
      return operation();
    });
  };

  async save(
    key: string,
    canRecover: (() => boolean) | undefined,
    operation: () => Promise<boolean | void>,
  ): Promise<boolean | void> {
    if (!canRecover) return operation();
    this.requireCurrent(canRecover);
    this.checks.set(key, canRecover);
    try {
      const saved = await operation();
      // Boolean adapters catch gate refusals; distinguish supersession from a failed save.
      if (saved === false) this.requireCurrent(canRecover);
      return saved;
    } finally {
      this.checks.delete(key);
    }
  }

  private requireCurrent(canRecover: (() => boolean) | undefined): void {
    if (canRecover && !canRecover()) throw new FolderRecoverySupersededError();
  }
}
