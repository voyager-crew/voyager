/**
 * Shared engine of the code-block diagram primitives: finds a site's code
 * blocks inside replies and shows a diagram before each one that a
 * {@link CodeBlockDiagram} claims, with a Diagram / Code toggle.
 *
 * PATTERN for another diagram primitive (`mermaid/` is the reference):
 *   1. Keep Gemini's renderer in `pages/content/<kind>/` and give it a site-neutral
 *      entry point: the theme comes from the caller, the library stays a lazy import.
 *   2. `verbs/<kind>/index.ts` defines a `CodeBlockDiagram` (matches / prepare / render)
 *      and a primitive whose `activate` calls `activateCodeBlockDiagram`.
 *   3. `verbs/<kind>/contract.ts` uses `params: CODE_BLOCK_DIAGRAM_PARAMS`, next to its
 *      `paramsBaseline.json`; the folder is discovered, so nothing else is registered.
 *   4. Each site's `diagram-rendering` manifest gets one more `native` op and handler.
 *
 * Host safety: the host's code block is never moved or edited. The panel goes
 * right before it with its UI in a shadow root, so reply text, timeline
 * summaries and export never read it; the block is hidden only through
 * `data-gv-diagram-hidden`. One activation owns a block (`data-gv-diagram-owner`),
 * so two diagram plugins never stack panels on it. Unmount removes every panel
 * and both attributes.
 *
 * Two opt-in params serve a host whose own controls the diagram view hides:
 * `copyButton` adds a toolbar button that copies the block's source, and
 * `exportImage` lets export read the drawn diagram (`diagramExportRegistry.ts`)
 * instead of the block's source in PNG and PDF.
 */
import {
  type DiagramKind,
  type DiagramToolbarIcon,
  setDiagramToolbarButton,
} from '@/core/ui/diagramToolbar';
import { SCHEME_ATTR, type Scheme, getScheme } from '@/pages/content/platformTheme/scheme';

import type { Dispose, PluginScope } from '../runtime/pluginScope';
import { startDiagramDraw } from './codeBlockDiagramDraw';
import { querySafe, readCodeBlock } from './codeBlockDiagramRead';
import { HIDDEN_ATTR, PAGE_CSS, PANEL_CLASS, SHADOW_CSS } from './codeBlockDiagramStyles';
import {
  createDiagramRead,
  usesGeminiCodeFixes,
  usesCatalogCodeFixes,
} from './codeBlockDiagramTargets';
import {
  DIAGRAM_OWNER_ATTR,
  type DiagramExport,
  provideDiagramExport,
  ownDiagramSource,
} from './diagramExportRegistry';
import type { PrimitiveContext } from './types';
export { readCodeBlock, validateCodeBlockDiagramParams } from './codeBlockDiagramRead';

export interface CodeBlockDiagramParams {
  readonly turn?: string;
  readonly codeBlock?: string;
  readonly code?: string;
  readonly codeLine?: string;
  readonly language?: string;
  /** Adds a toolbar button that copies the block's source. */
  readonly copyButton?: boolean;
  /** Lets PNG and PDF export read the drawn diagram instead of the block's source. */
  readonly exportImage?: boolean;
}

export interface CodeBlockDiagram {
  /** The primitive's name, stamped on each panel as `data-gv-diagram`. */
  readonly name: string;
  /** Icon of the toggle button that shows the diagram. */
  readonly kind: DiagramKind;
  /** Extra CSS inside the panel's shadow root; the drawn diagram sits in `.diagram`. */
  readonly css?: string;
  /** Whether a block with this language id (lowercase; null when untagged or plain text) and source is this diagram. */
  matches(language: string | null, source: string): boolean;
  /** Load the library for `scheme`; false leaves every block as code. Runs again after a scheme change. */
  prepare(scheme: Scheme): Promise<boolean>;
  /** Draw `source` into `target` (attached and visible); a returned cleanup runs before the next draw and on removal. */
  render(target: HTMLElement, source: string): Promise<void | (() => void)>;
  /** The drawn diagram was clicked, or the fullscreen button pressed when `fullscreenButton` is set. */
  openFullscreen?(target: HTMLElement): void;
  /**
   * Adds a toolbar fullscreen button. Set it for an interactive diagram (a
   * chart's legend and tooltips), whose clicks must not open fullscreen.
   */
  readonly fullscreenButton?: boolean;
  /** Page-level setup, such as fullscreen styles, for the activation's lifetime. */
  install?(doc: Document): () => void;
  /**
   * Export markup of what `target` shows, read synchronously; null leaves the
   * block's source. Asked only when the plugin sets `exportImage`.
   */
  exportHtml?(target: HTMLElement): string | null;
}

