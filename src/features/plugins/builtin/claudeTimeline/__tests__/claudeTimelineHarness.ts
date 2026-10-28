import '@/features/timeline/adapters/catalog/testSetup';
/** Shared mocks, page fixtures and per-test setup for the Claude timeline suites. */
import { afterEach, beforeEach, vi } from 'vitest';

import type { StarredMessage } from '@/features/savedLibrary/starTypes';

import { requireBundledSiteAdapter } from '../../../catalog/sites';
import { PluginScope } from '../../../runtime/pluginScope';
import type { NativeOperation } from '../../../types';
import type { PluginSettings } from '../../../types';
import { turnNavigatorPrimitive } from '../../../verbs/turnNavigator';
import type { PrimitiveHandle } from '../../../verbs/types';
import { BUILTIN_PLUGINS } from '../../index';

const {
  addStarredMessage,
  getStarredMessagesForConversation,
  removeStarredMessage,
  requestPluginSetting,
  showTimelineStyleCoachmark,
} = vi.hoisted(() => ({
  addStarredMessage: vi.fn().mockResolvedValue(undefined),
  getStarredMessagesForConversation: vi.fn().mockResolvedValue([]),
  removeStarredMessage: vi.fn().mockResolvedValue(undefined),
  requestPluginSetting: vi.fn().mockResolvedValue(undefined),
  showTimelineStyleCoachmark: vi.fn().mockResolvedValue(undefined),
}));

export {
  addStarredMessage,
  getStarredMessagesForConversation,
  removeStarredMessage,
  requestPluginSetting,
  showTimelineStyleCoachmark,
};

vi.mock('@/utils/i18n', () => ({
  onCachedLanguageChange: () => () => {},
  initI18n: vi.fn().mockResolvedValue(undefined),
  getTranslationSync: (key: string) => key,
}));

vi.mock('@/features/savedLibrary/StarredMessagesService', async (importOriginal) => ({
  StarredMessagesService: {
    backfillStarredTexts: vi.fn().mockResolvedValue(undefined),
    decodeStorageChange: (
      await importOriginal<typeof import('@/features/savedLibrary/StarredMessagesService')>()
    ).StarredMessagesService.decodeStorageChange,
    addStarredMessage,
    getStarredMessagesForConversation,
    removeStarredMessage,
  },
}));

vi.mock('@/features/plugins/storage/pluginSettingRequest', () => ({ requestPluginSetting }));

vi.mock('@/features/timeline/timelineStyleCoachmark', () => ({
  showTimelineStyleCoachmark,
}));

export let standaloneScope: PluginScope | null = null;
export let standaloneHandle: PrimitiveHandle | null = null;
export const library = new Map<string, StarredMessage[]>();

/** Exercise the same shipped manifest and resolved site data as PluginHost. */
export function startClaudeTimeline(settings: PluginSettings = {}): void {
  const manifest = BUILTIN_PLUGINS.find((plugin) => plugin.id === 'voyager.claude-timeline');
  const op = manifest?.contributes.domOps?.find(
    (entry): entry is NativeOperation => entry.op === 'native',
  );
  const params = turnNavigatorPrimitive.validateParams(op?.params);
  if (!manifest || !params.success) throw new Error('invalid Claude timeline manifest');
  standaloneScope = new PluginScope();
  const handle = turnNavigatorPrimitive.activate(standaloneScope, params.data, {
    doc: document,
    adapter: requireBundledSiteAdapter('claude'),
    pluginId: manifest.id,
    settings,
    setTargetCounter: () => {},
  });
  standaloneHandle = handle && !('then' in handle) ? handle : null;
}

export function updateClaudeTimelineSettings(settings: PluginSettings): void {
  standaloneHandle?.updateSettings?.(settings);
}

export async function stopClaudeTimeline(): Promise<void> {
  await standaloneScope?.dispose();
  standaloneScope = null;
  standaloneHandle = null;
}

export interface CapturedTimelineCoachmarkOptions {
  id: string;
  enabled: boolean;
  onStyleChange: (compact: boolean) => Promise<void>;
}

export function createTurn(text: string): HTMLElement {
  const turn = document.createElement('div');
  turn.setAttribute('data-testid', 'user-message');
  turn.textContent = text;
  return turn;
}

export function addTurn(text: string): HTMLElement {
  const turn = createTurn(text);
  document.body.appendChild(turn);
  return turn;
}

export function queryDots(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.timeline-dot'));
}

export function dotLabels(): string[] {
  return queryDots().map((dot) => dot.getAttribute('aria-label') || '');
}

export async function flush(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

export async function settleRefresh(): Promise<void> {
  await flush();
  vi.advanceTimersByTime(220);
  await flush();
}

/** A Claude conversation page with the starred store in memory; call inside each suite. */
export function useClaudeTimelinePage(): void {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    // Claude's thread container names the conversation every turn belongs to.
    document.body.setAttribute('data-conv-id', 'claude-123');
    history.replaceState({}, '', '/chat/claude-123');
    library.clear();
    getStarredMessagesForConversation
      .mockReset()
      .mockImplementation(async (conversationId: string) => library.get(conversationId) ?? []);
    addStarredMessage.mockReset().mockImplementation(async (message: StarredMessage) => {
      library.set(message.conversationId, [
        ...(library.get(message.conversationId) ?? []).filter(
          (stored) => stored.turnId !== message.turnId,
        ),
        message,
      ]);
    });
    removeStarredMessage
      .mockReset()
      .mockImplementation(async (conversationId: string, turnId: string) => {
        library.set(
          conversationId,
          (library.get(conversationId) ?? []).filter((stored) => stored.turnId !== turnId),
        );
      });
    requestPluginSetting.mockClear();
    showTimelineStyleCoachmark.mockClear();
    HTMLElement.prototype.scrollIntoView = vi.fn();
    window.scrollTo = vi.fn();
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
  });

  afterEach(async () => {
    document.body.removeAttribute('data-conv-id');
    await stopClaudeTimeline();
    vi.useRealTimers();
  });
}
