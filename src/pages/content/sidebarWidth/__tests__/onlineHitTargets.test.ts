import { afterEach, describe, expect, it, vi } from 'vitest';

import { PluginScope } from '@/features/plugins/runtime/pluginScope';
import { installGeminiSelectorPatch } from '@/pages/content/__tests__/geminiOnlineSelectorFixture';

import { getSidebarWidthButtons, getSidebarWidthActionButtons } from '../buttonTargets';
import { installSidebarWidthHitGuards } from '../hitGuards';

let stop = () => {};
let scope = new PluginScope();
afterEach(async () => {
  stop();
  await scope.dispose();
  scope = new PluginScope();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function fixture(markup: string): void {
  document.body.innerHTML = `<bard-sidenav>${markup}</bard-sidenav><div id="blocker"></div>`;
  for (const button of document.querySelectorAll('button')) {
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
      x: 100,
      y: 100,
      left: 100,
      top: 100,
      right: 132,
      bottom: 132,
      width: 32,
      height: 32,
      toJSON: () => ({}),
    });
  }
}

function hit(): void {
  document.getElementById('blocker')!.dispatchEvent(
    new MouseEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      clientX: 116,
      clientY: 116,
      button: 0,
    }),
  );
}

describe('online sidebar width hit targets', () => {
  it('clicks the same single toggle through bundled and online reads and stops on disposal', async () => {
    fixture('<button id="toggle" aria-label="Close sidebar"></button>');
    const button = document.querySelector('button')!;
    const click = vi.fn();
    button.addEventListener('click', click);
    const bundled = getSidebarWidthButtons();
    installSidebarWidthHitGuards(scope);
    hit();
    stop = await installGeminiSelectorPatch({ 'sidebarWidth.buttons': ['#toggle'] });
    expect(getSidebarWidthButtons()).toEqual(bundled);
    hit();
    expect(click).toHaveBeenCalledTimes(2);
    await scope.dispose();
    hit();
    expect(click).toHaveBeenCalledTimes(2);
  });

  it('repairs a changed icon element without clicking the invisible sibling', async () => {
    fixture(
      '<button id="hidden"><span fonticon="side_nav"></span></button><button id="toggle"><span fonticon="side_nav"></span></button>',
    );
    const hidden = document.getElementById('hidden')!;
    vi.mocked(hidden.getBoundingClientRect).mockReturnValue(new DOMRect());
    const toggle = document.getElementById('toggle')!;
    const clicked: string[] = [];
    hidden.addEventListener('click', () => clicked.push('hidden'));
    toggle.addEventListener('click', () => clicked.push('toggle'));
    installSidebarWidthHitGuards(scope);
    hit();
    stop = await installGeminiSelectorPatch({ 'sidebarWidth.buttons': ['bard-sidenav button'] });
    expect(getSidebarWidthButtons()).toEqual([toggle]);
    hit();
    expect(clicked).toEqual(['toggle']);
  });

  it('falls back to the real toggle when a patch points at New chat', async () => {
    fixture(
      '<button id="wrong">New chat</button><button id="toggle" aria-label="Close sidebar"></button>',
    );
    stop = await installGeminiSelectorPatch({ 'sidebarWidth.buttons': ['#wrong'] });
    const clicked: string[] = [];
    for (const button of document.querySelectorAll('button'))
      button.addEventListener('click', () => clicked.push(button.id));
    installSidebarWidthHitGuards(scope);
    hit();
    expect(clicked).toEqual(['toggle']);
  });

  it('keeps both bundled controls when a patch only finds the second', async () => {
    fixture(
      '<button id="first" aria-label="Close sidebar"></button><button id="second" aria-label="Open sidebar"></button>',
    );
    stop = await installGeminiSelectorPatch({ 'sidebarWidth.buttons': ['#second'] });
    expect(getSidebarWidthButtons().map((button) => button.id)).toEqual(['second']);
    expect(getSidebarWidthActionButtons().map((button) => button.id)).toEqual(['first', 'second']);
  });

  it('waits for an unambiguous replacement when two native toggles overlap', async () => {
    fixture(
      '<button id="one"><span fonticon="side_nav"></span></button><button id="two"><span fonticon="side_nav"></span></button>',
    );
    stop = await installGeminiSelectorPatch({ 'sidebarWidth.buttons': ['bard-sidenav button'] });
    expect(getSidebarWidthActionButtons()).toEqual([]);
    document.getElementById('two')!.remove();
    expect(getSidebarWidthActionButtons()).toEqual([document.getElementById('one')]);
  });

  it.each([
    '<button id="candidate"><span fonticon="edit"></span>New chat</button>',
    '<div role="menu"><button id="candidate"><span fonticon="side_nav"></span></button></div>',
    '<button id="candidate" disabled><span fonticon="side_nav"></span></button>',
    '<button id="candidate"><span fonticon="side_nav"></span></button><button><span fonticon="side_nav"></span></button>',
  ])(
    'rejects an unproven replacement and still handles the next proven control: %s',
    async (markup) => {
      fixture(markup);
      stop = await installGeminiSelectorPatch({ 'sidebarWidth.buttons': ['#candidate'] });
      installSidebarWidthHitGuards(scope);
      expect(getSidebarWidthActionButtons()).toEqual([]);
      const clicked: string[] = [];
      document.getElementById('candidate')!.addEventListener('click', () => clicked.push('wrong'));
      hit();
      // Positive recovery proves rejection did not disable the handler.
      document.querySelector('bard-sidenav')!.innerHTML =
        '<button id="good" aria-label="Close sidebar"></button>';
      const good = document.getElementById('good')!;
      vi.spyOn(good, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 32, 32));
      good.addEventListener('click', () => clicked.push('good'));
      hit();
      expect(clicked).toEqual(['good']);
    },
  );
});