/** Gemini's pacing: streaming replies settle before a diagram is drawn. */
const RESCAN_DELAY_MS = 1_000;
const DEFAULT_CODE_BLOCK = 'pre';
/** The activation that draws a block, `<kind>:<id>`; any other activation leaves it alone. */
const OWNER_ATTR = DIAGRAM_OWNER_ATTR;
/** How long the copy button shows that it copied. */
const COPIED_MS = 1_500;
interface CodeOrigin {
  readonly reply: Element | null;
  readonly source: Element;
}

interface Panel {
  readonly host: HTMLElement;
  readonly target: HTMLElement;
  readonly releaseSource: () => void;
  origin: CodeOrigin | null;
  /** Source of the last draw; null asks the next scan to draw again. */
  source: string | null;
  cleanup: void | (() => void);
  /** Withdraws the export of the current drawing; null while there is none. */
  withdraw: (() => void) | null;
}

export function activateCodeBlockDiagram(
  scope: PluginScope,
  params: CodeBlockDiagramParams,
  context: PrimitiveContext,
  diagram: CodeBlockDiagram,
): void {
  const { doc, adapter } = context;
  const turn = params.turn ?? adapter?.selectors.assistantTurn;
  if (!turn) return;
  const blockSelector = params.codeBlock ?? adapter?.selectors.codeBlock ?? DEFAULT_CODE_BLOCK;
  context.setTargetCounter(
    () => querySafe(doc, params.turn ?? adapter?.selectors.assistantTurn ?? turn).length,
  );
  const readOperation = () => createDiagramRead(context, params, turn, blockSelector);
  const online = () =>
    usesGeminiCodeFixes(context, blockSelector) || usesCatalogCodeFixes(context, params);

  const panels = new Map<HTMLElement, Panel>();
  const owner = `${diagram.name}:${Math.random().toString(36).slice(2, 10)}`;
  const ownedByOther = (block: HTMLElement): boolean => {
    const current = block.getAttribute(OWNER_ATTR);
    return current !== null && current !== owner;
  };
  const release = (block: HTMLElement): void => {
    if (block.getAttribute(OWNER_ATTR) === owner) block.removeAttribute(OWNER_ATTR);
  };
  const drawing = new Map<HTMLElement, ReturnType<typeof startDiagramDraw>>();
  // A source that failed unexpectedly is not retried, or every rescan would redraw it.
  const failed = new WeakMap<HTMLElement, string>();
  let ready: Promise<boolean> | null = null;
  const prepare = (): Promise<boolean> =>
    (ready ??= diagram.prepare(getScheme(doc)).catch(() => false));

  const remove = (block: HTMLElement): void => {
    const panel = panels.get(block);
    if (!panel) return;
    panels.delete(block);
    panel.withdraw?.();
    panel.releaseSource();
    panel.cleanup?.();
    panel.host.remove();
    block.removeAttribute(HIDDEN_ATTR);
    release(block);
  };

  // Page styles arrive with the first panel, so a page without diagrams is never touched.
  let installed = false;
  const install = (): void => {
    if (installed) return;
    installed = true;
    scope.style(PAGE_CSS, doc);
    if (diagram.install) {
      const setup = diagram.install;
      scope.effect(() => setup(doc), `${diagram.name}:install`);
    }
  };

  const currentTargetSource = (
    block: HTMLElement,
    origin = panels.get(block)?.origin,
  ): string | null => {
    const read = online() ? readOperation() : null;
    if (
      scope.isDisposed ||
      !block.isConnected ||
      ownedByOther(block) ||
      !(read
        ? read.blocks.includes(block)
        : querySafe(doc, turn).some((reply) => querySafe(reply, blockSelector).includes(block)))
    )
      return null;
    // A moved block or replaced source ends this operation instead of borrowing a new reply's identity.
    if (
      origin &&
      read &&
      (read.owner(block) !== origin.reply || read.sourceElement(block) !== origin.source)
    )
      return null;
    const current = read ? read.read(block) : readCodeBlock(block, params);
    return diagram.matches(current.language, current.source) ? current.source : null;
  };

  /** The drawn diagram while it still shows `block`'s current source; null exports the source. */
  const exportOf = (block: HTMLElement, panel: Panel): DiagramExport | null => {
    if (panels.get(block) !== panel || panel.host.dataset.view === 'code') return null;
    const source = currentTargetSource(block);
    // A changed source, language or reply membership no longer exports the previous drawing.
    if (source === null || source !== panel.source) return null;
    const html = diagram.exportHtml?.(panel.target) ?? null;
    return html ? { html, text: `\`\`\`${diagram.name}\n${source}\n\`\`\`` } : null;
  };

  const copySource = (block: HTMLElement, button: HTMLButtonElement): void => {
    let revert: Dispose | null = null;
    button.addEventListener('click', () => {
      // Read on click, with no await before writeText, so the click still allows the write.
      const read = online() ? readOperation() : null;
      // A stale toolbar must not copy a different or no-longer-owned remote block.
      const panel = panels.get(block);
      const origin = panel?.origin;
      if (
        read &&
        (!panel ||
          panel.host.shadowRoot !== button.getRootNode() ||
          !read.blocks.includes(block) ||
          (origin &&
            (read.owner(block) !== origin.reply || read.sourceElement(block) !== origin.source)))
      )
        return;
      const { source } = read ? read.read(block) : readCodeBlock(block, params);
      void navigator.clipboard
        ?.writeText(source)
        .then(() => {
          if (scope.isDisposed) return;
          setDiagramToolbarButton(button, 'copied');
          void revert?.();
          revert = scope.timer(() => setDiagramToolbarButton(button, 'copy'), COPIED_MS);
        })
        // Clipboard permission denied: the button stays as it was.
        .catch(() => {});
    });
  };

  const createPanel = (block: HTMLElement, origin: CodeOrigin | null): Panel => {
    install();
    const host = doc.createElement('div');
    host.className = PANEL_CLASS;
    host.dataset.gvDiagram = diagram.name;
    const root = host.attachShadow({ mode: 'open' });
    const style = doc.createElement('style');
    style.textContent = SHADOW_CSS + (diagram.css ?? '');
    const toolbar = doc.createElement('div');
    toolbar.className = 'toolbar';
    toolbar.setAttribute('role', 'group');
    const button = (icon: DiagramToolbarIcon, parent: HTMLElement = toolbar) => {
      const element = doc.createElement('button');
      element.type = 'button';
      setDiagramToolbarButton(element, icon);
      parent.append(element);
      return element;
    };
    // First, where Gemini's diagram views put the block's own copy button.
    if (params.copyButton === true) copySource(block, button('copy'));
    // Diagram and Code are one choice, drawn as a segmented control.
    const segments = doc.createElement('div');
    segments.className = 'segments';
    toolbar.append(segments);
    const diagramButton = button(diagram.kind, segments);
    const codeButton = button('code', segments);
    const fullscreenButton = diagram.fullscreenButton ? button('fullscreen') : null;
    const target = doc.createElement('div');
    target.className = 'diagram';
    root.append(style, toolbar, target);

    const show = (view: 'diagram' | 'code'): void => {
      host.dataset.view = view;
      diagramButton.setAttribute('aria-pressed', String(view === 'diagram'));
      codeButton.setAttribute('aria-pressed', String(view === 'code'));
      block.toggleAttribute(HIDDEN_ATTR, view === 'diagram');
      if (fullscreenButton) fullscreenButton.disabled = view === 'code';
    };
    diagramButton.addEventListener('click', () => show('diagram'));
    codeButton.addEventListener('click', () => show('code'));
    (fullscreenButton ?? target).addEventListener('click', () => diagram.openFullscreen?.(target));

    block.before(host);
    const releaseSource = ownDiagramSource(block);
    show('diagram');
    const panel: Panel = {
      host,
      target,
      releaseSource,
      origin,
      source: null,
      cleanup: undefined,
      withdraw: null,
    };
    panels.set(block, panel);
    return panel;
  };

  const retryReplacedSource = (block: HTMLElement, origin: CodeOrigin | null): boolean => {
    const panel = panels.get(block);
    if (!origin || !panel || panel.host.nextElementSibling !== block || !online()) return false;
    const source = readOperation().sourceElement(block);
    if (
      source === origin.source ||
      currentTargetSource(block, { reply: origin.reply, source }) === null
    )
      return false;
    // Keep the view while a new scan validates the replacement; the stale draw cannot publish export.
    scheduleScan();
    return true;
  };

  const draw = (block: HTMLElement, source: string, origin: CodeOrigin | null): void => {
    block.setAttribute(OWNER_ATTR, owner);
    const prepared = prepare();
    const machine = startDiagramDraw(
      () => prepared,
      async (signal) => {
        if (signal.aborted || scope.isDisposed || !block.isConnected) return;
        try {
          // Gemini can finalize a language or replace the source while the library loads.
          const current = currentTargetSource(block, origin);
          if (current === null) {
            if (retryReplacedSource(block, origin)) return;
            remove(block);
            release(block);
            scheduleScan();
            return;
          }
          source = current;
          const panel = panels.get(block) ?? createPanel(block, origin);
          panel.withdraw?.();
          panel.withdraw = null;
          panel.cleanup?.();
          panel.cleanup = undefined;
          panel.source = source;
          const cleanup = await diagram.render(panel.target, source);
          if (signal.aborted) {
            cleanup?.();
            return;
          }
          if (panels.get(block) === panel) {
            panel.cleanup = cleanup;
            if (currentTargetSource(block, origin) === null) {
              if (retryReplacedSource(block, origin)) return;
              remove(block);
              return;
            }
            // The scheme changed while this loaded or drew, and that scan skipped the
            // block: draw it again in the new scheme, and export none of this one.
            if (ready !== prepared) {
              panel.source = null;
              scheduleScan();
            } else {
              if (params.exportImage === true) {
                panel.withdraw = provideDiagramExport(block, () => exportOf(block, panel));
              }
              // The reply streamed on while this drew, and the scans its edits asked for
              // skipped the block mid-draw: one more scan draws the current source.
              if (
                (online() ? readOperation().read(block) : readCodeBlock(block, params)).source !==
                source
              )
                scheduleScan();
            }
          } else {
            cleanup?.();
            // A scan removed the panel mid-render and skipped the block as drawing: draw it again.
            scheduleScan();
          }
        } catch {
          if (signal.aborted) return;
          // As on Gemini, an unexpected failure shows the code again.
          failed.set(block, source);
          remove(block);
        }
      },
      () => {
        drawing.delete(block);
        if (!panels.has(block)) release(block);
      },
    );
    drawing.set(block, machine);
  };

  const scan = (): void => {
    if (scope.isDisposed) return;
    for (const [block, panel] of Array.from(panels)) {
      // The host re-rendered the block or put something between: draw it afresh.
      if (!block.isConnected || panel.host.nextElementSibling !== block) remove(block);
    }
    const read = readOperation();
    if (read.checked)
      for (const [block, panel] of panels) {
        if (
          !read.blocks.includes(block) ||
          (panel.origin && read.owner(block) !== panel.origin.reply)
        ) {
          remove(block);
        } else if (panel.origin && !drawing.has(block)) {
          // Re-highlighting replaces <code>; a fresh checked scan keeps the panel and its selected view.
          panel.origin = { reply: panel.origin.reply, source: read.sourceElement(block) };
        }
      }
    for (const block of read.blocks) {
      if (!(block instanceof HTMLElement) || drawing.has(block)) continue;
      // Two activations' panels before one block would displace each other on every rescan.
      if (ownedByOther(block)) continue;
      const { language, source } = read.read(block);
      if (!diagram.matches(language, source)) {
        remove(block);
        continue;
      }
      const panel = panels.get(block);
      if (panel?.source === source) {
        if (params.exportImage === true && !panel.withdraw)
          panel.withdraw = provideDiagramExport(block, () => exportOf(block, panel));
        continue;
      }
      if (failed.get(block) === source) continue;
      void draw(
        block,
        source,
        read.checked ? { reply: read.owner(block), source: read.sourceElement(block) } : null,
      );
    }
  };

  // Registered first so it runs last: observers and timers are gone before panels go.
  scope.effect(
    () => () => {
      for (const machine of drawing.values()) void machine.stop();
      drawing.clear();
      Array.from(panels.keys()).forEach(remove);
      // A draw still waiting on its library holds a claim but no panel yet.
      querySafe(doc, `[${OWNER_ATTR}="${owner}"]`).forEach((block) =>
        block.removeAttribute(OWNER_ATTR),
      );
    },
    `${diagram.name}:remove-panels`,
  );
  let rescan: Dispose | null = null;
  const scheduleScan = (): void => {
    if (scope.isDisposed) return;
    void rescan?.();
    rescan = scope.timer(scan, RESCAN_DELAY_MS);
  };
  scope.observe(doc.body, { childList: true, subtree: true, characterData: true }, scheduleScan);
  scope.observe(
    doc.body,
    { attributes: true, subtree: true, attributeFilter: [OWNER_ATTR] },
    (records) => {
      // A claim dropped before its first draw leaves no panel to remove, so only the attribute says the block is free.
      const freed = records.some(
        ({ target }) => target instanceof Element && !target.hasAttribute(OWNER_ATTR),
      );
      if (freed) scheduleScan();
    },
  );
  scope.observe(doc.documentElement, { attributes: true, attributeFilter: [SCHEME_ATTR] }, () => {
    // Before the first draw there is nothing to redo; that draw reads the scheme.
    if (!ready || scope.isDisposed) return;
    ready = null;
    panels.forEach((panel) => (panel.source = null));
    scan();
  });
  scan();
}
