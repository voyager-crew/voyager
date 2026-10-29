import { expect } from 'vitest';

/** Return the opaque confirmation from the actual runtime refusal. */
export async function refusedGuardToken(result: Promise<unknown>): Promise<string> {
  const response = await result;
  expect(response).toMatchObject({
    ok: false,
    error: 'upload_guard_refused',
    guardToken: expect.any(String),
  });
  if (
    !response ||
    typeof response !== 'object' ||
    !('guardToken' in response) ||
    typeof response.guardToken !== 'string'
  )
    throw new Error('Missing guard token');
  return response.guardToken;
}
