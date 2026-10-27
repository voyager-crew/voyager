import { afterEach, describe, expect, it } from 'vitest';

import { SiteSelectorService } from '@/core/selectors';
import { readPressedMode } from '@/features/plugins/builtin/chatgptLocalBridge/ops/modeSwitch';
import {
  projectPageIdOf,
  projectPathOf,
} from '@/features/plugins/builtin/chatgptLocalBridge/ops/projectPage';
import { readStatus } from '@/features/plugins/builtin/chatgptModelSelect/pickerDom';
import { requireBundledSiteAdapter } from '@/features/plugins/catalog/sites';
import { readTurnKey } from '@/features/plugins/sends/trackUserSends';
import { SiteRegistry } from '@/features/plugins/sites/registry';
import { siteAdapterToData } from '@/features/plugins/sites/siteAdapterData';
import type { SiteAdapter } from '@/features/plugins/types';
import { buildMenuEntry } from '@/features/plugins/verbs/folders/moveMenuEntry';
import {
  starConversationId,
  siteConversationConfig,
} from '@/features/timeline/adapters/catalog/conversationId';
import { buildCatalogExportAdapter } from '@/pages/content/export/adapter/platform/catalog';
import { captureCatalogWindow } from '@/pages/content/export/sites/catalogReader';

import { type HostCatalogCacheEntry, siteAdapterFromEntry } from './hostCatalogCache';
import { resolveSiteAdapterForUrl } from './siteOverride';

function cached(host: string, remote: SiteAdapter): SiteAdapter {
  const entry: HostCatalogCacheEntry = {
    host,
    status: 'ok',
    manifests: [],
    fetchedAt: 1,
    lastAttemptAt: 1,
    failureCount: 0,
    extensionVersion: 'test',
    site: siteAdapterToData(remote),
  };
  const accepted = siteAdapterFromEntry(entry, 'test');
  if (!accepted) throw new Error('Expected accepted locator data');
  return accepted;
}

afterEach(() => document.body.replaceChildren());

