/**
 * `tableCopy` primitive: a copy toolbar above every table in a reply, which
 * copies the table as Markdown (the exporter's own table, formulas as LaTeX)
 * or as TSV for spreadsheets.
 *
 * Host safety: the table is never moved or edited. Each toolbar is one
 * shadow-root element right before its table; a table the host re-renders or
 * replaces gets a fresh toolbar on the next scan. Unmount removes every
 * toolbar, so the page is exactly as the host left it.
 */
import { hasPageSemanticFixes } from '@/core/selectors/semanticSnapshot';
import { createToaster } from '@/core/ui/toast/toaster';
import { onCachedLanguageChange } from '@/utils/i18n';

import type { ManifestIssue } from '../../manifest/validate';
import { getPrimitiveContract } from '../contracts';
import type { Primitive } from '../types';
import { type TableCopyFormat, serializeTable } from './serialize';
import { type TableCopyToolbar, createTableCopyToolbar, tableCopyText } from './toolbar';

export type TableCopyParams = Readonly<Record<string, never>>;

/** Streaming replies rebuild their tables; toolbars follow once the reply settles. */
const RESCAN_DELAY_MS = 300;
const TOAST_MS = 2_000;

export const tableCopyPrimitive: Primitive<TableCopyParams> = {
  contract: getPrimitiveContract('tableCopy')!,

  validateParams(raw: unknown) {
    const issues: ManifestIssue[] = [];
    if (raw !== undefined && (typeof raw !== 'object' || raw === null || Array.isArray(raw))) {
      issues.push({ path: 'params', message: 'must be an object' });
    } else if (raw) {
      for (const key of Object.keys(raw)) {
        issues.push({ path: `params.${key}`, message: 'unknown parameter' });
      }
    }
    return issues.length > 0 ? { success: false, error: issues } : { success: true, data: {} };
  },

  activate(scope, _params, context) {
    const { doc, adapter } = context;
    const turn = adapter?.selectors.assistantTurn;
    if (!turn) return;
    const checked = hasPageSemanticFixes(adapter, ['assistantTurn'], doc);
    const replies = () => doc.querySelectorAll(checked ? adapter!.selectors.assistantTurn : turn);
    const thinking = adapter?.selectors.thinkingBlock;
    // Replies, not tables: a conversation without a table is not a plugin with no effect.
    context.setTargetCounter(() => replies().length);

    const toolbars = new Map<HTMLTableElement, TableCopyToolbar>();
    const hosts = new WeakSet<Node>();
    const toaster = createToaster();

    const copy = async (table: HTMLTableElement, format: TableCopyFormat): Promise<void> => {
      // Re-prove the response before a stale toolbar copies content from its replacement.
      if (checked && !Array.from(replies()).some((reply) => reply.contains(table))) return;
      let copied = false;
      try {
        // Read on click, with no await before writeText, so the click still allows the write.
        const text = serializeTable(table, format);
        if (text) {
          await navigator.clipboard.writeText(text);
          copied = true;
        }
      } catch {
        // Clipboard permission denied or the API is missing: the toast says so.
      }
      toaster.show({
        message: tableCopyText(copied ? 'copied' : 'failed'),
        tone: copied ? 'success' : 'error',
        channel: 'table-copy',
        durationMs: TOAST_MS,
      });
    };

    const remove = (table: HTMLTableElement): void => {
      toolbars.get(table)?.host.remove();
      toolbars.delete(table);
    };

    const eligible = (table: HTMLTableElement): boolean =>
      !table.parentElement?.closest('table') && !(thinking && table.closest(thinking));

    const scan = (): void => {
      if (scope.isDisposed) return;
      const current = replies();
      for (const [table, toolbar] of Array.from(toolbars)) {
        if (
          !table.isConnected ||
          toolbar.host.nextElementSibling !== table ||
          (checked && !Array.from(current).some((reply) => reply.contains(table)))
        )
          remove(table);
      }
      for (const reply of current) {
        for (const table of reply.querySelectorAll<HTMLTableElement>('table')) {
          if (toolbars.has(table) || !eligible(table)) continue;
          const toolbar = createTableCopyToolbar(doc, (format) => void copy(table, format));
          hosts.add(toolbar.host);
          table.before(toolbar.host);
          toolbars.set(table, toolbar);
        }
      }
    };

    const ownNodes = (nodes: NodeList): boolean =>
      Array.from(nodes).every((node) => hosts.has(node));

    // One effect owns the whole lifetime: PluginScope awaits between ledger entries,
    // so a separate toolbar entry would leave toolbars on the page after unmount returns.
    scope.effect(() => {
      let rescan: ReturnType<typeof setTimeout> | undefined;
      const observer = new MutationObserver((records) => {
        if (scope.isDisposed) return;
        // Adding or removing a toolbar is a mutation too; only the host's own changes need a scan.
        if (
          records.every((record) => ownNodes(record.addedNodes) && ownNodes(record.removedNodes))
        ) {
          return;
        }
        clearTimeout(rescan);
        rescan = setTimeout(scan, RESCAN_DELAY_MS);
      });
      observer.observe(doc.body, { childList: true, subtree: true });
      const stopFollowingLanguage = onCachedLanguageChange(() =>
        toolbars.forEach((toolbar) => toolbar.relabel()),
      );
      scan();
      // Observer and timer go before the toolbars, so no scan can bring one back.
      return () => {
        clearTimeout(rescan);
        observer.disconnect();
        stopFollowingLanguage();
        Array.from(toolbars.keys()).forEach(remove);
        toaster.destroy();
      };
    }, 'table-copy');
    // No settings: a settings change must not restart it; a restart's deferred dispose would outlive unmount.
    return { updateSettings() {} };
  },
};
