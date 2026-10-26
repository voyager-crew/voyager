import aistudio from '@/features/plugins/catalog/sites/aistudio/selector-data/content-packaged.json';
import chatgpt from '@/features/plugins/catalog/sites/chatgpt/selector-data/content-packaged.json';
import claude from '@/features/plugins/catalog/sites/claude/selector-data/content-packaged.json';
import deepseek from '@/features/plugins/catalog/sites/deepseek/selector-data/content-packaged.json';
import gemini from '@/features/plugins/catalog/sites/gemini/selector-data/content-packaged.json';
import kimi from '@/features/plugins/catalog/sites/kimi/selector-data/content-packaged.json';

export type ExportReadProfiles = Readonly<
  Record<
    | 'export.messageContent'
    | 'export.thoughts'
    | 'export.fallbackClass'
    | 'export.walkMarkdown'
    | 'export.rawCode'
    | 'export.codeOwner'
    | 'export.responseOwner'
    | 'export.sourcePrompt'
    | 'export.sourcePromptMarkup'
    | 'export.collectorAnswer'
    | 'export.menuResponseOwner'
    | 'export.userLinesFallback'
    | 'export.attachmentPreviewOwner',
    string
  >
>;

const PROFILES: Readonly<Record<string, ExportReadProfiles>> = {
  gemini,
  aistudio,
  chatgpt,
  claude,
  deepseek,
  kimi,
};

export function getExportReadProfiles(siteId: string = 'gemini'): ExportReadProfiles {
  return Object.hasOwn(PROFILES, siteId) ? PROFILES[siteId] : gemini;
}
