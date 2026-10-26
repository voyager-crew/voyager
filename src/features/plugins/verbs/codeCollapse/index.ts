/**
 * `codeCollapse` primitive: Gemini's long code block collapse
 * (`pages/content/codeBlockCollapse`) on another site's code blocks, through
 * the same engine, thresholds, toggle and labels. Blocks come from the
 * site adapter's `codeBlock`, inside its
 * `assistantTurn` and outside its `thinkingBlock`.
 *
 * Unlike Gemini, a long block starts collapsed: the plugin is opt-in to fold
 * them. The user's choice per block, and an expand-all / collapse-all, stand
 * while the reply streams. Collapsing only stamps classes, and this
 * primitive's stylesheet clips the code element with a fade, so the host's
 * code and copy controls stay as they were. Turning the plugin off removes the
 * toggles, the bar, the classes and the stylesheet.
 *
 * On Gemini (the packaged adapter, chosen by its id) the primitive is Gemini's
 * own collapse instead: every `codeBlock` on the page, thinking included,
 * long blocks expanded until the user folds them, no expand-all bar, the
 * toggle in the block's button row, diagram blocks skipped, and the clip and
 * fade left to Voyager's content stylesheet. Params do not apply there.
 *
 * A block is claimed before it is touched (`data-gv-code-collapse-owner`):
 * a second code collapse on the same page, another plugin or the native
 * module, leaves a block the first holds alone until it lets go.
 */
import { getPageSelectorSiteId, getSiteSelectorView } from '@/core/selectors';
import type { CollapseReadSession } from '@/core/ui/collapse/engine';
import {
  type CodeBlockCollapse,
  type CodeBlockCollapseSite,
  createCodeBlockCollapse,
} from '@/pages/content/codeBlockCollapse/engine';
import { createGeminiCodeBlockSite } from '@/pages/content/codeBlockCollapse/geminiSite';
import { onCachedLanguageChange } from '@/utils/i18n';

import type { ManifestIssue } from '../../manifest/validate';
import type { PluginScope } from '../../runtime/pluginScope';
import { getPrimitiveContract } from '../contracts';
import { iconButtonCss } from '../iconButton';
import type { Primitive } from '../types';
import { COLLAPSE_ALL_CLASS, createCollapseAllBar } from './codeCollapseAll';

export interface CodeCollapseParams {
  readonly code?: string;
  readonly action?: string;
}

const PARAM_NAMES: readonly string[] = ['code', 'action'];
const MAX_SELECTOR_LENGTH = 2_000;
const DEFAULT_CODE = 'pre';
const STYLE_ID = 'gv-code-collapse-style';

const PAGE_CSS = `
.gv-code-block-collapsed .gv-code-block-clip,
.gv-code-block-clip.gv-code-block-collapsed {
  max-height: clamp(240px, 38vh, 340px) !important;
  overflow-y: hidden !important;
  -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 72px), transparent);
  mask-image: linear-gradient(to bottom, #000 calc(100% - 72px), transparent);
}
${iconButtonCss('.gv-code-block-toggle', `.${COLLAPSE_ALL_CLASS} button`)}
.${COLLAPSE_ALL_CLASS} {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
  margin: 8px 0 4px;
}
`;

/** The packaged Gemini adapter, whose code blocks follow Gemini's own collapse. */
const GEMINI_SITE_ID = 'gemini';

