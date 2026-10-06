import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type MemoryStorage,
  createMemoryStorage,
  settle,
} from '@/features/plugins/builtin/chatgptFolders/__tests__/memoryStorage';

import { TimelineHierarchyGeometry } from '../../TimelineHierarchyGeometry';
import { TimelineState } from '../../TimelineState';
import { routeCatalogOutlineWrites } from '../../__tests__/catalogOutlineBackground';
import { CatalogTimelineAdapter } from './CatalogTimelineAdapter';
import { CatalogTurnOwnership } from './CatalogTurnOwnership';
import type { CatalogTimelineConfig } from './config';
import { starConversationId, turnConversationId } from './conversationId';

vi.mock('@/features/savedLibrary/StarredMessagesService', async (importOriginal) => ({
  StarredMessagesService: {
    backfillStarredTexts: vi.fn().mockResolvedValue(undefined),
    decodeStorageChange: (
      await importOriginal<typeof import('@/features/savedLibrary/StarredMessagesService')>()
    ).StarredMessagesService.decodeStorageChange,
    getStarredMessagesForConversation: vi.fn().mockResolvedValue([]),
    addStarredMessage: vi.fn().mockResolvedValue(undefined),
    removeStarredMessage: vi.fn().mockResolvedValue(undefined),
  },
}));

const fixtures = [
  {
    siteId: 'claude',
    siteLabel: 'Claude',
    turnSelector: '[data-testid="user-message"]',
    assistantTurnSelector: '.assistant',
    conversationIdPattern: '^/chat/([^/?#]+)',
    conversationIdAttribute: 'data-conv-id',
    path: '/chat/first',
  },
  {
    siteId: 'chatgpt',
    siteLabel: 'ChatGPT',
    turnSelector: '[data-user-message-bubble]',
    assistantTurnSelector: '[data-message-author-role="assistant"]',
    conversationIdPattern: '^/c/([^/?#]+)',
    conversationIdAttribute: 'data-conversation-id',
    path: '/c/first',
  },
];

let storage: MemoryStorage;

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  storage = createMemoryStorage();
  vi.stubGlobal('chrome', {
    ...chrome,
    runtime: { ...chrome.runtime, sendMessage: routeCatalogOutlineWrites() },
    storage: { ...chrome.storage, local: storage.api.local, onChanged: storage.api.onChanged },
  });
});

afterEach(() => vi.unstubAllGlobals());

for (const fixture of fixtures) {
  describe(`${fixture.siteId} shared timeline adapter`, () => {
    const config: CatalogTimelineConfig = {
      ...fixture,
      position: 'right',
      pluginId: `voyager.${fixture.siteId}-timeline`,
      coachmarkId: 'test',
    };
    function turn(text: string, role: 'user' | 'assistant' = 'user'): HTMLElement {
      const element = document.createElement('div');
      if (fixture.siteId === 'claude') {
        if (role === 'user') element.dataset.testid = 'user-message';
        else element.className = 'assistant';
      } else if (role === 'user') element.setAttribute('data-user-message-bubble', '');
      else element.dataset.messageAuthorRole = 'assistant';
      element.textContent = text;
      return element;
    }
    function create() {
      history.replaceState({}, '', fixture.path);
      document.body.setAttribute(fixture.conversationIdAttribute, 'first');
      const stars = new CatalogTurnOwnership({
        routeId: () => location.href.split('#')[0],
        starId: () => starConversationId(config),
        turnConversation: (element) => turnConversationId(config, element),
      });
      stars.begin();
      const adapter = new CatalogTimelineAdapter(config, stars);
      return { adapter, stars };
    }

    it('collects prompt and assistant summaries through catalog selectors across virtualized windows', () => {
      const { adapter } = create();
      const first = turn('First prompt');
      document.body.append(first, turn('First answer', 'assistant'), turn('Next prompt'));
      let markers = adapter.turns.read([]).markers;
      const id = markers[0].id;
      expect(markers.map((marker) => [marker.summary, marker.assistantSummary])).toEqual([
        ['First prompt', 'First answer'],
        ['Next prompt', ''],
      ]);
      first.remove();
      markers = adapter.turns.read(markers).markers;
      expect(markers.map((marker) => marker.summary)).toEqual(['First prompt', 'Next prompt']);
      document.body.prepend(turn('First prompt'));
      markers = adapter.turns.read(markers).markers;
      expect(markers[0].id).toBe(id);
      expect(markers).toHaveLength(2);
      adapter.turns.stop();
      expect(document.querySelector('[data-gv-turn-id]')).toBeNull();
      document.body.removeAttribute(fixture.conversationIdAttribute);
    });

    it('persists hierarchy under its site and restores collapse geometry on conversation remount', async () => {
      const { adapter } = create();
      document.body.append(turn('Parent'), turn('Child'), turn('Next parent'));
      const state = new TimelineState(() => {}, adapter.storage);
      await state.init();
      state.replaceMarkers(adapter.turns.read([]).markers);
      const geometry = new TimelineHierarchyGeometry(
        () => state.markers,
        (id) => state.hierarchy.getMarkerLevel(id),
        (id) => state.hierarchy.isMarkerCollapsed(id),
      );
      geometry.markerLevelEnabled = true;
      state.hierarchy.setMarkerLevel(state.markers[1].id, 2);
      state.hierarchy.toggleCollapse(state.markers[0].id);
      expect(geometry.getHiddenMarkerIndices()).toEqual(new Set([1]));
      await settle();
      expect([...storage.values.local.keys()]).toEqual([
        `gvCatalogTimelineHierarchy:${fixture.siteId}`,
      ]);
      expect(localStorage.length).toBe(0);
      state.destroy();
      const restored = new TimelineState(() => {}, adapter.storage);
      await restored.init();
      restored.replaceMarkers(state.markers);
      const restoredGeometry = new TimelineHierarchyGeometry(
        () => restored.markers,
        (id) => restored.hierarchy.getMarkerLevel(id),
        (id) => restored.hierarchy.isMarkerCollapsed(id),
      );
      restoredGeometry.markerLevelEnabled = true;
      expect(restoredGeometry.getHiddenMarkerIndices()).toEqual(new Set([1]));
      restored.destroy();
      adapter.turns.stop();
      document.body.removeAttribute(fixture.conversationIdAttribute);
    });

    it('refuses hierarchy edits for a previous conversation still on screen after the route changes', async () => {
      const { adapter, stars } = create();
      document.body.append(turn('Cached previous prompt'));
      adapter.turns.read([]);
      history.replaceState({}, '', fixture.path.replace('first', 'next'));
      const nextAdapter = new CatalogTimelineAdapter(config, stars);
      const state = new TimelineState(() => {}, nextAdapter.storage);
      await state.init();
      state.replaceMarkers(nextAdapter.turns.read([]).markers);
      state.hierarchy.setMarkerLevel(state.markers[0].id, 2);
      state.hierarchy.toggleCollapse(state.markers[0].id);
      expect(state.hierarchy.getMarkerLevel(state.markers[0].id)).toBe(1);
      await settle();
      expect(storage.writes).toEqual([]);
      state.destroy();
      adapter.turns.stop();
      nextAdapter.turns.stop();
      document.body.removeAttribute(fixture.conversationIdAttribute);
    });
  });
}
