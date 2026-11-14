/** What the export dialog is shown with: its callbacks, initial choices and copy. */
import type {
  ExportFormat,
  ExportSpeakerLabelOverrides,
  ExportSpeakerLabels,
  ImageExportWidth,
} from '../types/export';

export interface ExportDialogOptions {
  onExport: (
    format: ExportFormat,
    fontSize?: number,
    imageWidth?: number,
    usePromptAsTurnHeading?: boolean,
    speakerLabels?: ExportSpeakerLabels,
    speakerLabelOverrides?: ExportSpeakerLabelOverrides,
    markdownTextOnly?: boolean,
  ) => void;
  onCancel: () => void;
  onSpeakerLabelOverridesChange?: (overrides: ExportSpeakerLabelOverrides) => void;
  initialImageWidth?: ImageExportWidth;
  showPromptHeadingOption?: boolean;
  /** Offer the Markdown "text only" switch; only where the export honours `markdownTextOnly`. */
  showTextOnlyOption?: boolean;
  initialSpeakerLabelOverrides?: ExportSpeakerLabelOverrides;
  speakerLabelsEnabled?: boolean;
  speakerNames?: {
    title: string;
    userLabel: string;
    assistantLabel: string;
    userDefault: string;
    assistantDefault: string;
  };
  translations: {
    title: string;
    selectFormat: string;
    warning: string;
    safariCmdpHint: string;
    safariMarkdownHint: string;
    cancel: string;
    export: string;
    fontSizeLabel: string;
    fontSizePreview: string;
    imageWidthLabel: string;
    imageWidthNarrow: string;
    imageWidthMedium: string;
    imageWidthWide: string;
    promptHeadingLabel: string;
    promptHeadingHint: string;
    textOnlyLabel?: string;
    textOnlyHint?: string;
    formatRecommended: string;
    formatDescriptions: Record<ExportFormat, string>;
  };
}
