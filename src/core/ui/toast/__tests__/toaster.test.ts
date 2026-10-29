import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { toastDriver } from '@/tests/toastDriver';

import { isVoyagerLayerEvent } from '../../layer';
import { createToaster } from '../toaster';
import type { Toaster } from '../types';

const host = () => document.querySelector<HTMLElement>('[data-gv-layer="toast"]');

let toasters: Toaster[] = [];
const toaster = (): Toaster => {
  const created = createToaster();
  toasters.push(created);
  return created;
};

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
});

afterEach(() => {
  for (const created of toasters) created.destroy();
  toasters = [];
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('createToaster', () => {
  it('announces a toast with its tone, and errors as alerts', () => {
    const owner = toaster();
    owner.show({ message: 'Saved', tone: 'success', durationMs: 2000 });
    owner.show({ message: 'Failed', tone: 'error', durationMs: 2000 });
    owner.show({ message: 'Plain', durationMs: 2000 });

    expect(toastDriver.all().map(({ message, tone, role }) => [message, tone, role])).toEqual([
      ['Saved', 'success', 'status'],
      ['Failed', 'error', 'alert'],
      ['Plain', 'info', 'status'],
    ]);
  });

  it('closes after its duration, keeps a sticky toast, and removes the host once empty', () => {
    const owner = toaster();
    owner.show({ message: 'Brief', durationMs: 1000 });
    const sticky = owner.show({ message: 'Sticky', durationMs: null });

    vi.advanceTimersByTime(1000);
    expect(toastDriver.messages()).toEqual(['Sticky']);
    vi.advanceTimersByTime(60_000);
    expect(sticky.isOpen).toBe(true);

    sticky.dismiss();
    expect(host()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('makes room by closing the oldest toast that would close anyway, never a pending or sticky one', () => {
    const owner = toaster();
    owner.show({ message: 'pending', pending: true, durationMs: 35_000 });
    owner.show({ message: 'sticky', durationMs: null });
    for (const n of [1, 2, 3, 4, 5]) owner.show({ message: `t${n}`, durationMs: 5000 });

    expect(toastDriver.messages()).toEqual(['pending', 'sticky', 't2', 't3', 't4', 't5']);
  });

  it('replaces the open toast on the same channel of the same owner only', () => {
    const first = toaster();
    const second = toaster();
    const handle = first.show({
      message: 'Working',
      pending: true,
      channel: 'job',
      durationMs: null,
    });
    second.show({ message: 'Other owner', channel: 'job', durationMs: null });

    const replaced = first.show({
      message: 'Done',
      tone: 'success',
      channel: 'job',
      durationMs: 500,
    });

    expect(replaced).toBe(handle);
    expect(toastDriver.messages()).toEqual(['Done', 'Other owner']);
    expect(toastDriver.find('Done')!.pending).toBe(false);
    vi.advanceTimersByTime(500);
    expect(toastDriver.messages()).toEqual(['Other owner']);

    second.dismiss('job');
    expect(toastDriver.all()).toEqual([]);
  });

  it('shows a channel toast again after the page dropped the host', () => {
    const owner = toaster();
    owner.show({ channel: 'status', message: 'First', durationMs: 5000 });
    document.body.innerHTML = '';

    owner.show({ channel: 'status', message: 'Second', durationMs: 5000 });

    expect(toastDriver.messages()).toEqual(['Second']);
  });

  it('updates in place and restarts the timer only when given a duration', () => {
    const owner = toaster();
    const handle = owner.show({ message: 'Downloading', pending: true, durationMs: 3000 });

    vi.advanceTimersByTime(2000);
    handle.update({ message: 'Processing' });
    vi.advanceTimersByTime(999);
    expect(toastDriver.find('Processing')!.pending).toBe(true);

    handle.update({ message: 'Done', tone: 'success', pending: false, durationMs: 2500 });
    vi.advanceTimersByTime(2499);
    expect(toastDriver.find('Done')).toMatchObject({ tone: 'success', pending: false });
    vi.advanceTimersByTime(1);
    expect(handle.isOpen).toBe(false);
    handle.update({ message: 'too late' });
    expect(toastDriver.all()).toEqual([]);
  });

  describe('pauseOnHover', () => {
    it('waits while the pointer is on it and closes after the time left once it leaves', () => {
      const owner = toaster();
      owner.show({ message: 'Downloaded', durationMs: 10_000, pauseOnHover: true });
      vi.advanceTimersByTime(4000);
      toastDriver.hover(toastDriver.find('Downloaded')!);

      vi.advanceTimersByTime(30_000);
      expect(toastDriver.messages()).toEqual(['Downloaded']);

      toastDriver.leave(toastDriver.find('Downloaded')!);
      vi.advanceTimersByTime(5999);
      expect(toastDriver.messages()).toEqual(['Downloaded']);
      vi.advanceTimersByTime(1);
      expect(toastDriver.all()).toEqual([]);
    });

    it('waits while focus is inside it', () => {
      const owner = toaster();
      owner.show({
        message: 'Downloaded',
        action: { label: 'Undo', run: () => {} },
        durationMs: 10_000,
        pauseOnHover: true,
      });
      toastDriver.focusInside(toastDriver.find('Downloaded')!);
      vi.advanceTimersByTime(20_000);
      expect(toastDriver.messages()).toEqual(['Downloaded']);
    });

    it('leaves a toast without it to close on time under the pointer', () => {
      const owner = toaster();
      owner.show({ message: 'Saved', durationMs: 3000 });
      toastDriver.hover(toastDriver.find('Saved')!);
      vi.advanceTimersByTime(3000);
      expect(toastDriver.all()).toEqual([]);
    });

    it('is not evicted for newer toasts while the person is on it', () => {
      const owner = toaster();
      owner.show({ message: 'Undo me', durationMs: 10_000, pauseOnHover: true });
      toastDriver.hover(toastDriver.find('Undo me')!);
      for (const n of [1, 2, 3, 4, 5]) owner.show({ message: `Note ${n}`, durationMs: 5000 });

      expect(toastDriver.messages()).toContain('Undo me');
      expect(toastDriver.messages()).not.toContain('Note 1');
    });
  });

  it('keeps a changing detail in its own live region', () => {
    const owner = toaster();
    const handle = owner.show({ message: 'Upload the file', detail: '02:00', durationMs: null });
    handle.update({ detail: '01:59' });

    const toast = toastDriver.find('Upload the file')!;
    expect(toast.detail).toBe('01:59');
    const detail = toast.element.querySelector('[aria-live]')!;
    expect(detail.textContent).toBe('01:59');
    expect(detail.getAttribute('aria-atomic')).toBe('true');
  });

  it('leaves the outcome of an action to the caller', () => {
    const owner = toaster();
    const run = vi.fn((handle) => handle.update({ message: 'Opening settings…' }));
    owner.show({ message: 'Could not apply', action: { label: 'Pause', run }, durationMs: null });

    toastDriver.press(toastDriver.find('Could not apply')!, 'Pause');

    expect(run).toHaveBeenCalledOnce();
    expect(toastDriver.messages()).toEqual(['Opening settings…']);
  });

  it('closes on its dismiss button and tells the caller', () => {
    const owner = toaster();
    const onDismiss = vi.fn();
    owner.show({
      message: 'Storage almost full',
      dismissLabel: 'Dismiss',
      onDismiss,
      durationMs: null,
    });

    toastDriver.press(toastDriver.find('Storage')!, 'Dismiss');

    expect(onDismiss).toHaveBeenCalledOnce();
    expect(toastDriver.all()).toEqual([]);
  });

  it('closes and runs onActivate when its message is pressed', () => {
    const owner = toaster();
    const onActivate = vi.fn();
    owner.show({ message: 'New response completed', onActivate, durationMs: 3200 });

    toastDriver.press(toastDriver.find('New response')!, 'New response completed');

    expect(onActivate).toHaveBeenCalledOnce();
    expect(toastDriver.all()).toEqual([]);
  });

  describe('anchored toasts', () => {
    let anchor: HTMLButtonElement;

    beforeEach(() => {
      Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: 700, configurable: true });
      anchor = document.createElement('button');
      document.body.append(anchor);
      vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
        left: 100,
        top: 200,
        right: 140,
        bottom: 240,
        width: 40,
        height: 40,
      } as DOMRect);
    });

    /** Where a toast sits: its container's inline viewport coordinates, if it has any. */
    const placement = (message: string) => {
      const container = toastDriver.find(message)!.element.parentElement!;
      return { container, left: container.style.left, top: container.style.top };
    };

    it('shows an owner’s toasts beside its anchor and others in the stack', () => {
      const owner = toaster();
      const other = toaster();
      other.show({ message: 'elsewhere', durationMs: null });

      owner.setAnchor(anchor, 30_000);
      owner.show({ message: 'Downloading', durationMs: null });

      expect(placement('Downloading')).toMatchObject({ left: '154px', top: '194px' });
      expect(placement('elsewhere')).toMatchObject({ left: '', top: '' });
    });

    it('moves anchored toasts to the stack once the anchor goes stale, with no further update', () => {
      const owner = toaster();
      const other = toaster();
      other.show({ message: 'elsewhere', durationMs: null });
      owner.setAnchor(anchor, 1000);
      owner.show({ message: 'Processing', pending: true, durationMs: 5000 });

      vi.advanceTimersByTime(1001);

      expect(placement('Processing').container).toBe(placement('elsewhere').container);
    });

    it('moves anchored toasts to the stack once the anchor is detached', () => {
      const owner = toaster();
      owner.setAnchor(anchor, 30_000);
      owner.show({ message: 'Processing', pending: true, durationMs: 35_000 });

      vi.advanceTimersByTime(2000);
      anchor.remove();
      vi.advanceTimersByTime(500);

      expect(placement('Processing')).toMatchObject({ left: '', top: '' });
      owner.clear();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  it('clear() closes only its owner’s toasts and keeps the toaster usable; destroy() is final', () => {
    const owner = toaster();
    const other = toaster();
    owner.show({ message: 'mine', durationMs: 5000 });
    other.show({ message: 'theirs', durationMs: null });

    owner.clear();
    expect(toastDriver.messages()).toEqual(['theirs']);
    owner.show({ message: 'again', durationMs: 5000 });
    expect(toastDriver.messages()).toEqual(['theirs', 'again']);

    owner.destroy();
    expect(owner.show({ message: 'after', durationMs: 5000 }).isOpen).toBe(false);
    expect(toastDriver.messages()).toEqual(['theirs']);
    other.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a second script instance never removes the first instance’s open toasts', async () => {
    // After an extension update, the orphaned script runs beside the re-injected one.
    vi.resetModules();
    const orphan = (await import('../toaster')).createToaster();
    vi.resetModules();
    const live = (await import('../toaster')).createToaster();
    toasters.push(orphan, live);

    const sticky = live.show({ message: 'Announcement', durationMs: null });
    orphan.show({ message: 'Copied', durationMs: 2000 });

    expect(toastDriver.messages()).toEqual(['Announcement', 'Copied']);
    vi.advanceTimersByTime(2000);
    expect(sticky.isOpen).toBe(true);
    expect(toastDriver.messages()).toEqual(['Announcement']);
  });

  it('counts a press on a toast as a Voyager layer event', () => {
    const seen: boolean[] = [];
    const record = (event: Event) => seen.push(isVoyagerLayerEvent(event));
    document.addEventListener('pointerdown', record, true);
    toaster().show({ message: 'hello', durationMs: null });

    toastDriver
      .find('hello')!
      .element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));

    expect(seen).toEqual([true, false]);
    document.removeEventListener('pointerdown', record, true);
  });
});
