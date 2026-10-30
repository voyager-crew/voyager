// @vitest-environment-options { "url": "https://gemini.google.com/u/0/app/test" }
/** Gemini's conversation export through its packaged source, host, storage feed and admission. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { CleanupManager } from '@/core/utils/cleanupManager';
import { ExportFormat } from '@/features/export/types/export';
import type { PluginHost } from '@/features/plugins/runtime/PluginHost';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';

import { PENDING_EXPORT_SESSION_KEY, createPendingExportState } from '../export/pendingExportState';
import { type LifecycleHarness, installLifecycleHarness } from './lifecycleHarness';

const ID = OFFICIAL_PLUGIN_IDS.geminiExport;
const SWITCH = StorageKeys.GEMINI_EXPORT_ENABLED;
const TOOLBAR = '[data-gv-component="persistent-export-toolbar"]';
const MENU_ITEM = '.gv-export-conversation-menu-btn';
const COPY_IMAGE = '[data-test-id="gv-copy-image-button"]';

let harness: LifecycleHarness;
let cleanupManager: CleanupManager;
let host: PluginHost | null;

/**
 * Fresh modules per test: the export module remembers per page load whether
 * it already resumed a reloaded run, and each test is its own page load.
 */
async function start(admit = true): Promise<void> {
  vi.resetModules();
  const [{ PluginHost }, admissionModule, sourceModule, localSourceModule, startup] =
    await Promise.all([
      import('@/features/plugins/runtime/PluginHost'),
      import('@/features/plugins/runtime/officialAdmission'),
      import('@/features/plugins/sources/BuiltinPluginSource'),
      import('@/features/plugins/local/LocalPluginSource'),
      import('../geminiBuiltinStartup'),
    ]);
  const admission = admissionModule.createOfficialAdmission();
  if (admit) await startup.createGeminiBuiltinStartup(admission, cleanupManager).startExport();
  admission.close();
  host = new PluginHost({
    url: location.href,
    // Export must mount through its primitive, without a fixed-id native handler.
    sources: [new sourceModule.BuiltinPluginSource(), new localSourceModule.LocalPluginSource()],
    doc: document,
    admission,
    requestCatalogRefresh: () => {},
    isTopFrame: true,
  });
  await host.start();
}

const statusOf = (): string | undefined =>
  host?.getStatuses().find((entry) => entry.id === ID)?.kind;

function setSwitch(enabled: boolean): void {
  harness.storage.sync.set(SWITCH, enabled);
  harness.emitStorageChange({ [SWITCH]: { newValue: enabled } }, 'sync');
}

function actionButton(testId: string, iconName: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'mdc-icon-button mat-mdc-icon-button';
  button.setAttribute('data-test-id', testId);
  button.setAttribute('aria-label', testId === 'copy-button' ? 'Copy response' : 'More');
  const icon = document.createElement('mat-icon');
  icon.setAttribute('fonticon', iconName);
  icon.textContent = iconName;
  button.appendChild(icon);
  return button;
}

/** An lr26 conversation (no logo) with one response and its action bar. */
function renderConversation(): void {
  document.body.className = 'lr26';
  document.body.innerHTML = `
    <main>
      <div class="user-query-container">prompt</div>
      <model-response>
        <div class="response-container">
          <message-content>answer</message-content>
          <message-actions><div class="actions-container-v2"><div class="buttons-container-v2"></div></div></message-actions>
        </div>
      </model-response>
    </main>`;
  document
    .querySelector('.buttons-container-v2')!
    .append(
      actionButton('copy-button', 'content_copy'),
      actionButton('more-menu-button', 'more_vert'),
    );
}

/** The conversation's ⋮ menu, opened from its trigger. */
function openConversationMenu(): HTMLElement {
  const trigger = document.createElement('button');
  trigger.setAttribute('data-test-id', 'actions-menu-button');
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'true');
  trigger.setAttribute('aria-controls', 'conversation-menu');
  const panel = document.createElement('div');
  panel.id = 'conversation-menu';
  panel.className = 'mat-mdc-menu-panel';
  panel.setAttribute('role', 'menu');
  panel.innerHTML = `<div class="mat-mdc-menu-content"><button class="mat-mdc-menu-item" role="menuitem" data-test-id="pin-button">Pin</button></div>`;
  document.body.append(trigger, panel);
  return panel;
}

const count = (selector: string): number => document.querySelectorAll(selector).length;

async function expectEntryPoints(present: boolean): Promise<void> {
  await vi.waitFor(() => {
    expect(count(TOOLBAR)).toBe(present ? 1 : 0);
    expect(count(COPY_IMAGE)).toBe(present ? 1 : 0);
    expect(count(MENU_ITEM)).toBe(present ? 1 : 0);
  });
}

/** Give a mount that should not happen time to show itself. */
async function settleQuietly(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 300));
}

function storePendingRun(attempt: number): string {
  const state = JSON.stringify({
    ...createPendingExportState(ExportFormat.JSON, location.href, Date.now()),
    attempt,
  });
  sessionStorage.setItem(PENDING_EXPORT_SESSION_KEY, state);
  return state;
}

beforeEach(() => {
  renderConversation();
  harness = installLifecycleHarness();
  cleanupManager = new CleanupManager();
  host = null;
  sessionStorage.clear();
});

afterEach(async () => {
  vi.useRealTimers();
  host?.stop();
  cleanupManager.executeCleanups();
  await settleQuietly();
  harness.restore();
  vi.restoreAllMocks();
  sessionStorage.clear();
  document.body.className = '';
  document.body.innerHTML = '';
});

