import type { FolderSkin } from '@/features/plugins/sites/sections/folderSkinData';
import inlineTreeCss from '@/pages/content/folder/floatingTree/inlineTree.css?raw';

import chromeCss from './sectionChrome.css?raw';
import treeCss from './sectionTree.css?raw';
import { folderSkinCss } from './skinCss';

/** The class the shared section sheets are written against. */
const TEMPLATE_CLASS = 'gv-site-folder-section';

/**
 * The sidebar section's sheet for host class `className`: the shared inline
 * tree, the section chrome (host, header, search and selection) and the tree's
 * tokens, then the site's validated colour and metric tokens, which follow
 * so they win.
 */
export function siteSectionCss(className: string, skin?: FolderSkin): string {
  const shared = `${chromeCss}\n${treeCss}`.replaceAll(TEMPLATE_CLASS, className);
  const sheet = `${inlineTreeCss}\n${shared}`;
  return skin ? `${sheet}\n${folderSkinCss(className, skin)}` : sheet;
}
