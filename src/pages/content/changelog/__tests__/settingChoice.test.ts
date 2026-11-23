import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { GEMINI_HIGHLIGHT_MANIFEST } from '@/features/plugins/builtin/geminiHighlightManifest';
import { legacyValueBindingsFor } from '@/features/plugins/storage/legacyValueBindings';

import { renderChangelogMarks } from '../changelogMarks';
import { createChangelogModal } from '../modal';
import { createSettingChoice } from '../settingChoice';
import {
  CHANGELOG_SWITCH_TARGETS,
  CHOICE_MARKER,
  type ChoiceTarget,
  choiceTargetFor,
  unknownChoiceMarkers,
} from '../switchTargets';

type Listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => void;

const USAGE = 'voyager.gemini-usage-status';
const MARKER = `:choice:${USAGE}:display:`;
const ENABLED = StorageKeys.USAGE_STATUS_ENABLED;
const DISPLAY = StorageKeys.USAGE_STATUS_DISPLAY;

/** Sync storage that keeps what is written and tells every listener, as the browser does. */
let store: Record<string, unknown>;
let listeners: Set<Listener>;

function emit(changes: Record<string, unknown>): void {
  const event = Object.fromEntries(
    Object.entries(changes).map(([key, newValue]) => [key, { newValue }]),
  );
  for (const listener of listeners) listener(event, 'sync');
}

