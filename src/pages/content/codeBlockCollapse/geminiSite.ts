/**
 * Gemini's code blocks as the long code block collapse sees them, one source
 * for the native module and for the `codeCollapse` primitive's Gemini policy:
 * every `code-block` on the page (thinking included), the toggle in the
 * block's own button row, never a diagram block.
 */
import {
  GEMINI_PACKAGED_CODE,
  hasGeminiCodeFixes,
  resolveGeminiCodeHosts,
} from '@/core/gemini/code/hosts';
import { getGeminiSelectorView } from '@/core/gemini/selectors';
import { resolvePlacementOperation } from '@/core/selectors/placement';
import type { CollapseReadSession } from '@/core/ui/collapse/engine';
import { DIAGRAM_OWNER_ATTR } from '@/features/plugins/verbs/diagramExportRegistry';

import type { CodeBlockCollapseSite } from './engine';

const CODE_SELECTOR = GEMINI_PACKAGED_CODE['code.content'].join(', ');
const LANGUAGE_SELECTOR = GEMINI_PACKAGED_CODE['code.language'].join(', ');
const DECORATION_SELECTOR = GEMINI_PACKAGED_CODE['code.decoration'].join(', ');

/** Stamped by a diagram primitive (`verbs/codeBlockDiagram.ts`) on a block it draws. */
const DIAGRAM_OWNER_SELECTOR = `[${DIAGRAM_OWNER_ATTR}]`;

/**
 * A Mermaid or plugin-drawn diagram block. The language label also catches a
 * Mermaid block that is not drawn (renderer off, or still streaming).
 */
export function isGeminiDiagramBlock(host: HTMLElement): boolean {
  if (host.closest('.gv-mermaid-wrapper')) return true;
  if (host.closest(DIAGRAM_OWNER_SELECTOR) || host.querySelector(DIAGRAM_OWNER_SELECTOR)) {
    return true;
  }

  const language = host.querySelector(LANGUAGE_SELECTOR)?.textContent?.trim().toLowerCase();
  return language === 'mermaid';
}

/** The toggle joins Gemini's copy buttons, or the header when the row is missing. */
export function geminiCodeBlockActions(host: HTMLElement): HTMLElement | null {
  const decoration = host.querySelector<HTMLElement>(DECORATION_SELECTOR);
  const view = getGeminiSelectorView();
  const bundled = GEMINI_PACKAGED_CODE['code.buttons'].join(',');
  return resolvePlacementOperation(view, 'code.buttons', (selector) =>
    selector === bundled
      ? (decoration?.querySelector<HTMLElement>(selector) ?? decoration)
      : host.querySelector<HTMLElement>(selector),
  );
}

/**
 * Long blocks stay expanded until the user collapses them; clipping and fade
 * come from `contentStyle.css`, keyed on the block's collapsed class.
 */
export function createGeminiCodeBlockSite(
  doc: Document,
  hostSelector: string,
): CodeBlockCollapseSite {
  return {
    root: () => doc.body,
    hostSelector,
    ...(hasGeminiCodeFixes(doc) && hostSelector === 'code-block'
      ? {
          resolveHosts: (ownerRoot: ParentNode): CollapseReadSession => {
            const { value: hosts } = resolveGeminiCodeHosts(ownerRoot);
            return {
              hosts,
              closest: (element) =>
                hosts.find((host) => host === element || host.contains(element)) ?? null,
              matches: (element) => hosts.includes(element as HTMLElement),
              accepts: (host) => !isGeminiDiagramBlock(host),
              content: (host) => host.querySelector<HTMLElement>(CODE_SELECTOR),
              actions: geminiCodeBlockActions,
            };
          },
        }
      : {}),
    accepts: (host) => !isGeminiDiagramBlock(host),
    // A diagram plugin claims a block in place, often after this took it as long
    // code: only the attribute tells, so its toggle would otherwise stay.
    acceptsAttributes: [DIAGRAM_OWNER_ATTR],
    code: (host) => host.querySelector<HTMLElement>(CODE_SELECTOR),
    actions: geminiCodeBlockActions,
  };
}
