/** A download baseline is committed only after all caller-owned applies have completed. */
export async function completeCloudSyncDownload(
  send: (message: { type: string; payload: unknown }) => Promise<unknown>,
  operationId: string | undefined,
  success: boolean,
): Promise<void> {
  if (!operationId) return;
  const response = await send({
    type: 'gv.sync.completeDownload',
    payload: { operationId, success },
  }).catch((error: unknown) => {
    // Releasing a failed apply must not replace that owner's original error.
    if (success) throw error;
    return undefined;
  });
  if (
    success &&
    !(typeof response === 'object' && response !== null && 'ok' in response && response.ok === true)
  )
    throw new Error(
      typeof response === 'object' &&
        response !== null &&
        'error' in response &&
        typeof response.error === 'string'
        ? response.error
        : 'sync_bookkeeping_failed',
    );
}