beforeEach(() => {
  store = {};
  listeners = new Set();
  (chrome.storage.sync.get as unknown as Mock).mockImplementation(async (keys: string[]) =>
    Object.fromEntries(keys.filter((key) => key in store).map((key) => [key, store[key]])),
  );
  (chrome.storage.sync.set as unknown as Mock).mockImplementation(
    async (items: Record<string, unknown>) => {
      Object.assign(store, items);
      emit(items);
    },
  );
  (chrome.storage.onChanged.addListener as unknown as Mock).mockImplementation((l: Listener) =>
    listeners.add(l),
  );
  (chrome.storage.onChanged.removeListener as unknown as Mock).mockImplementation((l: Listener) =>
    listeners.delete(l),
  );
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function render(html: string, lang = 'zh') {
  const body = document.createElement('div');
  body.innerHTML = html;
  document.body.appendChild(body);
  const dispose = renderChangelogMarks(body, {
    mac: false,
    lang,
    switchHint: 'hint',
    choiceOffHint: 'Turn on {name} first',
  });
  return { body, dispose };
}

function select(root: ParentNode): HTMLSelectElement {
  const control = root.querySelector<HTMLSelectElement>('.gv-changelog-choice select');
  if (!control) throw new Error('no select');
  return control;
}

function hint(root: ParentNode): HTMLElement {
  return root.querySelector<HTMLElement>('.gv-changelog-choice__hint')!;
}

describe('changelog choice targets', () => {
  it('lists only declared select or boolean settings the popup writes to their own key', () => {
    for (const [id, target] of Object.entries(CHANGELOG_SWITCH_TARGETS)) {
      for (const key of target.choices ?? []) {
        const choice = choiceTargetFor(id, key);
        expect(choice, `${id}:${key}`).not.toBeNull();
        expect(
          legacyValueBindingsFor(id).some((binding) => binding.settingKey === key),
          `${id}:${key} has a value binding`,
        ).toBe(true);
        // The docs site cannot read the extension's messages, so the label must be the manifest's.
        expect(choice!.field.messageKeys, `${id}:${key}`).toBeUndefined();
        expect(`:choice:${id}:${key}:`.match(CHOICE_MARKER), `${id}:${key} parses`).not.toBeNull();
      }
    }
  });

  it('rejects an unlisted setting, an unlisted plugin and a marker missing its key', () => {
    expect(
      unknownChoiceMarkers(
        `${MARKER} :choice:${USAGE}:nope: :choice:voyager.gemini-folders:hideFiledChats: :choice:${USAGE}:`,
      ),
    ).toEqual([`${USAGE}:nope`, 'voyager.gemini-folders:hideFiledChats', `${USAGE}:`]);
  });

  it('splits the plugin id from the setting key at the last colon only', () => {
    const [match] = `see ${MARKER} here`.matchAll(CHOICE_MARKER);
    expect([match[1], match[2]]).toEqual([USAGE, 'display']);
  });
});

describe('changelog choice control', () => {
  it("shows the stored value with the manifest's labels in the reader's language", async () => {
    store[ENABLED] = true;
    store[DISPLAY] = 'remaining';
    const { body } = render(`<p>Pick ${MARKER}</p>`);
    const control = select(body);

    await vi.waitFor(() => expect(control.disabled).toBe(false));
    expect(control.value).toBe('remaining');
    expect(body.querySelector('.gv-changelog-choice__name')?.textContent).toBe('进度条显示');
    expect([...control.options].map((option) => option.textContent)).toEqual(['已用', '剩余']);
    expect(hint(body).hidden).toBe(true);
  });

  it('falls back to English labels for a language the manifest lacks', async () => {
    store[ENABLED] = true;
    const { body } = render(`<p>${MARKER}</p>`, 'en');
    const control = select(body);

    await vi.waitFor(() => expect(control.disabled).toBe(false));
    expect(control.value).toBe('used');
    expect(body.querySelector('.gv-changelog-choice__name')?.textContent).toBe('Bar shows');
    expect([...control.options].map((option) => option.textContent)).toEqual(['Used', 'Remaining']);
  });

  it('writes a change to the bound key the feature reads, never to plugin state', async () => {
    store[ENABLED] = true;
    const { body } = render(`<p>${MARKER}</p>`);
    const control = select(body);
    await vi.waitFor(() => expect(control.disabled).toBe(false));

    control.value = 'remaining';
    control.dispatchEvent(new Event('change'));

    await vi.waitFor(() => expect(store[DISPLAY]).toBe('remaining'));
    expect(Object.keys(store).sort()).toEqual([DISPLAY, ENABLED].sort());
    expect(store).not.toHaveProperty(StorageKeys.PLUGINS_STATE);
  });

  it('puts the value back when the write fails', async () => {
    store[ENABLED] = true;
    const { body } = render(`<p>${MARKER}</p>`);
    const control = select(body);
    await vi.waitFor(() => expect(control.disabled).toBe(false));
    (chrome.storage.sync.set as unknown as Mock).mockRejectedValueOnce(new Error('quota'));

    control.value = 'remaining';
    control.dispatchEvent(new Event('change'));

    await vi.waitFor(() => expect(control.value).toBe('used'));
  });

  it('is disabled with a hint while the plugin is off, and wakes when its switch turns on', async () => {
    const { body } = render(`<p>:switch:${USAGE}: then ${MARKER}</p>`);
    const control = select(body);
    const toggle = body.querySelector<HTMLButtonElement>('[role="switch"]')!;

    await vi.waitFor(() => expect(hint(body).hidden).toBe(false));
    expect(control.disabled).toBe(true);
    expect(hint(body).textContent).toBe('Turn on Gemini · 用量状态栏 first');
    expect(control.getAttribute('aria-description')).toBe('Turn on Gemini · 用量状态栏 first');

    await vi.waitFor(() => expect(toggle.disabled).toBe(false));
    toggle.click();

    await vi.waitFor(() => expect(control.disabled).toBe(false));
    expect(hint(body).hidden).toBe(true);
    expect(control.hasAttribute('aria-description')).toBe(false);

    emit({ [ENABLED]: false });
    expect(control.disabled).toBe(true);
  });

  it('follows a change made elsewhere until the viewer closes', async () => {
    store[ENABLED] = true;
    const overlay = await createChangelogModal(`<p>${MARKER}</p>`, 'en');
    document.body.appendChild(overlay);
    const control = select(overlay);
    await vi.waitFor(() => expect(control.disabled).toBe(false));

    emit({ [DISPLAY]: 'remaining' });
    expect(control.value).toBe('remaining');
    emit({ [DISPLAY]: undefined });
    expect(control.value).toBe('used');

    overlay.querySelector<HTMLButtonElement>('.gv-changelog-got-it')!.click();
    expect(listeners.size).toBe(0);
  });

  it('renders an unlisted target as plain words, never a control', () => {
    const { body } = render(`<p>Set :choice:${USAGE}:nope: now</p>`);

    expect(body.querySelector('select, button')).toBeNull();
    expect(body.textContent).toBe(`Set ${USAGE} nope now`);
    expect(listeners.size).toBe(0);
  });

  it('shows a boolean setting as the changelog switch writing its bound key', async () => {
    store[StorageKeys.HIGHLIGHT_ENABLED] = true;
    store[StorageKeys.HIGHLIGHT_TIMELINE_MARKERS_ENABLED] = false;
    const field = GEMINI_HIGHLIGHT_MANIFEST.contributes.settings!.timelineMarkers;
    const choice = {
      target: { manifest: GEMINI_HIGHLIGHT_MANIFEST },
      key: 'timelineMarkers',
      field,
    } as ChoiceTarget;
    const control = createSettingChoice(document, choice, {
      name: 'Markers',
      options: [],
      offHint: 'off',
    })!;
    document.body.appendChild(control.element);
    const toggle = control.element.querySelector<HTMLButtonElement>('[role="switch"]')!;

    await vi.waitFor(() => expect(toggle.disabled).toBe(false));
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    toggle.click();

    await vi.waitFor(() =>
      expect(store[StorageKeys.HIGHLIGHT_TIMELINE_MARKERS_ENABLED]).toBe(true),
    );
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    control.dispose();
    expect(listeners.size).toBe(0);
  });
});
