import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import claudeData from '@/features/plugins/catalog/sites/claude/site.json';
import { validateSiteAdapterData } from '@/features/plugins/sites/siteAdapterData';
import { createMemoryStorage, settle as settleStorage } from '@/tests/memoryStorage';

import { mountPersistentExportToolbar } from '../persistentExportToolbar';
import { siteTurnSelector } from '../sites/siteTurnSelector';
import {
  cleanUpToolbars,
  headerButton,
  hitTestByRects,
  mockRect,
  mockToolbarGeometry,
  nextFrame,
} from './persistentExportToolbarHarness';

const VIEWPORT_WIDTH = 1384;
const RIGHT = '--gv-persistent-export-right';

function claudeTurnSelector(): string | undefined {
  const validated = validateSiteAdapterData(claudeData);
  if (!validated.success) throw new Error(JSON.stringify(validated.error));
  return siteTurnSelector(validated.data);
}

function overlaps(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

async function settle(frames = 1): Promise<void> {
  for (let i = 0; i < frames; i++) {
    await Promise.resolve();
    await nextFrame();
  }
}

/** A stand-in ResizeObserver whose `resize` reports a new width for an observed element. */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly targets = new Set<Element>();
  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }
  observe(target: Element): void {
    this.targets.add(target);
  }
  unobserve(target: Element): void {
    this.targets.delete(target);
  }
  disconnect(): void {
    this.targets.clear();
  }
  static resize(target: Element, width: number): void {
    for (const observer of FakeResizeObserver.instances) {
      if (!observer.targets.has(target)) continue;
      const entry = { target, contentRect: { width } } as unknown as ResizeObserverEntry;
      observer.callback([entry], observer as unknown as ResizeObserver);
    }
  }
}

