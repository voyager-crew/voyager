import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mountPersistentExportToolbar } from '../persistentExportToolbar';
import { cleanUpToolbars, mockRect, nextFrame } from './persistentExportToolbarHarness';

afterEach(cleanUpToolbars);

describe('persistentExportToolbar', () => {
  describe('bounded avoidance work', () => {
    async function settle(frames = 1): Promise<void> {
      for (let i = 0; i < frames; i++) {
        await Promise.resolve();
        await nextFrame();
      }
    }

    function mountTopBar(left: number): {
      topBar: HTMLElement;
      rectReads: () => number;
      setLeft: (next: number) => void;
    } {
      let reads = 0;
      let currentLeft = left;
      const topBar = document.createElement('top-bar-actions');
      Object.defineProperty(topBar, 'getBoundingClientRect', {
        configurable: true,
        value: () => {
          reads += 1;
          const hidden = topBar.hasAttribute('hidden');
          return {
            top: 0,
            bottom: hidden ? 0 : 56,
            left: currentLeft,
            right: 1260,
            width: hidden ? 0 : 1260 - currentLeft,
            height: hidden ? 0 : 56,
          } as DOMRect;
        },
      });
      document.body.appendChild(topBar);
      return {
        topBar,
        rectReads: () => reads,
        setLeft: (next) => {
          currentLeft = next;
        },
      };
    }

    it('does not query or measure while unrelated content streams into the page', async () => {
      vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280);
      const { rectReads } = mountTopBar(920);
      const handle = mountPersistentExportToolbar({
        label: 'Export',
        tooltip: 'Export chat history',
        onClick: vi.fn(),
      });
      await settle();
      expect(handle.root.style.getPropertyValue('--gv-persistent-export-right')).toBe('372px');

      const querySpy = vi.spyOn(document, 'querySelectorAll');
      const readsBefore = rectReads();
      const chat = document.createElement('div');
      document.body.appendChild(chat);
      for (let i = 0; i < 40; i++) {
        const turn = document.createElement('div');
        turn.className = 'conversation-turn';
        turn.textContent = `Streamed chunk ${i}`;
        chat.appendChild(turn);
        turn.classList.add('settled');
        await settle();
      }

      expect(querySpy).not.toHaveBeenCalled();
      expect(rectReads()).toBe(readsBefore);
      chat.remove();
    });

    it('settles after one measurement instead of re-triggering itself', async () => {
      vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280);
      const handle = mountPersistentExportToolbar({
        label: 'Export',
        tooltip: 'Export chat history',
        onClick: vi.fn(),
      });
      await settle();
      const querySpy = vi.spyOn(document, 'querySelectorAll');
      const setProperty = vi.spyOn(handle.root.style, 'setProperty');

      mountTopBar(920);
      await settle(6);

      expect(handle.root.style.getPropertyValue('--gv-persistent-export-right')).toBe('372px');
      expect(querySpy).toHaveBeenCalledTimes(1);
      expect(setProperty).toHaveBeenCalledTimes(1);
    });

    it('follows controls pushed left inside a full-width top-bar host', async () => {
      vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280);
      const host = document.createElement('top-bar-actions');
      mockRect(host, { top: 0, bottom: 56, left: 0, right: 1280, width: 1280, height: 56 });
      let upgradeLeft = 960;
      const upgrade = document.createElement('button');
      upgrade.setAttribute('data-test-id', 'upgrade-button');
      Object.defineProperty(upgrade, 'getBoundingClientRect', {
        configurable: true,
        value: () =>
          ({
            top: 8,
            bottom: 44,
            left: upgradeLeft,
            right: upgradeLeft + 170,
            width: 170,
            height: 36,
          }) as DOMRect,
      });
      host.appendChild(upgrade);
      document.body.appendChild(host);
      const handle = mountPersistentExportToolbar({
        label: 'Export',
        tooltip: 'Export chat history',
        onClick: vi.fn(),
      });
      await settle();
      expect(handle.root.style.getPropertyValue('--gv-persistent-export-right')).toBe('332px');

      upgradeLeft = 900;
      host.appendChild(document.createElement('button'));
      await settle();

      expect(handle.root.style.getPropertyValue('--gv-persistent-export-right')).toBe('392px');
    });

    it('follows a top-right control that grows or hides', async () => {
      vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280);
      const { topBar, setLeft } = mountTopBar(920);
      const handle = mountPersistentExportToolbar({
        label: 'Export',
        tooltip: 'Export chat history',
        onClick: vi.fn(),
      });
      await settle();
      expect(handle.root.style.getPropertyValue('--gv-persistent-export-right')).toBe('372px');

      setLeft(820);
      topBar.appendChild(document.createElement('button'));
      await settle();
      expect(handle.root.style.getPropertyValue('--gv-persistent-export-right')).toBe('472px');

      topBar.setAttribute('hidden', '');
      await settle();
      expect(handle.root.style.getPropertyValue('--gv-persistent-export-right')).toBe('84px');
    });

    describe('a control hidden by an ancestor', () => {
      let header: HTMLElement;
      let rectReads = 0;

      beforeEach(() => {
        vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280);
        rectReads = 0;
        header = document.createElement('header');
        header.className = 'page-header collapsed';
        const actions = document.createElement('div');
        actions.id = 'conversation-header-actions';
        // Visible only while no ancestor hides it, as `display: none` would.
        Object.defineProperty(actions, 'getBoundingClientRect', {
          configurable: true,
          value: () => {
            rectReads += 1;
            const shown = !header.hasAttribute('hidden') && !header.classList.contains('collapsed');
            return {
              top: shown ? 8 : 0,
              bottom: shown ? 44 : 0,
              left: shown ? 1000 : 0,
              right: shown ? 1240 : 0,
              width: shown ? 240 : 0,
              height: shown ? 36 : 0,
            } as DOMRect;
          },
        });
        header.appendChild(actions);
        document.body.appendChild(header);
      });

      afterEach(() => {
        header.remove();
      });

      async function mountToolbar(): Promise<HTMLDivElement> {
        const handle = mountPersistentExportToolbar({
          label: 'Export',
          tooltip: 'Export chat history',
          onClick: vi.fn(),
        });
        handle.root.dataset.gvPlatform = 'chatgpt';
        await settle();
        return handle.root;
      }

      it('moves aside when an ancestor class change reveals it, and back when it hides', async () => {
        const root = await mountToolbar();
        expect(root.style.getPropertyValue('--gv-persistent-export-right')).toBe('84px');

        header.classList.remove('collapsed');
        await settle();
        expect(root.style.getPropertyValue('--gv-persistent-export-right')).toBe('292px');

        header.setAttribute('hidden', '');
        await settle();
        expect(root.style.getPropertyValue('--gv-persistent-export-right')).toBe('84px');

        header.removeAttribute('hidden');
        await settle();
        expect(root.style.getPropertyValue('--gv-persistent-export-right')).toBe('292px');
      });

      it('does not measure for attribute churn outside its ancestry', async () => {
        await mountToolbar();
        const chat = document.createElement('div');
        document.body.appendChild(chat);
        const readsBefore = rectReads;

        for (let i = 0; i < 20; i++) {
          chat.classList.toggle('streaming');
          chat.setAttribute('style', `min-height: ${i}px`);
          await settle();
        }

        expect(rectReads).toBe(readsBefore);
        chat.remove();
      });

      it('does not measure when turns with hidden per-message buttons change class', async () => {
        const chat = document.createElement('div');
        const turn = document.createElement('div');
        turn.className = 'conversation-turn';
        const copyPrompt = document.createElement('button');
        // Matches the substring selector `[aria-label*="pro" i]`; zero-size until hovered.
        copyPrompt.setAttribute('aria-label', 'Copy prompt');
        mockRect(copyPrompt, { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 });
        turn.appendChild(copyPrompt);
        chat.appendChild(turn);
        document.body.appendChild(chat);
        await mountToolbar();
        const querySpy = vi.spyOn(document, 'querySelectorAll');
        const readsBefore = rectReads;

        for (let i = 0; i < 20; i++) {
          turn.classList.toggle('hovered');
          chat.setAttribute('style', `min-height: ${i}px`);
          await settle();
        }

        expect(querySpy).not.toHaveBeenCalled();
        expect(rectReads).toBe(readsBefore);
        chat.remove();
      });
    });
  });
});
