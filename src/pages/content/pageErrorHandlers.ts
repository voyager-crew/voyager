import { CleanupPositions } from '@/core/types/cleanupPositions';
import type { CleanupManager } from '@/core/utils/cleanupManager';
import { isExtensionContextInvalidatedError } from '@/core/utils/extensionContext';

/** Keep extension-reload error listeners beside their cleanup, outside the startup entrypoint. */
export function registerPageErrorHandlers(cleanupManager: CleanupManager): void {
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    if (isExtensionContextInvalidatedError(event.reason)) event.preventDefault();
  };
  const onWindowError = (event: ErrorEvent) => {
    if (isExtensionContextInvalidatedError(event.error ?? event.message)) event.preventDefault();
  };
  window.addEventListener('unhandledrejection', onUnhandledRejection);
  cleanupManager.registerCleanupFunction(
    () => window.removeEventListener('unhandledrejection', onUnhandledRejection),
    CleanupPositions.RemoveUnhandledRejectionEventListener,
  );
  window.addEventListener('error', onWindowError);
  cleanupManager.registerCleanupFunction(
    () => window.removeEventListener('error', onWindowError),
    CleanupPositions.RemoveErrorEventListener,
  );
}
