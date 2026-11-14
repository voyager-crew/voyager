/**
 * `folders` primitive: a site's conversation folders, run from data. The
 * site's `site.json` `folders` section says where its sidebar and rows are
 * (`siteData.ts`), the core folder table what is written and where, and the
 * shared site folders runtime (`activate.ts`) does the rest. Gemini and AI
 * Studio, whose folders run over a session the page holds, run their own
 * (`gemini/`, `aistudio/`). Settings apply in place: hiding filed chats never
 * reloads the folders.
 */
import { folderSiteForPage } from '@/features/folder/sites/folderSiteTable';

import type { ManifestIssue } from '../../manifest/validate';
import { getPrimitiveContract } from '../contracts';
import type { Primitive } from '../types';
import { startSiteFolders } from './activate';
import { startAIStudioFolders } from './aistudio/activate';
import { startGeminiFolders } from './gemini/activate';
import { siteFoldersFromData } from './siteData';

export type FoldersParams = Readonly<Record<string, never>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const foldersPrimitive: Primitive<FoldersParams> = {
  contract: getPrimitiveContract('folders')!,

  validateParams(raw: unknown) {
    if (raw !== undefined && !isRecord(raw)) {
      return { success: false, error: [{ path: 'params', message: 'must be an object' }] };
    }
    const issues: ManifestIssue[] = Object.keys(raw ?? {}).map((key) => ({
      path: `params.${key}`,
      message: 'unknown parameter',
    }));
    return issues.length > 0 ? { success: false, error: issues } : { success: true, data: {} };
  },

  activate(scope, _params, context) {
    const { adapter } = context;
    // Before any branch: the site id can come from a remote site.json, and only a page the
    // bundled data gives that site may open its bucket (Gemini's and AI Studio's included).
    const row = adapter?.folders ? folderSiteForPage(adapter.id, location.href) : null;
    if (!adapter?.folders || !row) {
      context.setTargetCounter(() => 0);
      return;
    }
    const { extension } = row;
    // Gemini's folders keep their own sidebar section, floating panel and native menus.
    if (extension === 'gemini') {
      const gemini = startGeminiFolders(scope, context.settings);
      context.setTargetCounter(() => gemini.onScreen());
      return { updateSettings: (settings) => gemini.updateSettings(settings) };
    }
    // AI Studio's folders keep their own panel and /library, on its core folder session.
    if (extension === 'aistudio' && adapter.folders) {
      const aistudio = startAIStudioFolders(
        scope,
        adapter.folders,
        context.settings,
        adapter.selectors,
      );
      context.setTargetCounter(() => aistudio?.onScreen() ?? 0);
      return aistudio
        ? { updateSettings: (settings) => aistudio.updateSettings(settings) }
        : undefined;
    }
    const site = siteFoldersFromData(adapter);
    if (!site) {
      context.setTargetCounter(() => 0);
      return;
    }
    const runtime = startSiteFolders(scope, site, context.settings, context.adapter);
    context.setTargetCounter(() => runtime.onScreen());
    return { updateSettings: (settings) => runtime.updateSettings(settings) };
  },
};
