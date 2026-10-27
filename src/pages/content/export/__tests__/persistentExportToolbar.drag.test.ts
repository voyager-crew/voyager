import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { type MemoryStorage, createMemoryStorage, settle } from '@/tests/memoryStorage';

import { mountPersistentExportToolbar } from '../persistentExportToolbar';
import {
  cleanUpToolbars,
  headerButton,
  hitTestByRects,
  mockToolbarGeometry,
  nextFrame,
} from './persistentExportToolbarHarness';

const userEvents = new WeakSet<Event>();
vi.mock('@/core/utils/userEvent', () => ({ isUserEvent: (event: Event) => userEvents.has(event) }));

const KEY = StorageKeys.PERSISTENT_EXPORT_TOOLBAR_POSITION;
const RIGHT = '--gv-persistent-export-right';
const WIDTH = 77;
const HEIGHT = 28;

let viewport = { width: 1384, height: 1000 };
let memory: MemoryStorage;
let restoreStorage: typeof chrome.storage;

beforeEach(() => {
  viewport = { width: 1384, height: 1000 };
  vi.spyOn(window, 'innerWidth', 'get').mockImplementation(() => viewport.width);
  vi.spyOn(window, 'innerHeight', 'get').mockImplementation(() => viewport.height);
  restoreStorage = globalThis.chrome.storage;
  memory = createMemoryStorage();
  globalThis.chrome.storage = memory.api;
});

afterEach(() => {
  globalThis.chrome.storage = restoreStorage;
  document.querySelectorAll('header').forEach((node) => node.remove());
  cleanUpToolbars();
});

async function mount(siteId = 'claude') {
  const onClick = vi.fn();
  const handle = mountPersistentExportToolbar({
    label: 'Export',
    tooltip: 'Export chat history',
    onClick,
    siteId,
  });
  mockToolbarGeometry(handle.root, { width: WIDTH, height: HEIGHT, dockTop: 8 });
  await settle();
  await nextFrame();
  return { ...handle, onClick };
}

function pointer(type: string, target: EventTarget, x: number, y: number, pointerType = 'mouse') {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    pointerId: 1,
    pointerType,
    button: 0,
    // Held while pressed and moving; released on pointerup.
    buttons: type === 'pointerup' ? 0 : 1,
  });
  userEvents.add(event);
  target.dispatchEvent(event);
}

/** Presses the button at its centre, drags by (dx, dy) and lets go, then the browser's click. */
function drag(
  button: HTMLElement,
  root: HTMLElement,
  dx: number,
  dy: number,
  pointerType = 'mouse',
) {
  const box = root.getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  pointer('pointerdown', button, x, y, pointerType);
  pointer('pointermove', document.body, x + dx / 2, y + dy / 2, pointerType);
  pointer('pointermove', document.body, x + dx, y + dy, pointerType);
  pointer('pointerup', button, x + dx, y + dy, pointerType);
  button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
}

function savedSpots(): unknown {
  return memory.values.local.get(KEY);
}

