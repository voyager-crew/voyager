import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installGeminiSelectorPatch } from '@/pages/content/__tests__/geminiOnlineSelectorFixture';

import { resolveGeminiUsageRoot } from '../usageDom';
import { scrapeUsageFromDocument } from '../usageParsing';

const now = new Date(2026, 6, 18, 10).getTime();
let stop = () => {};
let initialPath: string;

function content(language = 'en', percent = 12): string {
  const chinese = language === 'zh-CN';
  return `<div class="usage-metrics-header">${chinese ? '用量限制' : 'Usage limits'} <span>PRO</span></div>
    <div class="gxu-items-container">
      <div class="gxu-currently">
        <p>${chinese ? '当前用量' : 'Current usage'}</p><p>${percent}%</p>
        <p class="reset-time-luminous">${chinese ? '重置时间：下午2:47' : 'Resets at 2:47 PM'}</p>
      </div>
      <div class="gxu-weekly">
        <p>${chinese ? '每周限额' : 'Weekly limit'}</p><p>35%</p>
        <p class="reset-time-luminous">${chinese ? '重置时间：7月21日22:47' : 'Resets Jul 21 at 10:47 PM'}</p>
      </div>
    </div>`;
}

beforeEach(() => {
  initialPath = location.pathname;
  history.replaceState(null, '', '/u/0/usage');
});

afterEach(() => {
  stop();
  vi.restoreAllMocks();
  document.body.replaceChildren();
  document.documentElement.lang = 'en';
  history.replaceState(null, '', initialPath);
});

