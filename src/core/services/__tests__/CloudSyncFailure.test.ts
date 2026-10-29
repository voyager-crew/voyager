import { describe, expect, it } from 'vitest';

import {
  CloudSyncFailure,
  DRIVE_NOT_AUTHENTICATED,
  cloudSyncFailureCode,
} from '../CloudSyncFailure';

describe('cloud sync failure identity', () => {
  it('keeps diagnostics while a restore wrapper exposes the stable reason', () => {
    const cause = new Error('storage quota exceeded');
    const failure = new CloudSyncFailure('snapshot_failed', cause.message, { cause });
    expect(failure.message).toBe('storage quota exceeded');
    expect(failure.cause).toBe(cause);
    expect(cloudSyncFailureCode(new Error('partial restore', { cause: failure }))).toBe(
      'snapshot_failed',
    );
  });

  it('recognizes transport and account codes without treating arbitrary diagnostics as codes', () => {
    expect(
      cloudSyncFailureCode({ code: 'account_unconfirmed', message: 'account not known' }),
    ).toBe('account_unconfirmed');
    expect(cloudSyncFailureCode('cloud_read_failed')).toBe('cloud_read_failed');
    expect(cloudSyncFailureCode(DRIVE_NOT_AUTHENTICATED)).toBe('not_authenticated');
    expect(cloudSyncFailureCode(new Error(DRIVE_NOT_AUTHENTICATED))).toBe('not_authenticated');
    expect(cloudSyncFailureCode({ code: '503', cause: new Error('local_read_failed') })).toBe(
      'local_read_failed',
    );
    expect(cloudSyncFailureCode('Download failed: 503')).toBeUndefined();
    const cycle: { cause?: unknown } = {};
    cycle.cause = cycle;
    expect(cloudSyncFailureCode(cycle)).toBeUndefined();
  });
});
