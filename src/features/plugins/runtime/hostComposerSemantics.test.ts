// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/" }
import { afterEach, expect, it, vi } from 'vitest';

import { initializeSiteSelectors, type SiteSelectorLifetime } from '@/core/selectors';
import { withGuardedPageAdapter } from '@/core/selectors/semanticSnapshot';
import { requireBundledSiteAdapter } from '@/features/plugins/catalog/sites';

import { semanticRef, type PluginManifest, type SiteAdapter, cssRef } from '../types';
import { DeclarativeEngine } from './declarativeEngine';
import { createHostEngine } from './hostEngine';
import { ReleaseLedger } from './releaseLedger';

let lifetime: SiteSelectorLifetime | undefined;
const engines: ReturnType<typeof createHostEngine>[] = [];

afterEach(() => {
  engines.splice(0).forEach((engine) => engine.unmount('test.composer-targets'));
  lifetime?.stop();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

async function online(selectors: Record<string, string>): Promise<void> {
  lifetime?.stop();
  lifetime = initializeSiteSelectors('chatgpt', {
    host: 'chatgpt.com',
    doc: document,
    lifetime: new AbortController().signal,
    bundledRevision: 1,
    read: async () => ({ id: 'chatgpt', catalogRevision: 2, selectors }),
  });
  await lifetime.ready;
}

const manifest: PluginManifest = {
  id: 'test.composer-targets',
  name: 'Composer targets',
  version: '1.0.0',
  description: 'Test',
  author: 'test',
  category: 'other',
  license: 'MIT',
  engine: '>=1.0.0',
  tier: 'declarative',
  matches: ['https://chatgpt.com/*'],
  contributes: {
    domOps: [
      { op: 'addClass', target: semanticRef('composer'), className: 'gv-test-input' },
      { op: 'addClass', target: semanticRef('sendButton'), className: 'gv-test-send' },
    ],
  },
};
function mount(
  adapter: SiteAdapter = requireBundledSiteAdapter('chatgpt'),
  contribution = manifest,
): void {
  const engine = createHostEngine({
    doc: document,
    adapter,
    inspectPlugins: () => ({ statuses: [], manifests: [] }),
    releases: new ReleaseLedger(),
  });
  engines.push(engine);
  engine.mount(contribution);
}
function page(native = true): void {
  document.body.innerHTML = `<form data-chatgpt-composer><textarea ${native ? 'id="prompt-textarea"' : ''} class="input">Original draft</textarea><button type="submit" class="send">Send</button></form>`;
}

it('the host applies bundled and remote semantic operations to the same composer and send control', async () => {
  page();
  mount();
  const field = document.querySelector('.gv-test-input'),
    send = document.querySelector('.gv-test-send');
  engines[0].unmount(manifest.id);
  await online({ composer: '.input', sendButton: '.send' });
  mount();
  expect(document.querySelector('.gv-test-input')).toBe(field);
  expect(document.querySelector('.gv-test-send')).toBe(send);
});

it('the host repairs a renamed editor and send control under the native composer owner', async () => {
  page(false);
  await online({ composer: '.input', sendButton: '.send' });
  mount();
  expect(document.querySelector('.gv-test-input')?.textContent).toBe('Original draft');
  expect(document.querySelector('.gv-test-send')?.textContent).toBe('Send');
});

it('a broad remote semantic cannot apply composer styles to another form or its submit button', async () => {
  page();
  document.body.insertAdjacentHTML(
    'beforeend',
    '<form><textarea class="input">Private profile</textarea><button type="submit" class="send">Save profile</button></form>',
  );
  await online({ composer: '.input', sendButton: '.send' });
  mount();
  expect(
    Array.from(document.querySelectorAll('.gv-test-input')).map((node) => node.textContent),
  ).toEqual(['Original draft']);
  expect(
    Array.from(document.querySelectorAll('.gv-test-send')).map((node) => node.textContent),
  ).toEqual(['Send']);
});

it('a remote send union cannot also target an unrelated page action', async () => {
  page();
  document.body.insertAdjacentHTML('beforeend', '<button class="decoy">Delete account</button>');
  await online({ composer: '.input', sendButton: '.send, .decoy' });
  mount();
  expect(
    Array.from(document.querySelectorAll('.gv-test-send')).map((node) => node.textContent),
  ).toEqual(['Send']);
  expect(document.querySelector('.gv-test-input')).toBe(document.querySelector('.input'));
});

it('a profile editor without a native composer owner retains its text and receives no chat behaviour', async () => {
  document.body.innerHTML =
    '<form><textarea class="input">Private profile</textarea><button type="submit" class="send">Save profile</button></form>';
  await online({ composer: '.input', sendButton: '.send' });
  mount();
  expect(document.querySelector('textarea')?.outerHTML).toBe(
    '<textarea class="input">Private profile</textarea>',
  );
  expect(document.querySelector('button')?.outerHTML).toBe(
    '<button type="submit" class="send">Save profile</button>',
  );
});

it('an inline message editor cannot receive main-composer runtime operations', async () => {
  document.body.innerHTML =
    '<form data-chatgpt-composer data-turn-key="one"><textarea class="input">Edited prompt</textarea><button type="submit" class="send">Send</button></form>';
  await online({ composer: '.input', sendButton: '.send' });
  mount();
  expect(document.querySelector('textarea')?.outerHTML).toBe(
    '<textarea class="input">Edited prompt</textarea>',
  );
  expect(document.querySelector('button')?.outerHTML).toBe(
    '<button type="submit" class="send">Send</button>',
  );
});

it('a second native editor cannot be hidden by a narrow remote composer profile', async () => {
  page(false);
  document
    .querySelector('form')!
    .insertAdjacentHTML('beforeend', '<textarea>Other draft</textarea>');
  await online({ composer: '.input', sendButton: '.send' });
  mount();
  expect(document.querySelectorAll('.gv-test-input')).toHaveLength(0);
  expect(Array.from(document.querySelectorAll('textarea')).map((node) => node.value)).toEqual([
    'Original draft',
    'Other draft',
  ]);
});

it('reading bundled semantic values does not inspect the page', () => {
  page();
  const query = vi.spyOn(document, 'querySelectorAll');
  const native = requireBundledSiteAdapter('chatgpt');
  const adapter = withGuardedPageAdapter(native, document)!;
  expect(adapter.selectors.composer).toBe(native.selectors.composer);
  expect(adapter.selectors.sendButton).toBe(native.selectors.sendButton);
  expect(query).not.toHaveBeenCalled();
});

it('native decorations remain usable until their last runtime owner releases them', async () => {
  page(false);
  await online({ composer: '.input', sendButton: '.send' });
  mount();
  const field = document.querySelector('.input')!,
    send = document.querySelector('.send')!;
  expect(field.classList.contains('gv-test-input')).toBe(true);
  expect(send.classList.contains('gv-test-send')).toBe(true);
  engines[0].unmount(manifest.id);
  expect(field.className).toBe('input');
  expect(send.className).toBe('send');
  field.classList.add('gv-test-input');
  mount();
  expect(send.className).toBe('send');
});

it('decorating Voyager-created UI does not grant it native composer ownership', async () => {
  page(false);
  document.querySelector('form')!.classList.add('gv-dialog');
  mount(requireBundledSiteAdapter('chatgpt'), {
    ...manifest,
    contributes: {
      domOps: [{ op: 'addClass', target: cssRef('.input'), className: 'gv-ui-decoration' }],
    },
  });
  document.querySelector('form')!.classList.remove('gv-dialog');
  await online({ composer: '.input', sendButton: '.send' });
  mount();
  expect(document.querySelector('textarea')?.className).toBe('input gv-ui-decoration');
  expect(document.querySelector('.send')?.className).toBe('send');
});

it('a Voyager component marker cannot be used as a repaired native composer', async () => {
  page(false);
  document.querySelector('form')!.setAttribute('data-gv-component', 'preview');
  await online({ composer: '.input', sendButton: '.send' });
  mount();
  expect(document.querySelector('textarea')?.className).toBe('input');
  expect(document.querySelector('.send')?.className).toBe('send');
});

it('ON without changed profiles cannot redirect semantic operations through the cached adapter', async () => {
  await online({});
  page();
  document.body.insertAdjacentHTML(
    'beforeend',
    '<textarea class="private">Private draft</textarea>',
  );
  const native = requireBundledSiteAdapter('chatgpt');
  mount(
    { ...native, selectors: { ...native.selectors, composer: '.private' } },
    {
      ...manifest,
      contributes: {
        domOps: [
          { op: 'addClass', target: semanticRef('composer'), className: 'gv-original-target' },
        ],
      },
    },
  );
  expect(
    Array.from(document.querySelectorAll('.gv-original-target')).map((node) => node.textContent),
  ).toEqual(['Original draft']);
  expect(document.querySelector('.private')?.textContent).toBe('Private draft');
});

it('bundled class operations keep the baseline DOM scan cost and the same visible classes', () => {
  page();
  const field = document.querySelector('.input')!,
    send = document.querySelector('.send')!;
  const queries = vi.spyOn(document, 'querySelectorAll');
  const ancestors = vi.spyOn(Element.prototype, 'closest');
  const matches = vi.spyOn(Element.prototype, 'matches');
  const count = () => ({
    queries: queries.mock.calls.length,
    ancestors: ancestors.mock.calls.length,
    matches: matches.mock.calls.length,
  });
  const reference = new DeclarativeEngine({
    doc: document,
    adapter: requireBundledSiteAdapter('chatgpt'),
  });
  reference.mount(manifest);
  const baseline = count();
  const classes = [field.className, send.className];
  reference.unmount(manifest.id);
  queries.mockClear();
  ancestors.mockClear();
  matches.mockClear();
  mount();
  expect([field.className, send.className]).toEqual(classes);
  expect(classes).toEqual(['input gv-test-input', 'send gv-test-send']);
  expect(count()).toEqual(baseline);
  expect(ancestors).not.toHaveBeenCalled();
});