describe('usage online roots', () => {
  it.each(['en', 'zh-CN'])('keeps percentages, reset times and tier in %s', async (language) => {
    document.documentElement.lang = language;
    document.body.innerHTML = `<usage-metrics-window id="usage">${content(language)}</usage-metrics-window>`;
    const bundled = scrapeUsageFromDocument(document, now);
    stop = await installGeminiSelectorPatch({ 'usage.root': ['#usage'] });
    const online = scrapeUsageFromDocument(document, now);
    expect(online).toEqual(bundled);
    expect(online).toMatchObject({
      daily: { percent: 12, resetEpoch: new Date(2026, 6, 18, 14, 47).getTime() / 1000 },
      weekly: { percent: 35, resetEpoch: new Date(2026, 6, 21, 22, 47).getTime() / 1000 },
      tier: 'PRO',
      updatedAt: now,
    });
  });

  it('repairs a renamed usage wrapper for both collection and observation', async () => {
    document.body.innerHTML = `<section id="usage">${content()}</section>`;
    const root = document.querySelector('#usage');
    expect(scrapeUsageFromDocument(document, now)).toBeNull();
    stop = await installGeminiSelectorPatch({ 'usage.root': ['#usage'] });
    expect(scrapeUsageFromDocument(document, now)).toMatchObject({
      daily: { percent: 12, resetLabel: '2:47 PM' },
      weekly: { percent: 35, resetLabel: 'Jul 21 at 10:47 PM' },
      tier: 'PRO',
    });
    expect(resolveGeminiUsageRoot(document, 'observe')).toBe(root);
  });

  it('keeps the full bundled usage when an online root selects only the daily bucket', async () => {
    document.body.innerHTML = `<usage-metrics-window>${content()}</usage-metrics-window>`;
    const bundled = scrapeUsageFromDocument(document, now);
    stop = await installGeminiSelectorPatch({ 'usage.root': ['.gxu-items-container'] });
    expect(scrapeUsageFromDocument(document, now)).toEqual(bundled);
    expect(scrapeUsageFromDocument(document, now)?.tier).toBe('PRO');
    expect(resolveGeminiUsageRoot(document, 'observe')?.tagName).toBe('USAGE-METRICS-WINDOW');
  });

  it('keeps the actual usage when a different panel has believable percentages', async () => {
    document.body.innerHTML = `<section id="other">${content('en', 99)}</section>
      <usage-metrics-window>${content()}</usage-metrics-window>`;
    const bundled = scrapeUsageFromDocument(document, now);
    stop = await installGeminiSelectorPatch({ 'usage.root': ['#other'] });
    expect(scrapeUsageFromDocument(document, now)).toEqual(bundled);
    expect(scrapeUsageFromDocument(document, now)?.daily?.percent).toBe(12);
  });

  it('does not combine buckets from separate usage panels into the cache candidate', async () => {
    document.body.innerHTML = `<section id="usage">${content()}<div class="gxu-currently">99%</div></section>`;
    stop = await installGeminiSelectorPatch({ 'usage.root': ['#usage'] });
    expect(scrapeUsageFromDocument(document, now)).toBeNull();
    document.querySelector('#usage > .gxu-currently')?.remove();
    expect(scrapeUsageFromDocument(document, now)?.daily?.percent).toBe(12);
  });

  it('requires all buckets to belong to the usage header region', async () => {
    document.body.innerHTML = `<section id="usage">
      <div class="usage-metrics-header">PRO</div>
      <div class="gxu-currently">99%</div></section><div class="gxu-weekly">35%</div>`;
    stop = await installGeminiSelectorPatch({ 'usage.root': ['#usage'] });
    expect(scrapeUsageFromDocument(document, now)).toBeNull();
    document.querySelector('body > .gxu-weekly')!.remove();
    document.querySelector('#usage')!.innerHTML = content();
    expect(scrapeUsageFromDocument(document, now)?.weekly?.percent).toBe(35);
  });

  it('does not accept the whole page as a repaired usage panel', async () => {
    document.body.innerHTML = content();
    stop = await installGeminiSelectorPatch({ 'usage.root': ['body', '#usage'] });
    expect(scrapeUsageFromDocument(document, now)).toBeNull();
    stop();
    document.body.innerHTML = `<section id="usage">${content()}</section>`;
    stop = await installGeminiSelectorPatch({ 'usage.root': ['#usage'] });
    expect(scrapeUsageFromDocument(document, now)?.daily?.percent).toBe(12);
  });

  it('does not scrape a usage-looking conversation as the native repair witness', async () => {
    document.body.innerHTML = `<model-response><section id="usage">${content('en', 99)}</section></model-response>`;
    stop = await installGeminiSelectorPatch({ 'usage.root': ['#usage'] });
    expect(scrapeUsageFromDocument(document, now)).toBeNull();
    const root = document.querySelector('#usage')!;
    document.body.replaceChildren(root);
    expect(scrapeUsageFromDocument(document, now)?.daily?.percent).toBe(99);
  });

  it('does not adopt a renamed usage root after navigating to a conversation', async () => {
    document.body.innerHTML = `<section id="usage">${content()}</section>`;
    stop = await installGeminiSelectorPatch({ 'usage.root': ['#usage'] });
    expect(scrapeUsageFromDocument(document, now)?.daily?.percent).toBe(12);
    history.replaceState(null, '', '/u/0/app/conversation');
    expect(scrapeUsageFromDocument(document, now)).toBeNull();
    history.replaceState(null, '', '/u/0/usage');
    document.body.innerHTML = `<section id="usage">${content()}</section>`;
    expect(scrapeUsageFromDocument(document, now)?.weekly?.percent).toBe(35);
  });

  it('uses the bundled read when an online query throws after hydration', async () => {
    document.body.innerHTML = `<usage-metrics-window id="usage">${content()}</usage-metrics-window>`;
    const bundled = scrapeUsageFromDocument(document, now);
    stop = await installGeminiSelectorPatch({ 'usage.root': ['#usage'] });
    const query = document.querySelector.bind(document);
    vi.spyOn(document, 'querySelector').mockImplementation((selector) => {
      if (selector === '#usage') throw new DOMException('query unavailable');
      return query(selector);
    });
    expect(scrapeUsageFromDocument(document, now)).toEqual(bundled);
    expect(scrapeUsageFromDocument(document, now)?.daily?.percent).toBe(12);
  });

  it('keeps bundled usage unchanged with online fixes off or an unrelated panel present', async () => {
    document.body.innerHTML = `<usage-metrics-window>${content()}</usage-metrics-window>
      <section id="other">${content('en', 99)}</section>`;
    const off = scrapeUsageFromDocument(document, now);
    const observedOff = resolveGeminiUsageRoot(document, 'observe');
    expect(off).toMatchObject({ daily: { percent: 12 }, weekly: { percent: 35 }, tier: 'PRO' });
    expect(observedOff?.tagName).toBe('USAGE-METRICS-WINDOW');

    stop = await installGeminiSelectorPatch({ 'usage.root': ['#other'] });
    expect(scrapeUsageFromDocument(document, now)).toEqual(off);
    expect(resolveGeminiUsageRoot(document, 'observe')).toBe(observedOff);
  });
});