/** Gemini's collapse: no default fold, no bar, no stylesheet of its own. */
function activateGemini(scope: PluginScope, site: CodeBlockCollapseSite): void {
  const running = createCodeBlockCollapse(site);
  scope.effect(() => {
    running.start();
    const stopFollowingLanguage = onCachedLanguageChange(() => running.relabel());
    return () => {
      stopFollowingLanguage();
      running.stop();
    };
  }, 'code-collapse');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function first(root: Element, selector: string): HTMLElement | null {
  try {
    return root.querySelector<HTMLElement>(selector);
  } catch {
    return null;
  }
}

function within(element: Element, selector: string): boolean {
  try {
    return element.closest(selector) !== null;
  } catch {
    return false;
  }
}

export const codeCollapsePrimitive: Primitive<CodeCollapseParams> = {
  contract: getPrimitiveContract('codeCollapse')!,

  validateParams(raw: unknown) {
    if (raw !== undefined && !isRecord(raw)) {
      return { success: false, error: [{ path: 'params', message: 'must be an object' }] };
    }
    const issues: ManifestIssue[] = [];
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw ?? {})) {
      if (!PARAM_NAMES.includes(key)) {
        issues.push({ path: `params.${key}`, message: 'unknown parameter' });
      } else if (typeof value !== 'string' || !value.trim() || value.length > MAX_SELECTOR_LENGTH) {
        issues.push({ path: `params.${key}`, message: 'must be a non-empty selector' });
      } else {
        params[key] = value;
      }
    }
    return issues.length > 0 ? { success: false, error: issues } : { success: true, data: params };
  },

  activate(scope, params, context) {
    const { doc, adapter } = context;
    const turn = adapter?.selectors.assistantTurn;
    const hostSelector = adapter?.selectors.codeBlock;
    if (!adapter || !turn || !hostSelector) return;
    const thinking = adapter?.selectors.thinkingBlock;
    context.setTargetCounter(() => doc.querySelectorAll(turn).length);

    if (adapter?.id === GEMINI_SITE_ID) {
      activateGemini(scope, createGeminiCodeBlockSite(doc, hostSelector));
      return { updateSettings() {} };
    }

    let engine: CodeBlockCollapse | null = null;
    const bar = createCollapseAllBar(doc, () => engine!);
    const code = (host: HTMLElement) => first(host, params.code ?? DEFAULT_CODE) ?? host;
    const actions = (host: HTMLElement) => {
      const action = params.action ? first(host, params.action) : null;
      if (action?.parentElement) return action.parentElement;
      // No button row: the toggle goes at the end of the block, never inside the code itself.
      return first(host, params.code ?? DEFAULT_CODE) ? host : null;
    };
    const accepts = (host: HTMLElement, assistant: string, excluded: string | undefined) =>
      within(host, assistant) && !(excluded && within(host, excluded)) && !host.isContentEditable;
    const remote =
      getPageSelectorSiteId(doc) === adapter.id &&
      ['codeBlock', 'assistantTurn'].some((key) =>
        getSiteSelectorView(adapter.id).remoteKeys.has(key),
      );
    if (remote)
      context.setTargetCounter(
        () => doc.querySelectorAll(adapter.selectors.assistantTurn ?? turn).length,
      );
    engine = createCodeBlockCollapse({
      root: () => doc.body,
      hostSelector,
      ...(remote
        ? {
            resolveHosts(ownerRoot: ParentNode): CollapseReadSession {
              // A valid alias can later match a foreign editor; re-prove it before each scan writes.
              const currentHost = adapter.selectors.codeBlock ?? hostSelector;
              const currentTurn = adapter.selectors.assistantTurn ?? turn;
              const currentThinking = adapter.selectors.thinkingBlock;
              const hosts = Array.from(ownerRoot.querySelectorAll<HTMLElement>(currentHost));
              return {
                hosts,
                closest: (element) =>
                  hosts.find((host) => host === element || host.contains(element)) ?? null,
                matches: (element) => hosts.includes(element as HTMLElement),
                accepts: (host) => accepts(host, currentTurn, currentThinking),
                content: code,
                actions,
                clip: (_host, content) => content,
              };
            },
          }
        : {}),
      accepts: (host) => accepts(host, turn, thinking),
      code,
      actions,
      clip: (_host, content) => content,
      collapseByDefault: true,
      onChange: () => bar.sync(),
    });
    const running = engine;

    // One effect owns the whole lifetime, so unmount restores the page in one synchronous step.
    scope.effect(() => {
      const style = doc.createElement('style');
      style.id = STYLE_ID;
      style.textContent = PAGE_CSS;
      doc.head.append(style);
      running.start();
      const stopFollowingLanguage = onCachedLanguageChange(() => {
        running.relabel();
        bar.relabel();
      });
      return () => {
        stopFollowingLanguage();
        running.stop();
        bar.remove();
        style.remove();
      };
    }, 'code-collapse');
    // No settings: a settings change must not restart it and drop the user's choices.
    return { updateSettings() {} };
  },
};
