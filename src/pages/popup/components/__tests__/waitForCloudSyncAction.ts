import { act } from 'react';

import { expect, vi } from 'vitest';

import { confirmDriver } from '@/tests/confirmDriver';

/** Hashing can finish outside React's queue; the enabled action signals the whole transfer settled. */
export async function waitForCloudSyncAction(button: HTMLButtonElement | undefined): Promise<void> {
  expect(button).toBeDefined();
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(button?.isConnected).toBe(true);
    expect(button?.disabled).toBe(false);
  });
}

/** Answers the confirm a click opened, and returns what it asked. */
export async function answerConfirm(label: string): Promise<string | null> {
  await vi.waitFor(() => expect(confirmDriver.isOpen()).toBe(true));
  const message = confirmDriver.message();
  await act(async () => confirmDriver.answer(label));
  return message;
}
