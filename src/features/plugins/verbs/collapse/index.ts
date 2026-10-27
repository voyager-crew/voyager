/** Generic content-height policy over the same state/observer engine as code collapse. */
import { createCodeBlockToggleIcon } from '@/core/icons/codeCollapseIcons';
import { hasPageSemanticFixes } from '@/core/selectors/semanticSnapshot';
import { nativeDomDecorations } from '@/core/services/NativeDomDecorationService';
import { createCollapseEngine, type CollapseReadSession } from '@/core/ui/collapse/engine';
import { createCollapseToggle } from '@/core/ui/collapse/toggle';
import { getTranslationSync, onCachedLanguageChange } from '@/utils/i18n';

import type { ManifestIssue } from '../../manifest/validate';
import { getPrimitiveContract } from '../contracts';
import { iconButtonCss } from '../iconButton';
import type { Primitive } from '../types';
import type messages from './messages/en.json';

declare module '@/utils/translations' {
  interface PrimitiveMessages {
    collapse: typeof messages;
  }
}

export interface CollapseParams {
  readonly target?: 'userTurn' | 'assistantTurn' | 'thinkingBlock';
  readonly maxPx?: number;
  readonly startCollapsed?: boolean;
}

export const COLLAPSE_TOGGLE_CLASS = 'gv-collapse-toggle';
export const COLLAPSE_HEIGHT_SLACK_PX = 16;
const DEFAULT_MAX_PX = 320;
const MIN_MAX_PX = 80;
const MAX_MAX_PX = 2_000;
const TARGETS: readonly string[] = ['userTurn', 'assistantTurn', 'thinkingBlock'];

function collapseCss(instance: string, maxPx: number): string {
  const fadePx = Math.min(48, maxPx / 4);
  return `
.${instance}.${instance}-collapsed {
  max-height: ${maxPx}px !important;
  overflow: hidden !important;
  -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - ${fadePx}px), transparent);
  mask-image: linear-gradient(to bottom, #000 calc(100% - ${fadePx}px), transparent);
}
${iconButtonCss(`.${instance}-toggle`)}
.${instance}-toggle {
  display: flex;
  margin-block: 4px;
  margin-inline-start: auto;
  margin-inline-end: 0;
}
body.gv-rtl .${instance}-toggle { direction: rtl; }
`;
}