describe('packaged identity under a catalog repair', () => {
  it('a remote route pattern cannot move stars into another conversation namespace', async () => {
    const bundle = requireBundledSiteAdapter('chatgpt');
    const remote: SiteAdapter = {
      ...bundle,
      catalogRevision: (bundle.catalogRevision ?? 0) + 1,
      conversationIdPattern: '^/(u)',
      turnKeyAttributes: ['data-forged'],
      locators: { 'bridge.replyContent': ['.repaired'] },
    };
    const registry = new SiteRegistry();
    registry.register(bundle);
    const url = 'https://chatgpt.com/u/2/c/kept';
    document.body.innerHTML =
      '<article class="repaired" data-turn-key="kept-turn" data-forged="other-turn">Complete reply</article>';
    for (const accepted of [
      cached('chatgpt.com', remote),
      resolveSiteAdapterForUrl(url, registry, remote)!,
    ]) {
      expect(starConversationId(siteConversationConfig(accepted), url)).toBe('chatgpt:conv:kept');
      expect(readTurnKey(document.querySelector('article')!, accepted.turnKeyAttributes!)).toBe(
        'kept-turn',
      );
      const service = new SiteSelectorService('chatgpt');
      const lifetime = service.initialize({
        host: 'chatgpt.com',
        doc: document,
        lifetime: new AbortController().signal,
        read: async () => accepted,
      });
      await lifetime.ready;
      expect(
        document.querySelector(service.getView().profiles['bridge.replyContent'].join(','))
          ?.textContent,
      ).toBe('Complete reply');
      lifetime.stop();
    }
  });

  it('remote message identity cannot merge or rename exported answers', () => {
    const bundle = requireBundledSiteAdapter('claude');
    const remote: SiteAdapter = {
      ...bundle,
      catalogRevision: (bundle.catalogRevision ?? 0) + 1,
      export: { ...bundle.export!, messageKey: 'data-forged', read: 'mounted' },
    };
    document.body.innerHTML =
      '<div data-turn-key="answer-a" data-forged="shared"><div data-testid="assistant-message"><p>First answer</p></div></div><div data-turn-key="answer-b" data-forged="shared"><div data-testid="assistant-message"><p>Second answer</p></div></div>';
    const accepted = cached('claude.ai', remote);
    const snapshots = captureCatalogWindow(accepted, buildCatalogExportAdapter(accepted));
    expect(snapshots.map((item) => ({ id: item.id, text: item.content.text.trim() }))).toEqual([
      { id: 'data-turn-key:answer-a', text: 'First answer' },
      { id: 'data-turn-key:answer-b', text: 'Second answer' },
    ]);
  });

  it('remote project routes and ID attributes cannot redirect a project operation', () => {
    const bundle = requireBundledSiteAdapter('chatgpt');
    const remote: SiteAdapter = {
      ...bundle,
      catalogRevision: (bundle.catalogRevision ?? 0) + 1,
      projects: {
        ...bundle.projects!,
        projectPagePattern: '^/(g)',
        projectRoutePattern: '^/(g)',
        projectPath: '/wrong/{projectId}',
        sourcesQuery: 'wrong=true',
        sidebar: {
          ...bundle.projects!.sidebar,
          idAttribute: 'data-forged',
          row: '.repaired-project',
        },
        sources: { ...bundle.projects!.sources, removeIcon: '.wrong-action' },
      },
    };
    const accepted = cached('chatgpt.com', remote);
    const projectId = `g-p-${'a'.repeat(32)}`;
    document.body.innerHTML = `<div class="repaired-project" data-app-action-sidebar-project-id="${projectId}" data-forged="wrong">Project</div><svg><use href="#trash-light-16"></use></svg><button class="wrong-action">Keep</button>`;
    const projects = accepted.projects!;
    expect(projectPageIdOf(projects, `/g/${projectId}/project`)).toBe(projectId);
    expect(
      document.querySelector(projects.sidebar.row)?.getAttribute(projects.sidebar.idAttribute),
    ).toBe(projectId);
    expect(projectPathOf(projects, projectId)).toBe(`/g/${projectId}/project`);
    expect(document.querySelector(projects.sources.removeIcon)?.tagName.toLowerCase()).toBe('use');
  });

  it('a remote menu recipe cannot retain native wiring on Voyager’s cloned menu entry', () => {
    const bundle = requireBundledSiteAdapter('claude');
    const remote: SiteAdapter = {
      ...bundle,
      catalogRevision: (bundle.catalogRevision ?? 0) + 1,
      folders: {
        ...bundle.folders!,
        rowMenu: {
          ...bundle.folders!.rowMenu!,
          strip: ['data-forged'],
          template: '.wrong-template',
          open: 'expanded',
        },
      },
    };
    document.body.innerHTML =
      '<div role="menuitem" data-testid="rename-chat-trigger" aria-keyshortcuts="F2">Rename</div><div class="wrong-template">Delete</div>';
    const accepted = cached('claude.ai', remote);
    const menu = accepted.folders!.rowMenu!;
    const template = document.querySelector(menu.template!)!;
    const entry = buildMenuEntry(template, 'Move to folder', 'data-gv-move', menu.strip);
    expect(entry.textContent).toBe('Move to folder');
    expect(entry.outerHTML).toContain('data-gv-move');
    expect(entry.hasAttribute('data-testid') || entry.hasAttribute('aria-keyshortcuts')).toBe(
      false,
    );
    expect(template.textContent).toBe('Rename');
  });

  it('remote model metadata cannot reinterpret the selected mode or effort', () => {
    const bundle = requireBundledSiteAdapter('chatgpt');
    const remote: SiteAdapter = {
      ...bundle,
      catalogRevision: (bundle.catalogRevision ?? 0) + 1,
      modelPicker: {
        ...bundle.modelPicker!,
        effortStatus: { en: '{label} wrong {position} wrong {count}' },
      },
      pageHooks: {
        ...bundle.pageHooks!,
        modeSwitch: {
          ...bundle.pageHooks!.modeSwitch,
          group: '.repaired-mode',
          order: ['work', 'chat'],
          pressedAttribute: 'data-forged',
        },
      },
    };
    document.body.innerHTML =
      '<div class="repaired-mode"><button aria-pressed="true" data-forged="false">Chat</button><button aria-pressed="false" data-forged="true">Work</button></div><div role="menu"><span role="status">High, 3 of 5.</span></div>';
    for (const button of document.querySelectorAll('button'))
      Object.defineProperty(button, 'getBoundingClientRect', {
        value: () => ({ width: 100, height: 30 }),
      });
    Object.defineProperty(document.querySelector('.repaired-mode')!, 'getBoundingClientRect', {
      value: () => ({ width: 200, height: 30 }),
    });
    const accepted = cached('chatgpt.com', remote);
    expect(readPressedMode(accepted, 'home')).toBe('chat');
    expect(
      readStatus(document.querySelector<HTMLElement>('[role="menu"]')!, accepted.modelPicker!),
    ).toMatchObject({ label: 'High', position: 3 });
  });

  it('a remote matches expansion cannot admit the site on another host', () => {
    const bundle = requireBundledSiteAdapter('chatgpt');
    const remote: SiteAdapter = {
      ...bundle,
      catalogRevision: (bundle.catalogRevision ?? 0) + 1,
      matches: [...bundle.matches, 'https://unknown.example/*'],
    };
    const registry = new SiteRegistry();
    registry.register(bundle);
    expect(resolveSiteAdapterForUrl('https://unknown.example/', registry, remote)).toBeNull();
    const accepted = resolveSiteAdapterForUrl('https://chatgpt.com/c/kept', registry, remote)!;
    expect(starConversationId(siteConversationConfig(accepted), 'https://chatgpt.com/c/kept')).toBe(
      'chatgpt:conv:kept',
    );
  });
});
