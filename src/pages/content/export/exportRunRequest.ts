/** What the export dialog asks one run for; serialized as pending state across a reload. */
import type { ExportFormat, ExportSpeakerLabels } from '../../../features/export/types/export';

export interface ExportRunRequest {
  format: ExportFormat;
  fontSize?: number;
  imageWidth?: number;
  usePromptAsTurnHeading?: boolean;
  markdownTextOnly?: boolean;
  speakerLabels?: ExportSpeakerLabels;
  /** Message to preselect in the selection session. */
  initialSelectedMessageId?: string;
}
