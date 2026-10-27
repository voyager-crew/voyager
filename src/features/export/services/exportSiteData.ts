import shared from './shared-content.json';

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

/** Baseline shared serialization grammar, independent of every site's locator catalog. */
export function getExportReadProfiles(_siteId?: string): ExportReadProfiles {
  return shared;
}
