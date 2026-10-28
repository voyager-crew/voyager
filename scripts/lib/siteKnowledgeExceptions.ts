import { BACKGROUND_SITE_KNOWLEDGE_EXCEPTIONS } from './siteKnowledgeExceptions/background';
import { CONTENT_SITE_KNOWLEDGE_EXCEPTIONS } from './siteKnowledgeExceptions/content';
import { CONTENT_EXPORT_SITE_KNOWLEDGE_EXCEPTIONS } from './siteKnowledgeExceptions/contentExport';
import { CONTENT_FOLDERS_SITE_KNOWLEDGE_EXCEPTIONS } from './siteKnowledgeExceptions/contentFolders';
import { CORE_SITE_KNOWLEDGE_EXCEPTIONS } from './siteKnowledgeExceptions/core';
import { FEATURES_SITE_KNOWLEDGE_EXCEPTIONS } from './siteKnowledgeExceptions/features';
import { PLUGINS_SITE_KNOWLEDGE_EXCEPTIONS } from './siteKnowledgeExceptions/plugins';
import { POPUP_SITE_KNOWLEDGE_EXCEPTIONS } from './siteKnowledgeExceptions/popup';
import type { SiteKnowledgeException, SiteKnowledgeTable } from './siteKnowledgeTypes';

/** Today's reviewed shared knowledge; every file/site pair must retain its exact count. */
export const SITE_KNOWLEDGE_EXCEPTION_TABLES: readonly SiteKnowledgeTable<SiteKnowledgeException>[] =
  [
    {
      file: 'scripts/lib/siteKnowledgeExceptions/background.ts',
      entries: BACKGROUND_SITE_KNOWLEDGE_EXCEPTIONS,
    },
    {
      file: 'scripts/lib/siteKnowledgeExceptions/content.ts',
      entries: CONTENT_SITE_KNOWLEDGE_EXCEPTIONS,
    },
    {
      file: 'scripts/lib/siteKnowledgeExceptions/contentExport.ts',
      entries: CONTENT_EXPORT_SITE_KNOWLEDGE_EXCEPTIONS,
    },
    {
      file: 'scripts/lib/siteKnowledgeExceptions/contentFolders.ts',
      entries: CONTENT_FOLDERS_SITE_KNOWLEDGE_EXCEPTIONS,
    },
    {
      file: 'scripts/lib/siteKnowledgeExceptions/core.ts',
      entries: CORE_SITE_KNOWLEDGE_EXCEPTIONS,
    },
    {
      file: 'scripts/lib/siteKnowledgeExceptions/features.ts',
      entries: FEATURES_SITE_KNOWLEDGE_EXCEPTIONS,
    },
    {
      file: 'scripts/lib/siteKnowledgeExceptions/plugins.ts',
      entries: PLUGINS_SITE_KNOWLEDGE_EXCEPTIONS,
    },
    {
      file: 'scripts/lib/siteKnowledgeExceptions/popup.ts',
      entries: POPUP_SITE_KNOWLEDGE_EXCEPTIONS,
    },
  ];
