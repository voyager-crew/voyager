import { afterEach, describe, expect, it, vi } from 'vitest';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { scrapeGemsFromDocument } from '../catalog';
import { gemsSectionMayBeDisturbed } from '../section';

let stopPatch: (() => void) | undefined;
afterEach(() => {
  stopPatch?.();
  stopPatch = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('Gems independent navigation and catalog reads', () => {
  it('keeps repaired catalog names when the nav entry patch has invalid syntax', async () => {
    document.body.innerHTML = `<section class="repaired-list"><bot-list-row>
      <a href="/gem/writer"><span class="title-container">Writer</span></a>
    </bot-list-row></section>`;
    stopPatch = await installGeminiSelectorPatch({
      'gems.list': ['.repaired-list'],
      'gems.navEntry': ['['],
    });
    expect(scrapeGemsFromDocument()).toEqual([
      { id: 'writer', href: '/gem/writer', name: 'Writer' },
    ]);
  });

  it('does not double sidebar subtree probes for streaming rows with online fixes off', () => {
    const nav = document.createElement('nav');
    const section = document.createElement('section');
    document.body.append(nav, section);
    const row = document.createElement('div');
    const query = vi.spyOn(row, 'querySelector');
    const observer = new MutationObserver(() => {});
    observer.observe(document.body, { childList: true });
    document.body.append(row);
    expect(gemsSectionMayBeDisturbed(observer.takeRecords(), { nav, section })).toBe(false);
    expect(query).toHaveBeenCalledTimes(1);

    row.innerHTML = '<a data-test-id="gems-side-nav-entry-button" href="/gems/view">Gems</a>';
    row.remove();
    observer.takeRecords();
    document.body.append(row);
    expect(gemsSectionMayBeDisturbed(observer.takeRecords(), { nav, section })).toBe(true);
    observer.disconnect();
  });
});