describe('dragging the persistent export toolbar', () => {
  it('moves by touch, remembers the spot for its site, and does not start an export', async () => {
    const { root, button, onClick } = await mount('claude');
    expect(root.getBoundingClientRect()).toMatchObject({ left: 1223, top: 8 });

    drag(button, root, -660, 278, 'touch');
    await settle();

    expect(onClick).not.toHaveBeenCalled();
    expect(root.getBoundingClientRect()).toMatchObject({ left: 563, top: 286 });
    expect(savedSpots()).toEqual({ claude: { right: 744, top: 286 } });

    button.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('treats a press that barely moves as a click', async () => {
    const { root, button, onClick } = await mount('claude');

    drag(button, root, 3, 2);
    await settle();

    expect(onClick).toHaveBeenCalledOnce();
    expect(root.getBoundingClientRect()).toMatchObject({ left: 1223, top: 8 });
    expect(savedSpots()).toBeUndefined();
  });

  it("restores each site's own spot and leaves other sites' spots alone", async () => {
    memory.values.local.set(KEY, {
      claude: { right: 400, top: 300 },
      chatgpt: { right: 120, top: 500 },
    });
    const { root, button } = await mount('claude');

    expect(root.getBoundingClientRect()).toMatchObject({ left: 907, top: 300 });
    expect(root.classList.contains('gv-persistent-export-toolbar--placing')).toBe(false);

    drag(button, root, -100, 0);
    await settle();
    expect(savedSpots()).toEqual({
      claude: { right: 500, top: 300 },
      chatgpt: { right: 120, top: 500 },
    });
  });

  it('snaps back to the dock and forgets the spot when dropped near it', async () => {
    memory.values.local.set(KEY, { claude: { right: 400, top: 300 }, kimi: { right: 9, top: 9 } });
    const { root, button } = await mount('claude');
    expect(root.getBoundingClientRect()).toMatchObject({ left: 907, top: 300 });

    // Back towards the top-right dock, landing a little off it.
    drag(button, root, 1223 - 907 + 10, 8 - 300 + 12);
    await settle();

    expect(root.style.top).toBe('');
    expect(root.style.getPropertyValue(RIGHT)).toBe('84px');
    expect(savedSpots()).toEqual({ kimi: { right: 9, top: 9 } });
  });

  it('moves off a control it was dropped on, to the nearer free side', async () => {
    const header = document.createElement('header');
    document.body.appendChild(header);
    const control = headerButton(header, { left: 600, right: 640, top: 280, bottom: 320 });
    hitTestByRects(() => [control], header);
    const { root, button } = await mount('claude');

    // Dropped with its left edge at 610: mostly past the control's right edge.
    drag(button, root, 610 - 1223, 286 - 8);
    await settle();
    await nextFrame();

    const box = root.getBoundingClientRect();
    expect(box.left).toBe(652);
    expect(box.left).toBeGreaterThanOrEqual(control.getBoundingClientRect().right);
    // The drop itself is remembered, so the toolbar returns there once the control goes.
    expect(savedSpots()).toEqual({ claude: { right: 697, top: 286 } });

    control.remove();
    window.dispatchEvent(new Event('resize'));
    await nextFrame();
    expect(root.getBoundingClientRect().left).toBe(610);
  });

  it('stays inside a window that became smaller than its spot', async () => {
    memory.values.local.set(KEY, { claude: { right: 1200, top: 900 } });
    const { root } = await mount('claude');
    expect(root.getBoundingClientRect()).toMatchObject({ left: 107, top: 900 });

    viewport = { width: 800, height: 600 };
    window.dispatchEvent(new Event('resize'));
    await nextFrame();

    const box = root.getBoundingClientRect();
    expect(box.left).toBeGreaterThanOrEqual(6);
    expect(box.right).toBeLessThanOrEqual(800 - 6);
    expect(box.top).toBeGreaterThanOrEqual(6);
    expect(box.bottom).toBeLessThanOrEqual(600 - 6);
  });

  it('cannot be dragged by a script', async () => {
    const { root, button } = await mount('claude');
    const box = root.getBoundingClientRect();
    for (const type of ['pointerdown', 'pointermove', 'pointerup']) {
      button.dispatchEvent(
        new PointerEvent(type, { bubbles: true, clientX: box.left - 400, clientY: 400 }),
      );
    }
    await settle();

    expect(root.getBoundingClientRect()).toMatchObject({ left: 1223, top: 8 });
    expect(savedSpots()).toBeUndefined();
  });

  it("resets to the dock when dropped on the bare default beside Claude's header buttons", async () => {
    const header = document.createElement('header');
    document.body.appendChild(header);
    const controls = [
      headerButton(header, { left: 1268, right: 1296, top: 8, bottom: 36 }, 'Activity panel'),
      headerButton(header, { left: 1300, right: 1376, top: 8, bottom: 36 }, 'Share'),
    ];
    hitTestByRects(() => controls, header);
    memory.values.local.set(KEY, { claude: { right: 400, top: 300 } });
    const { root, button } = await mount('claude');
    const from = root.getBoundingClientRect();

    // Onto right 84 / top 8: the default before avoidance, over the Activity button.
    drag(button, root, 1223 - from.left, 8 - from.top);
    await settle();

    expect(savedSpots()).toEqual({});
    expect(root.style.top).toBe('');
    expect(root.style.getPropertyValue(RIGHT)).toBe('128px');
  });

  it.each([
    [
      'a move with no button held',
      () => {
        const event = new PointerEvent('pointermove', {
          clientX: 300,
          clientY: 300,
          pointerId: 1,
          buttons: 0,
        });
        userEvents.add(event);
        document.body.dispatchEvent(event);
      },
    ],
    ['the window losing focus', () => window.dispatchEvent(new Event('blur'))],
    [
      'the pointer capture being lost',
      (button: HTMLElement) =>
        button.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 1 })),
    ],
  ])('puts a drag back when its release never arrives: %s', async (_case, interrupt) => {
    const { root, button } = await mount('claude');
    const box = root.getBoundingClientRect();
    pointer('pointerdown', button, box.left + 10, box.top + 10);
    pointer('pointermove', document.body, box.left - 300, box.top + 200);
    expect(root.getBoundingClientRect().top).toBe(198);

    interrupt(button);
    // The pointer hovers on; the toolbar no longer follows it.
    pointer('pointermove', document.body, box.left - 500, box.top + 400);
    await settle();
    await nextFrame();

    expect(root.getBoundingClientRect()).toMatchObject({ left: 1223, top: 8 });
    expect(savedSpots()).toBeUndefined();
  });

  it('does not save a spot once the toolbar is removed', async () => {
    const { root, button, remove } = await mount('claude');
    remove();

    drag(button, root, -400, 200);
    await settle();

    expect(savedSpots()).toBeUndefined();
  });

  it('ignores a malformed saved value and replaces it with a proper one', async () => {
    memory.values.local.set(KEY, [{ right: 400, top: 300 }]);
    const { root, button } = await mount('claude');
    expect(root.getBoundingClientRect()).toMatchObject({ left: 1223, top: 8 });

    drag(button, root, -660, 278);
    await settle();

    expect(savedSpots()).toEqual({ claude: { right: 744, top: 286 } });
  });

  it('keeps a spot dragged before a slow storage read answers', async () => {
    memory.values.local.set(KEY, { claude: { right: 400, top: 300 } });
    const read = memory.api.local.get;
    let answer: (() => void) | null = null;
    memory.api.local.get = ((
      keys: string[],
      callback: (items: Record<string, unknown>) => void,
    ) => {
      answer = () => void read(keys, callback);
    }) as typeof memory.api.local.get;
    const { root, button } = await mount('claude');

    drag(button, root, -660, 278);
    memory.api.local.get = read;
    answer!();
    await settle();
    await nextFrame();

    expect(root.getBoundingClientRect()).toMatchObject({ left: 563, top: 286 });
    expect(savedSpots()).toEqual({ claude: { right: 744, top: 286 } });
  });
});
