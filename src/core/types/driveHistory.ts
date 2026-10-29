import type { SyncAccountScope } from './sync';

/** The account authority resolved for this target before a restore batch starts. */
export interface DriveHistoryRestoreTarget {
  name: string;
  accountScope: SyncAccountScope | null;
}

/** Metadata returned by the Drive history transport; content remains in its original format. */
export interface DriveHistoryFile {
  id: string;
  name: string;
  createdTime: string;
}

export type DriveHistoryRestoreFile =
  | { name: string; status: 'restored'; historyId: string }
  | { name: string; status: 'removed' | 'kept' }
  | {
      name: string;
      status:
        | 'no_history'
        | 'unrecognized_history'
        | 'read_failed'
        | 'write_failed'
        | 'unsupported_provider';
    };
