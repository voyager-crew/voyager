/** Whole-file content protected against an accidental destructive upload. */
export type GuardedUploadKind = 'folders' | 'prompts' | 'timelineHierarchy' | 'forks' | 'plugins';

export type UploadGuardRefusedFile =
  | {
      kind: GuardedUploadKind;
      localCount: number;
      cloudCount: number;
      reason: 'empty_local' | 'large_drop';
    }
  | {
      kind: GuardedUploadKind;
      localCount: number;
      /** The existing file cannot be counted by this build. */
      cloudCount: null;
      reason: 'unrecognized';
    };

export interface UploadGuardRefusal {
  kind: 'refused';
  error: 'upload_guard_refused';
  refusedFiles: UploadGuardRefusedFile[];
}

export type UploadGuardDecision = { kind: 'allowed' } | UploadGuardRefusal;
export type UploadOutcome = { kind: 'uploaded' } | { kind: 'failed' } | UploadGuardRefusal;

/** Force applies only to guard refusals in this one retried operation. */
export interface UploadGuardOptions {
  force?: boolean;
}