describe('Gemini conversation export through its official plugin', () => {
  it('mounts the toolbar, the menu item and copy-as-image for a user who never touched it', async () => {
    await start();
    openConversationMenu();

    await expectEntryPoints(true);
    expect(statusOf()).toBe('mounted');
    // Default on is the binding's reading of a missing key; nothing is written for it.
    expect(harness.storage.sync.has(SWITCH)).toBe(false);
  });

  it('shows no export entry point on Gemini while the switch is off', async () => {
    harness.storage.sync.set(SWITCH, false);
    await start();
    openConversationMenu();
    await settleQuietly();

    await expectEntryPoints(false);
    expect(statusOf()).not.toBe('mounted');
    expect(harness.ledger.openObservers()).toEqual([]);
  });

  it('blocks a stored local export primitive even when the official plugin is off', async () => {
    const id = 'local.gemini-export';
    harness.storage.sync.set(SWITCH, false);
    harness.storage.local.set(StorageKeys.PLUGIN_LOCAL_MANIFESTS, {
      [id]: {
        manifest: {
          id,
          name: 'Local export',
          version: '1.0.0',
          description: 'Conversation export',
          author: 'local',
          category: 'productivity',
          license: 'MIT',
          engine: '>=1.10.0',
          tier: 'declarative',
          matches: ['https://gemini.google.com/*'],
          contributes: { domOps: [{ op: 'native', handler: 'conversationExport', params: {} }] },
        },
        importedAt: 1,
        updatedAt: 1,
      },
    });
    harness.storage.local.set(StorageKeys.PLUGINS_STATE, {
      [id]: { enabled: true, installedAt: 1 },
    });
    const pending = storePendingRun(400);
    await start();

    expect(host?.getStatuses().find((entry) => entry.id === id)).toMatchObject({
      kind: 'blocked',
      blockedReason: 'host-policy',
    });
    await expectEntryPoints(false);
    expect(sessionStorage.getItem(PENDING_EXPORT_SESSION_KEY)).toBe(pending);
    expect(harness.ledger.openObservers()).toEqual([]);
  });

  it('removes every entry point on live off and restores exactly one of each on re-enable', async () => {
    await start();
    openConversationMenu();
    await expectEntryPoints(true);
    const observers = harness.ledger.openObservers().length;

    setSwitch(false);
    await expectEntryPoints(false);
    await vi.waitFor(() => expect(statusOf()).not.toBe('mounted'));
    expect(harness.ledger.openObservers()).toEqual([]);

    // The menu that stayed open gets its item back.
    setSwitch(true);
    await expectEntryPoints(true);
    expect(harness.ledger.openObservers()).toHaveLength(observers);
  });

  // The pre-lr26 layout waits up to 8 s for a logo; a fast off/on lands inside that wait.
  it('keeps the menu and copy-as-image entry points after a fast off and on while the logo loads', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    document.body.className = '';
    await start();
    await vi.waitFor(() => expect(count(COPY_IMAGE)).toBe(1));

    setSwitch(false);
    await vi.waitFor(() => expect(statusOf()).not.toBe('mounted'));
    setSwitch(true);
    await vi.waitFor(() => expect(statusOf()).toBe('mounted'));
    // Long past the first mount's logo wait, whose late cleanup must not strip the second.
    await vi.advanceTimersByTimeAsync(9000);
    openConversationMenu();

    await vi.waitFor(() => {
      expect(count(COPY_IMAGE)).toBe(1);
      expect(count(MENU_ITEM)).toBe(1);
    });
    vi.useRealTimers();
  });

  it('removes the logo dropdown on teardown and puts the logo back', async () => {
    document.body.className = '';
    const header = document.createElement('header');
    const logo = document.createElement('a');
    logo.setAttribute('data-test-id', 'logo');
    header.appendChild(logo);
    document.body.prepend(header);

    await start();
    await vi.waitFor(() => expect(count('.gv-export-dropdown-btn')).toBe(1));
    expect(logo.parentElement?.classList.contains('gv-logo-dropdown-wrapper')).toBe(true);

    host!.stop();
    await vi.waitFor(() => expect(count('.gv-logo-dropdown-wrapper')).toBe(0));
    expect(logo.parentElement).toBe(header);
    await expectEntryPoints(false);
  });

  it('does nothing if the page never reaches its admission point even with an explicit on', async () => {
    harness.storage.sync.set(SWITCH, true);
    const pending = storePendingRun(400);
    await start(false);
    openConversationMenu();
    await settleQuietly();

    await expectEntryPoints(false);
    expect(sessionStorage.getItem(PENDING_EXPORT_SESSION_KEY)).toBe(pending);
  });
});

describe('a Gemini export run cut short by the preload reload', () => {
  // Gemini's preload click can reload the page; the run waits in sessionStorage.
  it('still resumes when export runs as a plugin', async () => {
    storePendingRun(400);
    await start();

    await vi.waitFor(() => expect(sessionStorage.getItem(PENDING_EXPORT_SESSION_KEY)).toBeNull());
  });

  it('does not resume while the export switch is off', async () => {
    harness.storage.sync.set(SWITCH, false);
    const pending = storePendingRun(400);
    await start();
    await settleQuietly();

    expect(sessionStorage.getItem(PENDING_EXPORT_SESSION_KEY)).toBe(pending);
  });

  it('is not restarted by switching export off and on again on the same page', async () => {
    await start();
    await vi.waitFor(() => expect(count(TOOLBAR)).toBe(1));

    setSwitch(false);
    await vi.waitFor(() => expect(count(TOOLBAR)).toBe(0));
    const pending = storePendingRun(400);
    setSwitch(true);
    await vi.waitFor(() => expect(count(TOOLBAR)).toBe(1));
    await settleQuietly();

    expect(sessionStorage.getItem(PENDING_EXPORT_SESSION_KEY)).toBe(pending);
  });
});