describe('persistent export toolbar on Claude', () => {
  let header: HTMLElement;
  let controls: HTMLElement[];
  let restoreStorage: typeof chrome.storage;

  beforeEach(() => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(VIEWPORT_WIDTH);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(900);
    restoreStorage = globalThis.chrome.storage;
    globalThis.chrome.storage = createMemoryStorage().api;
    header = document.createElement('header');
    document.body.appendChild(header);
    // Measured on claude.ai: the activity panel button and Share, 28px tall at top 8.
    controls = [
      headerButton(header, { left: 1268, right: 1296, top: 8, bottom: 36 }, 'Activity panel'),
      headerButton(header, { left: 1300, right: 1376, top: 8, bottom: 36 }, 'Share'),
    ];
    hitTestByRects(() => controls, header);
  });

  afterEach(() => {
    globalThis.chrome.storage = restoreStorage;
    header.remove();
    document.querySelectorAll('aside, main').forEach((node) => node.remove());
    vi.useRealTimers();
    vi.unstubAllGlobals();
    FakeResizeObserver.instances = [];
    cleanUpToolbars();
  });

  async function mountOnClaude(): Promise<HTMLDivElement> {
    const handle = mountPersistentExportToolbar({
      label: 'Export',
      tooltip: 'Export chat history',
      onClick: vi.fn(),
      siteId: 'claude',
      turnSelector: claudeTurnSelector(),
    });
    mockToolbarGeometry(handle.root, { width: 77, height: 28, dockTop: 8 });
    await settleStorage();
    await settle();
    return handle.root;
  }

  function expectClearOfControls(root: HTMLElement): void {
    const box = root.getBoundingClientRect();
    for (const control of controls.filter((node) => node.isConnected)) {
      expect(overlaps(box, control.getBoundingClientRect())).toBe(false);
    }
  }

  it('keeps the export button off the header activity panel and Share buttons', async () => {
    const root = await mountOnClaude();

    expect(root.dataset.gvPlatform).toBe('claude');
    expect(root.style.getPropertyValue(RIGHT)).toBe('128px');
    expectClearOfControls(root);
  });

  it('moves off the file preview panel Copy button and back when the panel closes', async () => {
    const root = await mountOnClaude();
    expect(root.style.getPropertyValue(RIGHT)).toBe('128px');

    // The panel opens on the right; the chat header moves left with its column.
    const panel = document.createElement('aside');
    const copy = headerButton(panel, { left: 1250, right: 1306, top: 8, bottom: 40 }, 'Copy');
    mockRect(controls[0], { left: 788, right: 816, top: 8, bottom: 36, width: 28, height: 28 });
    mockRect(controls[1], { left: 820, right: 896, top: 8, bottom: 36, width: 76, height: 28 });
    controls.push(copy);
    document.body.appendChild(panel);
    await settle();

    expect(root.style.getPropertyValue(RIGHT)).toBe('146px');
    expectClearOfControls(root);

    controls.pop();
    mockRect(controls[0], { left: 1268, right: 1296, top: 8, bottom: 36, width: 28, height: 28 });
    mockRect(controls[1], { left: 1300, right: 1376, top: 8, bottom: 36, width: 76, height: 28 });
    panel.remove();
    await settle();

    expect(root.style.getPropertyValue(RIGHT)).toBe('128px');
    expectClearOfControls(root);
  });

  it('follows the preview panel as it is resized, which changes no DOM near it', async () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const panel = document.createElement('aside');
    const copy = headerButton(panel, { left: 1250, right: 1306, top: 8, bottom: 40 }, 'Copy');
    controls.push(copy);
    mockRect(controls[0], { left: 788, right: 816, top: 8, bottom: 36, width: 28, height: 28 });
    mockRect(controls[1], { left: 820, right: 896, top: 8, bottom: 36, width: 76, height: 28 });
    document.body.appendChild(panel);
    const root = await mountOnClaude();
    expect(root.style.getPropertyValue(RIGHT)).toBe('146px');
    FakeResizeObserver.resize(panel, 484);

    // Dragging the divider narrows the panel: the chat header's buttons slide under the toolbar.
    mockRect(controls[0], { left: 1128, right: 1156, top: 8, bottom: 36, width: 28, height: 28 });
    mockRect(controls[1], { left: 1160, right: 1236, top: 8, bottom: 36, width: 76, height: 28 });
    FakeResizeObserver.resize(panel, 144);
    await settle();

    expect(root.style.getPropertyValue(RIGHT)).toBe('268px');
    expectClearOfControls(root);
  });

  it('does not hit-test while a reply streams text and buttons into its turn', async () => {
    const main = document.createElement('main');
    const reply = document.createElement('div');
    reply.setAttribute('data-testid', 'assistant-message');
    reply.setAttribute('data-turn-key', 'turn-1');
    main.appendChild(reply);
    document.body.appendChild(main);
    await mountOnClaude();
    const hitTest = vi.spyOn(document, 'elementsFromPoint');
    const querySpy = vi.spyOn(document, 'querySelectorAll');

    for (let i = 0; i < 40; i++) {
      const chunk = document.createElement('p');
      chunk.textContent = `Streamed chunk ${i}`;
      reply.appendChild(chunk);
      reply.appendChild(document.createElement('button'));
      await settle();
    }

    expect(hitTest).not.toHaveBeenCalled();
    expect(querySpy).not.toHaveBeenCalled();
  });

  /** Mounts under fake timers and frames; no site id, so no storage read. */
  async function mountOnFakeClock(): Promise<HTMLDivElement> {
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'Date',
      ],
    });
    const handle = mountPersistentExportToolbar({
      label: 'Export',
      tooltip: 'Export chat history',
      onClick: vi.fn(),
      turnSelector: claudeTurnSelector(),
    });
    mockToolbarGeometry(handle.root, { width: 77, height: 28, dockTop: 8 });
    await vi.advanceTimersByTimeAsync(16);
    return handle.root;
  }

  it('re-measures a few times, not every frame, while buttons keep appearing outside turns', async () => {
    const root = await mountOnFakeClock();
    const handle = { root };
    expect(handle.root.style.getPropertyValue(RIGHT)).toBe('128px');
    const querySpy = vi.spyOn(document, 'querySelectorAll');
    const sidebar = document.createElement('main');
    document.body.appendChild(sidebar);

    for (let i = 0; i < 60; i++) {
      sidebar.appendChild(document.createElement('button'));
      await vi.advanceTimersByTimeAsync(16);
    }
    const duringStream = querySpy.mock.calls.length;
    // The last one lands under the toolbar; the trailing re-measure still catches it.
    controls.push(headerButton(sidebar, { left: 1200, right: 1240, top: 8, bottom: 36 }));
    await vi.advanceTimersByTimeAsync(400);

    expect(duringStream).toBeGreaterThan(0);
    expect(duringStream).toBeLessThanOrEqual(5);
    expect(handle.root.style.getPropertyValue(RIGHT)).toBe('196px');
    expectClearOfControls(handle.root);
  });

  it('keeps clear of Share and steps under a host dialog backdrop covering the header', async () => {
    const root = await mountOnClaude();
    const backdrop = document.createElement('div');
    mockRect(backdrop, { left: 0, top: 0, right: 1384, bottom: 900, width: 1384, height: 900 });
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.appendChild(document.createElement('button'));
    hitTestByRects(() => [...controls, backdrop], header);
    document.body.append(backdrop, dialog);
    await settle();

    expect(root.style.getPropertyValue(RIGHT)).toBe('128px');
    expect(root.classList.contains('gv-persistent-export-toolbar--under-modal')).toBe(true);

    backdrop.remove();
    dialog.remove();
    await settle();
    expect(root.style.getPropertyValue(RIGHT)).toBe('128px');
    expect(root.classList.contains('gv-persistent-export-toolbar--under-modal')).toBe(false);
  });

  it('steps under a host dialog on a page whose root carries Voyager theme classes', async () => {
    document.documentElement.classList.add('gv-platform-themed');
    const root = await mountOnClaude();
    const backdrop = document.createElement('div');
    mockRect(backdrop, { left: 0, top: 0, right: 1384, bottom: 900, width: 1384, height: 900 });
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.appendChild(document.createElement('button'));
    hitTestByRects(() => [...controls, backdrop], header);
    document.body.append(backdrop, dialog);
    await settle();

    expect(root.classList.contains('gv-persistent-export-toolbar--under-modal')).toBe(true);

    backdrop.remove();
    dialog.remove();
    document.documentElement.classList.remove('gv-platform-themed');
  });

  it('keeps clear of Share while a host menu disables page pointer events', async () => {
    const root = await mountOnClaude();
    // Hit-testing skips everything under a `pointer-events: none` body.
    hitTestByRects(
      () => (document.body.style.pointerEvents === 'none' ? [] : controls),
      document.documentElement,
    );
    document.body.style.pointerEvents = 'none';
    await settle();

    expect(root.style.getPropertyValue(RIGHT)).toBe('128px');
    expect(root.classList.contains('gv-persistent-export-toolbar--under-modal')).toBe(false);

    document.body.style.pointerEvents = '';
    await settle();
    expect(root.style.getPropertyValue(RIGHT)).toBe('128px');
    expectClearOfControls(root);
  });

  it('does not re-measure as a streaming reply under the toolbar widens', async () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    controls = [];
    const reply = document.createElement('div');
    reply.setAttribute('data-turn-key', 'turn-1');
    const table = document.createElement('table');
    reply.appendChild(table);
    document.body.appendChild(reply);
    hitTestByRects(() => [], table);
    await mountOnClaude();
    const hitTest = vi.spyOn(document, 'elementsFromPoint');

    for (let i = 0; i < 40; i++) {
      FakeResizeObserver.resize(table, 300 + i * 8);
      FakeResizeObserver.resize(reply, 300 + i * 8);
      await settle();
    }

    expect(hitTest).not.toHaveBeenCalled();
    reply.remove();
  });

  it('re-measures a few times, not every frame, while a panel beside it keeps changing width', async () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const root = await mountOnFakeClock();
    expect(root.style.getPropertyValue(RIGHT)).toBe('128px');
    FakeResizeObserver.resize(header, 1384);
    const querySpy = vi.spyOn(document, 'querySelectorAll');

    for (let i = 0; i < 60; i++) {
      FakeResizeObserver.resize(header, 1384 - i * 4);
      await vi.advanceTimersByTimeAsync(16);
    }

    expect(querySpy.mock.calls.length).toBeGreaterThan(0);
    expect(querySpy.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it('moves off a preview panel that slides in after it first appears', async () => {
    const root = await mountOnFakeClock();
    const panel = document.createElement('aside');
    // Off screen while its slide-in transform starts.
    const copy = headerButton(panel, { left: 1500, right: 1556, top: 8, bottom: 40 }, 'Copy');
    controls.push(copy);
    document.body.appendChild(panel);
    await vi.advanceTimersByTimeAsync(16);
    expect(root.style.getPropertyValue(RIGHT)).toBe('128px');

    // The transform ends with Copy under the toolbar: no mutation, no width change.
    mockRect(copy, { left: 1200, right: 1256, top: 8, bottom: 40, width: 56, height: 32 });
    await vi.advanceTimersByTimeAsync(400);

    expect(root.style.getPropertyValue(RIGHT)).toBe('196px');
    expectClearOfControls(root);
  });
});
