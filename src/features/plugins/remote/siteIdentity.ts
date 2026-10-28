/** Remote page data may repair locations, never the identity or action protocol using them. */
import type { FoldersRowMenu, FoldersSection } from '../sites/sections/foldersData';
import type { ProjectsSection } from '../sites/sections/projectsData';
import type { SiteAdapter } from '../types';

function protectMenu(bundled: FoldersRowMenu | undefined, remote: FoldersRowMenu | undefined) {
  if (!bundled || !remote) return undefined;
  return {
    ...remote,
    open: bundled.open,
    after: bundled.after,
    strip: bundled.strip,
    rename: bundled.rename,
    template: bundled.template,
  };
}

function protectFolders(bundled: FoldersSection | undefined, remote: FoldersSection | undefined) {
  if (!bundled || !remote) return undefined;
  return {
    ...remote,
    format: bundled.format,
    rows: { ...remote.rows, idSources: bundled.rows.idSources, drag: bundled.rows.drag },
    rowMenu: protectMenu(bundled.rowMenu, remote.rowMenu),
  };
}

function protectProjects(
  bundled: ProjectsSection | undefined,
  remote: ProjectsSection | undefined,
) {
  if (!bundled || !remote) return undefined;
  return {
    ...remote,
    format: bundled.format,
    projectPagePattern: bundled.projectPagePattern,
    projectRoutePattern: bundled.projectRoutePattern,
    projectPath: bundled.projectPath,
    sourcesQuery: bundled.sourcesQuery,
    sidebar: { ...remote.sidebar, idAttribute: bundled.sidebar.idAttribute },
    sources: {
      ...remote.sources,
      rowActions: bundled.sources.rowActions,
      removeIcon: bundled.sources.removeIcon,
    },
  };
}

/** Use at both cache exit and override resolution so alternate sources cannot bypass the boundary. */
export function protectSiteAdapterIdentity(bundled: SiteAdapter, remote: SiteAdapter): SiteAdapter {
  return {
    ...remote,
    id: bundled.id,
    matches: bundled.matches,
    capabilities: bundled.capabilities,
    conversationIdPattern: bundled.conversationIdPattern,
    turnKeyAttributes: bundled.turnKeyAttributes,
    routeWords: bundled.routeWords,
    accountSlots: bundled.accountSlots,
    conversationRoutes: bundled.conversationRoutes,
    prompt: bundled.prompt,
    modelPicker: bundled.modelPicker,
    pageHooks:
      bundled.pageHooks && remote.pageHooks
        ? {
            ...remote.pageHooks,
            modes: bundled.pageHooks.modes,
            modeSwitch: {
              ...remote.pageHooks.modeSwitch,
              order: bundled.pageHooks.modeSwitch.order,
              pressedAttribute: bundled.pageHooks.modeSwitch.pressedAttribute,
            },
          }
        : undefined,
    folders: protectFolders(bundled.folders, remote.folders),
    projects: protectProjects(bundled.projects, remote.projects),
    export: bundled.export
      ? {
          ...bundled.export,
          ...remote.export,
          version: bundled.export.version,
          read: bundled.export.read,
          messageKey: bundled.export.messageKey,
        }
      : undefined,
  };
}
