/**
 * `copyButton` primitive: a copy button above every element the site adapter
 * names by `params.target` (a thinking block, a message, a reply, a code
 * block), which copies that element's visible text.
 *
 * Host safety: the element is never moved or edited. Each button is one
 * shadow-root element right before its target; an element the host
 * re-renders or replaces gets a fresh button on the next scan. Unmount removes
 * every button, so the page is exactly as the host left it.
 *
 * `format` only accepts "text" for now; another format is added as a new
 * accepted value, so a manifest that names "text" keeps working.
 */
import { hasPageSemanticFixes } from '@/core/selectors/semanticSnapshot';
import { createToaster } from '@/core/ui/toast/toaster';
import { getTranslationSync, onCachedLanguageChange } from '@/utils/i18n';

import type { ManifestIssue } from '../../manifest/validate';
import { getPrimitiveContract } from '../contracts';
import type { Primitive } from '../types';
import { COPY_TARGET_LABELS, type CopyButton, type CopyTarget, createCopyButton } from './button';
import { copyableText } from './text';

export type CopyFormat = 'text';

export interface CopyButtonParams {
  readonly target: CopyTarget;
  readonly format: CopyFormat;
}

const FORMATS: readonly string[] = ['text'];
const TARGETS = Object.keys(COPY_TARGET_LABELS);
/** Targets that sit inside a reply and are absent from many conversations. */
const NESTED_TARGETS: readonly CopyTarget[] = ['thinkingBlock', 'codeBlock'];

/** Streaming replies rebuild their elements; buttons follow once the reply settles. */
const RESCAN_DELAY_MS = 300;
const TOAST_MS = 2_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCopyTarget(value: unknown): value is CopyTarget {
  return typeof value === 'string' && TARGETS.includes(value);
}

export const copyButtonPrimitive: Primitive<CopyButtonParams> = {
  contract: getPrimitiveContract('copyButton')!,

  validateParams(raw: unknown) {
    if (raw !== undefined && !isRecord(raw)) {
      return { success: false, error: [{ path: 'params', message: 'must be an object' }] };
    }
    const issues: ManifestIssue[] = [];
    const { target, format, ...unknown } = raw ?? {};
    for (const key of Object.keys(unknown)) {
      issues.push({ path: `params.${key}`, message: 'unknown parameter' });
    }
    if (!isCopyTarget(target)) {
      issues.push({ path: 'params.target', message: `must be one of ${TARGETS.join(', ')}` });
    }
    if (format !== undefined && !(typeof format === 'string' && FORMATS.includes(format))) {
      issues.push({ path: 'params.format', message: `must be one of ${FORMATS.join(', ')}` });
    }
    return issues.length > 0 || !isCopyTarget(target)
      ? { success: false, error: issues }
      : { success: true, data: { target, format: 'text' } };
  },

  activate(scope, params, context) {
    const { doc, adapter } = context;
    const selector = adapter?.selectors[params.target];
    if (!selector) return;
    const checked = hasPageSemanticFixes(adapter, [params.target, 'assistantTurn'], doc);
    const targets = () =>
      doc.querySelectorAll<HTMLElement>(checked ? adapter!.selectors[params.target] : selector);
    const turn = adapter?.selectors.assistantTurn;
    // Replies, not thinking or code blocks: a conversation without one is not a plugin with no effect.
    const counted = NESTED_TARGETS.includes(params.target) && turn ? turn : selector;
    context.setTargetCounter(
      () =>
        doc.querySelectorAll(
          checked
            ? (adapter!.selectors[
                NESTED_TARGETS.includes(params.target) && turn ? 'assistantTurn' : params.target
              ] ?? counted)
            : counted,
        ).length,
    );

    const buttons = new Map<HTMLElement, CopyButton>();
    const hosts = new WeakSet<Node>();
    const toaster = createToaster();

    const copy = async (element: HTMLElement): Promise<void> => {
      // A once-valid alias may now point at another message or a dialog preview.
      if (checked && !Array.from(targets()).includes(element)) return;
      let copied = false;
      try {
        // Read on click, with no await before writeText, so the click still allows the write.
        const text = copyableText(element);
        if (text) {
          await navigator.clipboard.writeText(text);
          copied = true;
        }
      } catch {
        // Clipboard permission denied or the API is missing: the toast says so.
      }
      toaster.show({
        message: getTranslationSync(copied ? 'copyButtonCopied' : 'copyButtonFailed'),
        tone: copied ? 'success' : 'error',
        channel: 'copy-button',
        durationMs: TOAST_MS,
      });
    };

    const remove = (element: HTMLElement): void => {
      buttons.get(element)?.host.remove();
      buttons.delete(element);
    };

    const scan = (): void => {
      if (scope.isDisposed) return;
      const current = targets();
      for (const [element, button] of Array.from(buttons)) {
        if (
          !element.isConnected ||
          button.host.nextElementSibling !== element ||
          (checked && !Array.from(current).includes(element))
        )
          remove(element);
      }
      for (const element of current) {
        if (buttons.has(element)) continue;
        const button = createCopyButton(doc, params.target, () => void copy(element));
        hosts.add(button.host);
        element.before(button.host);
        buttons.set(element, button);
      }
    };

    const ownNodes = (nodes: NodeList): boolean =>
      Array.from(nodes).every((node) => hosts.has(node));

    // One effect owns the whole lifetime: PluginScope awaits between ledger entries,
    // so a separate button entry would leave buttons on the page after unmount returns.
    scope.effect(() => {
      let rescan: ReturnType<typeof setTimeout> | undefined;
      const observer = new MutationObserver((records) => {
        if (scope.isDisposed) return;
        // Adding or removing a button is a mutation too; only the host's own changes need a scan.
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
        buttons.forEach((button) => button.relabel()),
      );
      scan();
      // Observer and timer go before the buttons, so no scan can bring one back.
      return () => {
        clearTimeout(rescan);
        observer.disconnect();
        stopFollowingLanguage();
        Array.from(buttons.keys()).forEach(remove);
        toaster.destroy();
      };
    }, 'copy-button');
    // No settings: a settings change must not restart it; a restart's deferred dispose would outlive unmount.
    return { updateSettings() {} };
  },
};
