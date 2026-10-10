/**
 * Shared engine of the code-block diagram primitives: finds a site's code
 * blocks inside replies and shows a diagram before each one that a
 * {@link CodeBlockDiagram} claims, with a Diagram / Code toggle.
 *
 * PATTERN for another diagram primitive (`mermaid.ts` is the reference):
 *   1. Keep Gemini's renderer in `pages/content/<kind>/` and give it a site-neutral
 *      entry point: the theme comes from the caller, the library stays a lazy import.
 *   2. `verbs/<kind>.ts` defines a `CodeBlockDiagram` (matches / prepare / render) and a
 *      primitive whose `activate` calls `activateCodeBlockDiagram`.
 *   3. Contract `params: CODE_BLOCK_DIAGRAM_PARAMS`, a baseline entry and the registry binding.
 *   4. Each site's `diagram-rendering` manifest gets one more `native` op and handler.
 *
 * Host safety: the host's code block is never moved or edited. The panel goes
 * right before it with its UI in a shadow root, so reply text, timeline
 * summaries and export never read it; the block is hidden only through
 * `data-gv-diagram-hidden`. Unmount removes every panel and that attribute.
 */
import type { Result } from '@/core/types/common';
import { SCHEME_ATTR, type Scheme, getScheme } from '@/pages/content/platformTheme/scheme';

import type { ManifestIssue } from '../manifest/validate';
import type { Dispose, PluginScope } from '../runtime/pluginScope';
import type { PrimitiveContext } from './types';

export interface CodeBlockDiagramParams {
  readonly turn?: string;
  readonly codeBlock?: string;
  readonly code?: string;
  readonly codeLine?: string;
  readonly language?: string;
}

export interface CodeBlockDiagram {
  /** The primitive's name, stamped on each panel as `data-gv-diagram`. */
  readonly name: string;
  /** Text of the toggle button that shows the diagram. */
  readonly label: string;
  /** Extra CSS inside the panel's shadow root; the drawn diagram sits in `.diagram`. */
  readonly css?: string;
  /** Whether a block with this language id (lowercase; null when untagged or plain text) and source is this diagram. */
  matches(language: string | null, source: string): boolean;
  /** Load the library for `scheme`; false leaves every block as code. Runs again after a scheme change. */
  prepare(scheme: Scheme): Promise<boolean>;
  /** Draw `source` into `target` (attached and visible); a returned cleanup runs before the next draw and on removal. */
  render(target: HTMLElement, source: string): Promise<void | (() => void)>;
  /** The drawn diagram was clicked, or the fullscreen button pressed when `fullscreenLabel` is set. */
  openFullscreen?(target: HTMLElement): void;
  /**
   * Accessible name of a toolbar fullscreen button. Set it for an interactive
   * diagram (a chart's legend and tooltips), whose clicks must not open fullscreen.
   */
  readonly fullscreenLabel?: string;
  /** Page-level setup, such as fullscreen styles, for the activation's lifetime. */
  install?(doc: Document): () => void;
}

const PARAM_NAMES: readonly string[] = ['turn', 'codeBlock', 'code', 'codeLine', 'language'];
const MAX_SELECTOR_LENGTH = 2_000;
/** Gemini's pacing: streaming replies settle before a diagram is drawn. */
const RESCAN_DELAY_MS = 1_000;
const DEFAULT_CODE_BLOCK = 'pre';
const HIDDEN_ATTR = 'data-gv-diagram-hidden';
const PANEL_CLASS = 'gv-diagram-panel';
const LANGUAGE_CLASS = /(?:^|\s)lang(?:uage)?-(\S+)/i;
/**
 * A language label is an id such as `mermaid`, `c++` or `objective-c`. Hosts
 * print a localized phrase on a block without one (ChatGPT: 纯文本, Texte brut),
 * which no list can cover, so anything not shaped like an id is no label.
 */
