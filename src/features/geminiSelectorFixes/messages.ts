export const GEMINI_SELECTOR_STATUS_MESSAGE = 'gv.geminiSelectors.status';
export const GEMINI_SELECTOR_SET_ENABLED_MESSAGE = 'gv.geminiSelectors.setEnabled';
export const GEMINI_SELECTOR_REFRESH_MESSAGE = 'gv.geminiSelectors.refresh';

export type GeminiSelectorRefreshResult = 'updated' | 'upToDate' | 'notDue' | 'disabled' | 'failed';

export interface GeminiSelectorStatus {
  readonly ok: true;
  readonly enabled: boolean;
  readonly buildEnabled: boolean;
  readonly cachedRevision: number | null;
  readonly lastAttemptAt: number | null;
  readonly result?: GeminiSelectorRefreshResult;
}

export type GeminiSelectorResponse =
  | GeminiSelectorStatus
  | { readonly ok: false; readonly error: 'forbidden' | 'invalid-request' | 'storage' };

export function isGeminiSelectorMessage(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const type = (value as { type?: unknown }).type;
  return (
    type === GEMINI_SELECTOR_STATUS_MESSAGE ||
    type === GEMINI_SELECTOR_SET_ENABLED_MESSAGE ||
    type === GEMINI_SELECTOR_REFRESH_MESSAGE
  );
}

export function readGeminiSelectorResponse(value: unknown): GeminiSelectorResponse | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const response = value as Record<string, unknown>;
  if (response.ok === false) {
    if (
      response.error === 'forbidden' ||
      response.error === 'invalid-request' ||
      response.error === 'storage'
    ) {
      return { ok: false, error: response.error };
    }
    return null;
  }
  if (
    response.ok !== true ||
    typeof response.enabled !== 'boolean' ||
    typeof response.buildEnabled !== 'boolean' ||
    !isNullableNumber(response.cachedRevision) ||
    !isNullableNumber(response.lastAttemptAt)
  ) {
    return null;
  }
  const result = response.result;
  if (
    result !== undefined &&
    result !== 'updated' &&
    result !== 'upToDate' &&
    result !== 'notDue' &&
    result !== 'disabled' &&
    result !== 'failed'
  ) {
    return null;
  }
  return {
    ok: true,
    enabled: response.enabled,
    buildEnabled: response.buildEnabled,
    cachedRevision: response.cachedRevision,
    lastAttemptAt: response.lastAttemptAt,
    ...(result === undefined ? {} : { result }),
  };
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
}
