import { logger } from '@/core/services/LoggerService';

/**
 * File download module for Deep Research exports
 */

/**
 * Generate filename with timestamp
 */
export function generateFilename(): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const d = new Date();
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  const seconds = pad(d.getSeconds());

  return `deep-research-thinking-${year}${month}${day}-${hours}${minutes}${seconds}.md`;
}

/**
 * Download markdown content as file
 */
export function downloadMarkdown(content: string): void {
  try {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = generateFilename();

    // Append to body, click, and remove
    document.body.appendChild(a);
    a.click();

    // Cleanup
    setTimeout(() => {
      try {
        document.body.removeChild(a);
      } catch (error) {
        console.error('[Gemini Voyager] Error removing download link:', error);
      }
      URL.revokeObjectURL(url);
    }, 100);

    logger.info('Deep Research thinking content downloaded');
  } catch (error) {
    console.error('[Gemini Voyager] Error downloading markdown:', error);
  }
}
