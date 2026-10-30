import { startChatGptExportOpenListener } from '@/features/plugins/builtin/chatgptExport/openListener';
import { openPersistentExportToolbar } from '@/pages/content/export/persistentExportToolbar';
import { exportEntrypointFor } from '@/pages/content/export/sites/resolveExportEntrypoint';
import { exportSiteFor } from '@/pages/content/export/sites/resolveExportSite';

import { getPrimitiveContract } from '../contracts';
import type { Primitive } from '../types';

export const conversationExportPrimitive: Primitive = {
  contract: getPrimitiveContract('conversationExport')!,
  validateParams(raw) {
    if (
      raw !== undefined &&
      (raw === null || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length)
    ) {
      return { success: false, error: [{ path: 'params', message: 'must be an empty object' }] };
    }
    return { success: true, data: {} };
  },
  activate(scope, _params, context) {
    context.setTargetCounter(
      () => context.doc.querySelectorAll('[data-gv-component="persistent-export-toolbar"]').length,
    );
    const exportSite = context.adapter ? exportSiteFor(context.adapter) : null;
    if (!exportSite) return;
    const { entryPoints } = exportSite;
    // Installed before the async mount: until the toolbar exists the popup hears "no conversation".
    const stopOpenListener =
      entryPoints.kind === 'toolbar' && entryPoints.opensFromPopup
        ? scope.effect(() => {
            const stop = startChatGptExportOpenListener(openPersistentExportToolbar);
            // dispose() aborts first but awaits the mount before this effect: go silent at the abort.
            scope.signal.addEventListener('abort', stop, { once: true });
            return () => {
              scope.signal.removeEventListener('abort', stop);
              stop();
            };
          }, 'conversation-export-popup-open')
        : null;
    const start = exportEntrypointFor(exportSite, context.doc);
    scope.effect(
      () =>
        start({ signal: scope.signal }).catch((error: unknown) => {
          // Nothing mounted, so the popup reports the exporter unreachable, not an empty page.
          void stopOpenListener?.();
          throw error;
        }),
      'conversation-export',
    );
  },
};