export const collapsePrimitive: Primitive<CollapseParams> = {
  contract: getPrimitiveContract('collapse')!,

  validateParams(raw: unknown) {
    if (raw !== undefined && (typeof raw !== 'object' || raw === null || Array.isArray(raw))) {
      return { success: false, error: [{ path: 'params', message: 'must be an object' }] };
    }
    const issues: ManifestIssue[] = [];
    const params: { target?: CollapseParams['target']; maxPx?: number; startCollapsed?: boolean } =
      {};
    for (const [key, value] of Object.entries(raw ?? {})) {
      if (key === 'target') {
        if (typeof value === 'string' && TARGETS.includes(value))
          params.target = value as CollapseParams['target'];
        else
          issues.push({
            path: 'params.target',
            message: 'must be userTurn, assistantTurn or thinkingBlock',
          });
      } else if (key === 'maxPx') {
        if (
          typeof value === 'number' &&
          Number.isFinite(value) &&
          value >= MIN_MAX_PX &&
          value <= MAX_MAX_PX
        )
          params.maxPx = value;
        else
          issues.push({ path: 'params.maxPx', message: 'must be a finite number from 80 to 2000' });
      } else if (key === 'startCollapsed') {
        if (typeof value === 'boolean') params.startCollapsed = value;
        else issues.push({ path: 'params.startCollapsed', message: 'must be a boolean' });
      } else {
        issues.push({ path: `params.${key}`, message: 'unknown parameter' });
      }
    }
    return issues.length > 0 ? { success: false, error: issues } : { success: true, data: params };
  },

  activate(scope, params, context) {
    const { doc, adapter } = context;
    const target = params.target ?? 'userTurn';
    const selector = adapter?.selectors[target];
    if (!adapter || !selector) return;
    const remote = hasPageSemanticFixes(adapter, [target], doc);
    const currentSelector = () => (remote ? (adapter.selectors[target] ?? selector) : selector);
    context.setTargetCounter(() => doc.querySelectorAll(currentSelector()).length);
    const maxPx = params.maxPx ?? DEFAULT_MAX_PX;
    // Instance-scoped rules keep different plugins' height caps from overriding each other.
    const instance = `gv-collapse-${crypto.randomUUID()}`;
    const collapsedClass = `${instance}-collapsed`;
    const decorationOwner = {};
    const accepts = (host: HTMLElement) => host instanceof HTMLElement && !host.isContentEditable;
    const content = (host: HTMLElement) => host;
    const actions = (host: HTMLElement) => host.parentElement;
    const running = createCollapseEngine(
      {
        root: () => doc.body,
        hostSelector: selector,
        ...(remote
          ? {
              resolveHosts(ownerRoot: ParentNode): CollapseReadSession {
                // A once-valid alias can move into a dialog; each pass re-proves before changing layout.
                const hosts = Array.from(
                  ownerRoot.querySelectorAll<HTMLElement>(currentSelector()),
                );
                return {
                  hosts,
                  closest: (element) =>
                    hosts.find((host) => host === element || host.contains(element)) ?? null,
                  matches: (element) => hosts.includes(element as HTMLElement),
                  accepts,
                  content,
                  actions,
                };
              },
              claim(host: HTMLElement) {
                // Only this instance's classes on an already accepted native target are decorations.
                nativeDomDecorations.acquire(host, instance, decorationOwner);
                nativeDomDecorations.acquire(host, collapsedClass, decorationOwner);
                return true;
              },
              release(host: HTMLElement) {
                nativeDomDecorations.release(host, instance, decorationOwner);
                nativeDomDecorations.release(host, collapsedClass, decorationOwner);
              },
            }
          : {}),
        accepts,
        content,
        isLong: (content) => content.scrollHeight > maxPx + COLLAPSE_HEIGHT_SLACK_PX,
        actions,
        collapseByDefault: params.startCollapsed ?? true,
      },
      {
        collapsibleClass: instance,
        collapsedClass,
        clipClass: `${instance}-clip`,
        createToggle(buttonDoc, onToggle) {
          return createCollapseToggle(
            buttonDoc,
            `${COLLAPSE_TOGGLE_CLASS} ${instance}-toggle`,
            onToggle,
          );
        },
        updateToggle(host, button) {
          const collapsed = host.classList.contains(collapsedClass);
          const state = collapsed ? 'collapsed' : 'expanded';
          const label = getTranslationSync(collapsed ? 'collapseExpand' : 'collapseCollapse');
          if (button.dataset.state !== state) {
            button.dataset.state = state;
            button.replaceChildren(createCodeBlockToggleIcon(collapsed));
          }
          button.title = label;
          button.setAttribute('aria-label', label);
          button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
          // A sibling toggle stays reachable when the whole target is clipped.
          if (host.nextSibling !== button) host.after(button);
        },
      },
    );
    scope.effect(() => {
      const style = doc.createElement('style');
      style.id = `${instance}-style`;
      style.textContent = collapseCss(instance, maxPx);
      doc.head.append(style);
      let stopFollowingLanguage = () => {};
      const stop = () => {
        stopFollowingLanguage();
        running.stop();
        style.remove();
      };
      try {
        running.start();
        stopFollowingLanguage = onCachedLanguageChange(() => running.relabel());
        return stop;
      } catch (error) {
        stop();
        throw error;
      }
    }, 'collapse');
    // Static params need no restart; P4 restarts templated params after disposal.
    return { updateSettings() {} };
  },
};
