import { act } from 'react';

import { expect, vi } from 'vitest';

/** Hashing can finish outside React's queue; the enabled action signals the whole transfer settled. */
export async function waitForCloudSyncAction(button: HTMLButtonElement | undefined): Promise<void> {
  expect(button).toBeDefined();
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(button?.isConnected).toBe(true);
    expect(button?.disabled).toBe(false);
  });
}
