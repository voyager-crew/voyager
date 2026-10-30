import type { ChatTurn, ConversationMetadata, ExportSpeakerLabels } from '../types/export';
import { resolvePDFPrintTitle } from './pdfPrintTitles';

export const PDF_PRINT_CONTAINER_ID = 'gv-pdf-print-container';

/**
 * Create HTML container for printing
 */
export function createPDFPrintContainer(
  turns: ChatTurn[],
  metadata: ConversationMetadata,
  speakerLabels: ExportSpeakerLabels,
): HTMLElement {
  const container = document.createElement('div');
  container.id = PDF_PRINT_CONTAINER_ID;
  container.className = 'gv-print-only';
  // A host's print CSS can hide every body child but its own print copy with a
  // layered !important (ChatGPT inserts one on beforeprint), which outranks any
  // unlayered rule. Only an inline !important outranks it; the screen rule in
  // pdfPrintStyles keeps the container off screen until it prints.
  container.style.setProperty('display', 'block', 'important');

  // Build HTML content
  container.innerHTML = `
      <div class="gv-print-document">
        ${renderHeader(metadata)}
        ${renderContent(turns, speakerLabels)}
        ${renderFooter(metadata)}
      </div>
    `;
  return container;
}

/**
 * Render document header with cover page
 */
function renderHeader(metadata: ConversationMetadata): string {
  const conversationTitle = resolvePDFPrintTitle(metadata, 'cover');
  // For PDF, avoid repeating the same title in smaller text under the H1.
  // Always derive a neutral "source" label from the URL instead of using metadata.title.
  const urlTitle = extractTitleFromURL(metadata.url, metadata.platform);
  const date = formatDate(metadata.exportedAt);
  const turnsCount = metadata.count;

  return `
      <div class="gv-print-header gv-print-cover-page">
        <div class="gv-print-cover-content">
          <h1 class="gv-print-cover-title">${escapeHTML(conversationTitle)}</h1>
          <div class="gv-print-meta">
            <p>${date}</p>
            <p><a href="${escapeAttribute(metadata.url)}">${escapeHTML(urlTitle)}</a></p>
            <p>${turnsCount} conversation turns</p>
          </div>
        </div>
      </div>
    `;
}

/**
 * Render conversation content
 */
function renderContent(turns: ChatTurn[], speakerLabels: ExportSpeakerLabels): string {
  return `
      <div class="gv-print-content">
        ${turns.map((turn, index) => renderTurn(turn, index + 1, speakerLabels)).join('\n')}
      </div>
    `;
}

/**
 * Render a single turn
 */
function renderTurn(turn: ChatTurn, index: number, speakerLabels: ExportSpeakerLabels): string {
  const starredClass = turn.starred ? 'gv-print-turn-starred' : '';

  // A message read from the page that yielded no HTML prints as empty, not as
  // its plain text; only turns that never had a page element use the text.
  const userContent =
    turn.userContent?.html ||
    (turn.userElement ? '' : formatContent(turn.user)) ||
    '<em>No content</em>';

  const assistantContent =
    turn.assistantContent?.html ||
    (turn.assistantElement ? '' : formatContent(turn.assistant)) ||
    '<em>No content</em>';

  if (!turn.omitEmptySections) {
    return `
      <div class="gv-print-turn ${starredClass}">
        <div class="gv-print-turn-header">
          <span class="gv-print-turn-number">Turn ${index}</span>
          ${turn.starred ? '<span class="gv-print-star">⭐</span>' : ''}
        </div>

        <div class="gv-print-turn-user">
          <div class="gv-print-turn-label">👤 ${escapeHTML(speakerLabels.user)}</div>
          <div class="gv-print-turn-text">${userContent}</div>
        </div>

        <div class="gv-print-turn-assistant">
          <div class="gv-print-turn-label">🤖 ${escapeHTML(speakerLabels.assistant)}</div>
          <div class="gv-print-turn-text">${assistantContent}</div>
        </div>
      </div>
    `;
  }

  const hasUser = !!turn.userContent || !!turn.user.trim();
  const hasAssistant = !!turn.assistantContent || !!turn.assistant.trim();

  return `
      <div class="gv-print-turn ${starredClass}">
        <div class="gv-print-turn-header">
          <span class="gv-print-turn-number">Turn ${index}</span>
          ${turn.starred ? '<span class="gv-print-star">⭐</span>' : ''}
        </div>

        ${
          hasUser
            ? `
        <div class="gv-print-turn-user">
          <div class="gv-print-turn-label">👤 ${escapeHTML(speakerLabels.user)}</div>
          <div class="gv-print-turn-text">${userContent}</div>
        </div>
        `
            : ''
        }

        ${
          hasAssistant
            ? `
          <div class="gv-print-turn-assistant">
            <div class="gv-print-turn-label">🤖 ${escapeHTML(speakerLabels.assistant)}</div>
            <div class="gv-print-turn-text">${assistantContent}</div>
          </div>
        `
            : ''
        }
      </div>
    `;
}

/**
 * Format content for HTML output
 */
function formatContent(content: string): string {
  if (!content) return '<em>No content</em>';

  // Escape HTML but preserve line breaks
  let formatted = escapeHTML(content);

  // Convert double line breaks to paragraphs
  formatted = formatted
    .split('\n\n')
    .map((para) => `<p>${para.replace(/\n/g, '<br>')}</p>`)
    .join('');

  return formatted;
}

/**
 * Render footer
 */
function renderFooter(metadata: ConversationMetadata): string {
  return `
      <div class="gv-print-footer">
        <p>Exported from <a href="https://github.com/voyager-crew/voyager">Voyager</a> • ${metadata.count} conversation turns</p>
        <p>Generated on ${formatDate(metadata.exportedAt)}</p>
      </div>
    `;
}

/**
 * Helper: Extract title from URL
 */
function extractTitleFromURL(url: string, platform?: string): string {
  const name = platform || 'Gemini';
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const match = pathname.match(/\/(app|chat|c)\/([^/]+)/);
    if (match) {
      const id = match[2];
      return `${name} Conversation ${id.substring(0, 8)}`;
    }
    return `${name} Conversation`;
  } catch {
    return `${name} Conversation`;
  }
}

/**
 * Helper: Format date
 */
function formatDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
}

/**
 * Helper: Escape HTML
 */
function escapeHTML(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttribute(text: string): string {
  return escapeHTML(text).replace(/"/g, '&quot;');
}