const LANGUAGE_ID = /^[a-z0-9_+#.-]{1,32}$/;
/** Ids that name no language either, so the block's content still decides. */
const PLAIN_TEXT_IDS: ReadonlySet<string> = new Set(['text', 'plaintext', 'plain', 'txt']);

const PAGE_CSS = `
[${HIDDEN_ATTR}] { display: none !important; }
.${PANEL_CLASS} {
  display: block;
  margin: 8px 0;
  --gv-diagram-surface: #f8f9fa;
  --gv-diagram-border: rgba(0, 0, 0, 0.12);
  --gv-diagram-fg: #444746;
  --gv-diagram-hover: rgba(0, 0, 0, 0.06);
}
html[data-gv-scheme='dark'] .${PANEL_CLASS} {
  --gv-diagram-surface: #1e1f20;
  --gv-diagram-border: rgba(255, 255, 255, 0.14);
  --gv-diagram-fg: #c4c7c5;
  --gv-diagram-hover: rgba(255, 255, 255, 0.08);
}`;

const SHADOW_CSS = `
:host { display: block; }
.toolbar { display: flex; justify-content: flex-end; gap: 4px; margin-bottom: 4px; }
button {
  padding: 4px 10px;
  border: 1px solid var(--gv-diagram-border);
  border-radius: 6px;
  background: transparent;
  color: var(--gv-diagram-fg);
  font: 12px/1.4 system-ui, sans-serif;
  cursor: pointer;
}
button:hover { background: var(--gv-diagram-hover); }
button:disabled { cursor: not-allowed; opacity: 0.45; }
button:focus-visible { outline: 2px solid var(--gv-pm-brand, #1a73e8); outline-offset: 2px; }
button[aria-pressed='true'] {
  border-color: transparent;
  background: var(--gv-pm-brand, #1a73e8);
  color: var(--gv-pm-brand-fg, #fff);
}
.diagram {
  min-height: 100px;
  padding: 16px;
  overflow: auto;
  border: 1px solid var(--gv-diagram-border);
  border-radius: 12px;
  background: var(--gv-diagram-surface);
  color: var(--gv-diagram-fg);
  text-align: center;
  cursor: zoom-in;
}
.diagram svg { max-width: 100%; height: auto; }
:host([data-view='code']) .diagram { display: none; }`;

interface Panel {
  readonly host: HTMLElement;
  readonly target: HTMLElement;
  /** Source of the last draw; null asks the next scan to draw again. */
  source: string | null;
  cleanup: void | (() => void);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function querySafe(root: ParentNode, selector: string): Element[] {
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    return [];
  }
}

function classLanguage(element: Element): string | undefined {
  return LANGUAGE_CLASS.exec(element.getAttribute('class') ?? '')?.[1];
}

/** `label` as a lowercase language id, or null when it names no language. */
function languageId(label: string | null | undefined): string | null {
  const id = label?.trim().toLowerCase();
  return id && LANGUAGE_ID.test(id) && !PLAIN_TEXT_IDS.has(id) ? id : null;
}

export function validateCodeBlockDiagramParams(
  raw: unknown,
): Result<CodeBlockDiagramParams, ManifestIssue[]> {
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
}

/** A code block's language id (lowercase; null when untagged or plain text) and source text. */
export function readCodeBlock(
  block: Element,
  params: CodeBlockDiagramParams,
): { language: string | null; source: string } {
  const code = querySafe(block, params.code ?? 'code')[0] ?? block;
  const lines = params.codeLine ? querySafe(code, params.codeLine) : [];
  const source =
    lines.length > 0
      ? lines.map((line) => line.textContent ?? '').join('\n')
      : (code.textContent ?? '');
  const label = params.language ? querySafe(block, params.language)[0]?.textContent : null;
  // A localized "plain text" label is no language: the block's content decides, as on Gemini.
  const language =
    languageId(label) ?? languageId(classLanguage(code)) ?? languageId(classLanguage(block));
  return { language, source };
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
  context.setTargetCounter(() => querySafe(doc, turn).length);

  const panels = new Map<HTMLElement, Panel>();
  const drawing = new Set<HTMLElement>();
  // A source that failed unexpectedly is not retried, or every rescan would redraw it.
  const failed = new WeakMap<HTMLElement, string>();
  let ready: Promise<boolean> | null = null;
  const prepare = (): Promise<boolean> =>
    (ready ??= diagram.prepare(getScheme(doc)).catch(() => false));

  const remove = (block: HTMLElement): void => {
    const panel = panels.get(block);
    if (!panel) return;
    panels.delete(block);
    panel.cleanup?.();
    panel.host.remove();
    block.removeAttribute(HIDDEN_ATTR);
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

  const createPanel = (block: HTMLElement): Panel => {
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
    const button = (text: string): HTMLButtonElement => {
      const element = doc.createElement('button');
      element.type = 'button';
      element.textContent = text;
      toolbar.append(element);
      return element;
    };
    const diagramButton = button(diagram.label);
    const codeButton = button('</> Code');
    const fullscreenLabel = diagram.fullscreenLabel;
    const fullscreenButton = fullscreenLabel ? button('⛶') : null;
    if (fullscreenButton && fullscreenLabel) {
      fullscreenButton.title = fullscreenLabel;
      fullscreenButton.setAttribute('aria-label', fullscreenLabel);
    }
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
    show('diagram');
    const panel: Panel = { host, target, source: null, cleanup: undefined };
    panels.set(block, panel);
    return panel;
  };

  const draw = async (block: HTMLElement, source: string): Promise<void> => {
    drawing.add(block);
    try {
      if (!(await prepare()) || scope.isDisposed || !block.isConnected) return;
      const panel = panels.get(block) ?? createPanel(block);
      panel.cleanup?.();
      panel.cleanup = undefined;
      panel.source = source;
      const cleanup = await diagram.render(panel.target, source);
      if (panels.get(block) === panel) panel.cleanup = cleanup;
      else cleanup?.();
    } catch {
      // As on Gemini, an unexpected failure shows the code again.
      failed.set(block, source);
      remove(block);
    } finally {
      drawing.delete(block);
    }
  };

  const scan = (): void => {
    if (scope.isDisposed) return;
    for (const [block, panel] of Array.from(panels)) {
      // The host re-rendered the block or put something between: draw it afresh.
      if (!block.isConnected || panel.host.nextElementSibling !== block) remove(block);
    }
    for (const reply of querySafe(doc, turn)) {
      for (const block of querySafe(reply, blockSelector)) {
        if (!(block instanceof HTMLElement) || drawing.has(block)) continue;
        const { language, source } = readCodeBlock(block, params);
        if (!diagram.matches(language, source)) {
          remove(block);
          continue;
        }
        if (panels.get(block)?.source === source || failed.get(block) === source) continue;
        void draw(block, source);
      }
    }
  };

  // Registered first so it runs last: observers and timers are gone before panels go.
  scope.effect(
    () => () => Array.from(panels.keys()).forEach(remove),
    `${diagram.name}:remove-panels`,
  );
  let rescan: Dispose | null = null;
  scope.observe(doc.body, { childList: true, subtree: true, characterData: true }, () => {
    if (scope.isDisposed) return;
    void rescan?.();
    rescan = scope.timer(scan, RESCAN_DELAY_MS);
  });
  scope.observe(doc.documentElement, { attributes: true, attributeFilter: [SCHEME_ATTR] }, () => {
    // Before the first draw there is nothing to redo; that draw reads the scheme.
    if (!ready || scope.isDisposed) return;
    ready = null;
    panels.forEach((panel) => (panel.source = null));
    scan();
  });
  scan();
}
