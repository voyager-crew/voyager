// @vitest-environment-options { "url": "https://gemini.google.com/app/test" }
import { afterEach, expect, it, vi } from 'vitest';

import { initializeSiteSelectors } from '@/core/selectors';

import { mountPersistentExportToolbar } from '../persistentExportToolbar';
import { mockRect, nextFrame } from './persistentExportToolbarHarness';

const stops: Array<() => void> = [];
afterEach(() => {
  stops
    .splice(0)
    .reverse()
    .forEach((stop) => stop());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

async function patch(): Promise<void> {
  const run = initializeSiteSelectors('gemini', {
    host: 'gemini.google.com',
    doc: document,
    lifetime: new AbortController().signal,
    bundledRevision: 0,
    read: async () => ({
      id: 'gemini',
      catalogRevision: 1,
      locators: {
        'exportLayout.controls': ['.remote-controls'],
        'exportLayout.broadControls': ['.remote-broad'],
        'exportLayout.canvasOwner': ['.remote-owner'],
        'exportLayout.canvasContent': ['.remote-canvas'],
      },
    }),
  });
  stops.push(run.stop);
  await run.ready;
}

function mount() {
  const handle = mountPersistentExportToolbar({ label: 'Export', tooltip: 'Export', onClick() {} });
  stops.push(handle.remove);
  return handle;
}

function control(left: number): HTMLElement {
  const node = document.createElement('top-bar-actions');
  node.className = 'remote-controls';
  mockRect(node, { left, top: 8, right: 1260, bottom: 44, width: 1260 - left, height: 36 });
  document.body.append(node);
  return node;
}

it('online placement keeps the same offset without document scans for unrelated streamed batches', async () => {
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280);
  control(920);
  const bundled = mount();
  await nextFrame();
  const expected = bundled.root.style.getPropertyValue('--gv-persistent-export-right');
  expect(expected).toBe('372px');
  bundled.remove();
  await patch();
  const repaired = mount();
  await nextFrame();
  expect(repaired.root.style.getPropertyValue('--gv-persistent-export-right')).toBe(expected);
  const queries = vi.spyOn(document, 'querySelectorAll');
  const chat = document.createElement('main');
  document.body.append(chat);
  for (let i = 0; i < 10; i++) {
    chat.append(document.createElement('p'));
    chat.classList.toggle('streaming');
    await Promise.resolve();
  }
  await nextFrame();
  expect(queries).not.toHaveBeenCalled();
  expect(repaired.root.style.getPropertyValue('--gv-persistent-export-right')).toBe(expected);
});

it('one measurement proves each remote layout field once even with several controls', async () => {
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280);
  control(920);
  control(1000);
  document.body.insertAdjacentHTML('beforeend', '<section class="remote-canvas"></section>');
  await patch();
  const queries = vi.spyOn(document, 'querySelectorAll');
  const handle = mount();
  await nextFrame();
  expect(handle.root.style.getPropertyValue('--gv-persistent-export-right')).toBe('372px');
  expect(queries.mock.calls.filter(([selector]) => selector === '.remote-canvas')).toHaveLength(1);
});

it('a previously missing remote control is measured when it appears and released when it leaves', async () => {
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280);
  await patch();
  const handle = mount();
  await nextFrame();
  expect(handle.root.style.getPropertyValue('--gv-persistent-export-right')).toBe('84px');
  const node = document.createElement('section');
  node.className = 'remote-controls';
  mockRect(node, { left: 900, top: 8, right: 1260, bottom: 44, width: 360, height: 36 });
  document.body.append(node);
  await Promise.resolve();
  await nextFrame();
  expect(handle.root.style.getPropertyValue('--gv-persistent-export-right')).toBe('392px');
  node.remove();
  await Promise.resolve();
  await nextFrame();
  expect(handle.root.style.getPropertyValue('--gv-persistent-export-right')).toBe('84px');
});
