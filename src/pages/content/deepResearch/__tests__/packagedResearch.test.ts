import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PluginScope } from '@/features/plugins/runtime/pluginScope';
import { setCachedLanguage } from '@/utils/i18n';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { extractThinkingPanels } from '../extractor';
import { injectDownloadButton } from '../menuButton';
import { extractDeepResearchReportTitle, findDeepResearchReportRoot } from '../reportExtractor';

const cleanups: Array<() => void> = [];
const scopes: PluginScope[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-26T12:00:00Z'));
  document.title = 'Research conversation';
  setCachedLanguage('en');
});
afterEach(async () => {
  cleanups
    .splice(0)
    .reverse()
    .forEach((stop) => stop());
  await Promise.all(scopes.splice(0).map((scope) => scope.dispose()));
  vi.useRealTimers();
  document.body.replaceChildren();
});

function thought(label: string): string {
  return `<thought-item><div class="thought-header">${label}</div><div class="gds-body-m gds-italic">Reason ${label}</div></thought-item>`;
}
function browse(label: string): string {
  return `<browse-chip-list><browse-web-chip><a data-test-id="browse-chip-link" href="https://example.org/${label}?q=source#section"><span data-test-id="domain-name">${label}.org</span><span data-test-id="title">Source ${label}</span></a></browse-web-chip></browse-chip-list>`;
}
function row(label: string, className = 'item-container'): string {
  // DOM browse order must not reverse the extractor's established thought-before-browse order.
  return `<div class="${className}"><div>${browse(label)}</div><div>${thought(label)}</div></div>`;
}
function report(id: string, className = 'markdown'): string {
  return `<div id="${id}" class="${className}"><h1>${id} report</h1><p>${id.repeat(12)}</p><a href="https://example.org/${id}">Source ${id}</a></div>`;
}
function menu(): HTMLElement {
  const element = document.createElement('div');
  element.className = 'mat-mdc-menu-panel';
  element.setAttribute('role', 'menu');
  element.innerHTML = `<div class="mat-mdc-menu-content"><button data-test-id="share-drive-button" role="menuitem">Share</button><button data-test-id="export-to-docs-button" role="menuitem">Export</button></div>`;
  document.body.append(element);
  return element;
}

describe('Deep Research packaged reads', () => {
  it('keeps thinking order, longest report, source URLs and menu position on the same DOM', async () => {
    document.body.innerHTML = `<deep-research-immersive-panel>
      <header>Report toolbar title</header>
      <thinking-panel>${row('first')}${row('second')}<div class="markdown">${'thinking'.repeat(40)}</div></thinking-panel>
      ${report('short')}${report('longest-first-report')}
      </deep-research-immersive-panel>
      <deep-research-immersive-panel><thinking-panel>${row('foreign')}</thinking-panel>${report('much-longer-but-foreign-report')}</deep-research-immersive-panel>
      <model-response>${report('ordinary-answer-longest-of-all-reports')}</model-response>`;
    const originalThinking = extractThinkingPanels();
    const originalReport = findDeepResearchReportRoot()!;
    const originalSources = Array.from(originalReport.querySelectorAll('a')).map((a) => a.href);
    const firstMenu = menu();
    const firstScope = new PluginScope();
    scopes.push(firstScope);
    const entries = injectDownloadButton(firstScope, firstMenu);
    const originalPosition = Array.from(
      firstMenu.querySelector('.mat-mdc-menu-content')!.children,
    ).map((el) => el.outerHTML);
    entries.forEach(({ button }) => button.remove());
    cleanups.push(
      await installGeminiSelectorPatch({
        'code.host': ['code-block-v2'],
      }),
    );
    expect(extractThinkingPanels()).toEqual(originalThinking);
    expect(originalThinking?.sections[0].items.map((item) => item.type)).toEqual([
      'thought',
      'browse-chips',
      'thought',
      'browse-chips',
    ]);
    expect(originalThinking?.sections[0].items[1]).toEqual({
      type: 'browse-chips',
      chips: [
        {
          url: 'https://example.org/first?q=source#section',
          domain: 'first.org',
          title: 'Source first',
        },
      ],
    });
    expect(findDeepResearchReportRoot()).toBe(originalReport);
    expect(originalReport.id).toBe('longest-first-report');
    expect(extractDeepResearchReportTitle(originalReport)).toBe('longest-first-report report');
    expect(Array.from(originalReport.querySelectorAll('a')).map((a) => a.href)).toEqual(
      originalSources,
    );
    injectDownloadButton(firstScope, firstMenu);
    expect(
      Array.from(firstMenu.querySelector('.mat-mdc-menu-content')!.children).map(
        (el) => el.outerHTML,
      ),
    ).toEqual(originalPosition);
  });

  it('bundled reads keep one query per collection without online evidence probes', () => {
    document.body.innerHTML = `<deep-research-immersive-panel><thinking-panel>${row('bundled')}</thinking-panel>${report('report')}</deep-research-immersive-panel>`;
    const panel = document.querySelector('deep-research-immersive-panel')!;
    const thinking = document.querySelector('thinking-panel')!;
    const reportQueries = vi.spyOn(panel, 'querySelectorAll');
    const itemQueries = vi.spyOn(thinking, 'querySelectorAll');
    expect(findDeepResearchReportRoot()?.id).toBe('report');
    expect(reportQueries).toHaveBeenCalledTimes(1);
    expect(extractThinkingPanels()?.sections[0].items[0]).toEqual({
      type: 'thought',
      header: 'bundled',
      content: 'Reason bundled',
    });
    expect(itemQueries).toHaveBeenCalledTimes(1);
    reportQueries.mockRestore();
    itemQueries.mockRestore();
  });
});
