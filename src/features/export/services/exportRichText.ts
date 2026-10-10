import {
  findExportCodeBlocks,
  extractExportCodeBlock,
  serializeListHtml,
} from './exportCodeBlocks';
import type { ExportContentDialect } from './exportContentDialect';
import {
  shouldSkipElement,
  stripExportArtifacts,
  normalizeText,
  escapeHtml,
  escapeHtmlAttribute,
} from './exportDomPolicy';

interface SerializedTableCell {
  text: string;
  hasFormulas: boolean;
}

interface SerializedTable {
  rows: string[][];
  hasFormulas: boolean;
}

export interface ProcessedInlineContent {
  html: string;
  text: string;
  hasFormulas: boolean;
  hasLeadingWhitespace: boolean;
  hasTrailingWhitespace: boolean;
}

export function processInlineContent(
  element: HTMLElement,
  adapter: Pick<ExportContentDialect, 'extractInlineFormula'>,
  forMarkdownTable = false,
): ProcessedInlineContent {
  let hasFormulas = false;
  const htmlParts: string[] = [];
  const textParts: string[] = [];

  const appendFormattedContent = (
    processed: ProcessedInlineContent,
    htmlTag: 'code' | 'em' | 'strong',
    serializeMarkdown: (text: string) => string,
  ): void => {
    if (processed.hasFormulas) hasFormulas = true;

    const leadingSpace = processed.hasLeadingWhitespace ? ' ' : '';
    const trailingSpace = processed.hasTrailingWhitespace ? ' ' : '';
    const hasBoundaryWhitespace = processed.hasLeadingWhitespace || processed.hasTrailingWhitespace;

    if (processed.html) {
      htmlParts.push(`${leadingSpace}<${htmlTag}>${processed.html}</${htmlTag}>${trailingSpace}`);
    } else if (hasBoundaryWhitespace) {
      htmlParts.push(' ');
    }

    if (processed.text) {
      textParts.push(`${leadingSpace}${serializeMarkdown(processed.text)}${trailingSpace}`);
    } else if (hasBoundaryWhitespace) {
      textParts.push(' ');
    }
  };

  // Process all child nodes including text nodes
  const processNode = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || '';
      if (text.trim()) {
        htmlParts.push(escapeHtml(text));
        textParts.push(text);
      } else if (text && (htmlParts.length > 0 || textParts.length > 0)) {
        // Whitespace-only nodes can be the only separator between adjacent
        // inline elements, for example <strong>high</strong> <em>risk</em>.
        htmlParts.push(' ');
        textParts.push(' ');
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;

      if (shouldSkipElement(el)) {
        return;
      }

      const formulaHtmlParts: string[] = [];
      const formulaTextParts: string[] = [];

      if (adapter.extractInlineFormula(el, formulaHtmlParts, formulaTextParts)) {
        hasFormulas = true;
        htmlParts.push(...formulaHtmlParts);

        const formulaMarkdown = formulaTextParts.join('');
        textParts.push(
          forMarkdownTable
            ? preserveLatexPipeCommandsInMarkdownTable(formulaMarkdown)
            : formulaMarkdown,
        );
        return;
      }

      // Emphasis
      if (el.tagName === 'I' || el.tagName === 'EM') {
        const processed = processInlineContent(el as HTMLElement, adapter, forMarkdownTable);
        appendFormattedContent(processed, 'em', (text) => `*${text}*`);
        return;
      }

      // Strong
      if (el.tagName === 'B' || el.tagName === 'STRONG') {
        const processed = processInlineContent(el as HTMLElement, adapter, forMarkdownTable);
        appendFormattedContent(processed, 'strong', (text) => `**${text}**`);
        return;
      }

      // Code
      if (el.tagName === 'CODE' && !el.closest('pre')) {
        const processed = processInlineCodeContent(el as HTMLElement);
        appendFormattedContent(processed, 'code', (text) =>
          serializeInlineCodeSpan(text, forMarkdownTable),
        );
        return;
      }

      // Inline images
      if (el.tagName === 'IMG') {
        const imgEl = el as HTMLImageElement;
        const src = imgEl.currentSrc || imgEl.src || imgEl.getAttribute('src') || '';
        if (src && src !== 'about:blank') {
          const alt = imgEl.alt || 'Image';
          htmlParts.push(
            `<img src="${escapeHtmlAttribute(src)}" alt="${escapeHtmlAttribute(alt)}" />`,
          );
          const mdAlt = alt.replace(/\]/g, '\\]');
          textParts.push(`![${mdAlt}](${src})`);
        }
        return;
      }

      // Recurse for other elements
      Array.from(el.childNodes).forEach(processNode);
    }
  };

  Array.from(element.childNodes).forEach(processNode);

  const rawHtml = htmlParts.join('');
  const rawText = textParts.join('');

  return {
    html: rawHtml.trim(),
    text: rawText.trim(),
    hasFormulas,
    hasLeadingWhitespace: /^\s/.test(rawText),
    hasTrailingWhitespace: /\s$/.test(rawText),
  };
}

function processInlineCodeContent(element: HTMLElement): ProcessedInlineContent {
  const textParts: string[] = [];

  const collectText = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      textParts.push(node.textContent || '');
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const child = node as Element;
    if (shouldSkipElement(child)) return;

    Array.from(child.childNodes).forEach(collectText);
  };

  Array.from(element.childNodes).forEach(collectText);

  const rawText = textParts.join('');
  const text = rawText.trim();

  return {
    html: escapeHtml(text),
    text,
    hasFormulas: false,
    hasLeadingWhitespace: /^\s/.test(rawText),
    hasTrailingWhitespace: /\s$/.test(rawText),
  };
}

function serializeInlineCodeSpan(text: string, forMarkdownTable = false): string {
  const needsTableSafeHtml =
    forMarkdownTable &&
    (/\\+\|/.test(text) || (text.includes('|') && normalizeText(text) !== text));

  if (needsTableSafeHtml) {
    // Marked continues parsing Markdown inside raw inline HTML. Encode every
    // code point so backslashes and collapsible whitespace stay literal.
    const escapedCode = Array.from(
      text,
      (character) => `&#x${character.codePointAt(0)!.toString(16)};`,
    ).join('');

    return `<code>${escapedCode}</code>`;
  }

  const longestBacktickRun = (text.match(/`+/g) ?? []).reduce(
    (longest, run) => Math.max(longest, run.length),
    0,
  );
  const delimiter = '`'.repeat(longestBacktickRun + 1);
  const needsPadding =
    text.startsWith('`') ||
    text.endsWith('`') ||
    (text.startsWith(' ') && text.endsWith(' ') && text.trim() !== '');
  const padding = needsPadding ? ' ' : '';

  return `${delimiter}${padding}${text}${padding}${delimiter}`;
}

export function extractTable(
  element: HTMLElement,
  adapter: Pick<ExportContentDialect, 'extractInlineFormula'>,
): {
  html: string;
  text: string;
  hasFormulas: boolean;
} {
  // Accept either a container that holds a <table>, or a <table> element itself
  let table: HTMLTableElement | null = null;
  if (element.tagName && element.tagName.toLowerCase() === 'table') {
    table = element as HTMLTableElement;
  } else {
    table = element.querySelector('table') as HTMLTableElement | null;
  }
  if (!table) {
    return { html: '', text: '', hasFormulas: false };
  }

  // Extract HTML (clean version)
  const cleanTable = table.cloneNode(true) as HTMLElement;
  stripExportArtifacts(cleanTable);

  // Convert to Markdown
  const rowCells: Element[][] = [];
  const headerCells = Array.from(table.querySelectorAll('thead tr td, thead tr th'));
  if (headerCells.length > 0) {
    rowCells.push(headerCells);
  }

  const bodyRows = table.querySelectorAll('tbody tr');
  bodyRows.forEach((row) => {
    rowCells.push(Array.from(row.querySelectorAll('td, th')));
  });
  const serializedTable = serializeTableRows(rowCells, adapter);

  // Build Markdown table
  const markdownLines: string[] = [];
  if (serializedTable.rows.length > 0) {
    // Header
    markdownLines.push('| ' + serializedTable.rows[0].join(' | ') + ' |');
    markdownLines.push('| ' + serializedTable.rows[0].map(() => '---').join(' | ') + ' |');
    // Body
    for (let i = 1; i < serializedTable.rows.length; i++) {
      markdownLines.push('| ' + serializedTable.rows[i].join(' | ') + ' |');
    }
  }

  return {
    html: cleanTable.outerHTML,
    text: markdownLines.join('\n'),
    hasFormulas: serializedTable.hasFormulas,
  };
}

function serializeTableRows(
  rowCells: Element[][],
  adapter: Pick<ExportContentDialect, 'extractInlineFormula'>,
): SerializedTable {
  let hasFormulas = false;
  const rows = rowCells.map((cells) =>
    cells.map((cell) => {
      const serializedCell = serializeTableCell(cell as HTMLElement, adapter);
      if (serializedCell.hasFormulas) hasFormulas = true;
      return serializedCell.text;
    }),
  );

  return { rows, hasFormulas };
}

function serializeTableCell(
  cell: HTMLElement,
  adapter: Pick<ExportContentDialect, 'extractInlineFormula'>,
): SerializedTableCell {
  const processed = processInlineContent(cell, adapter, true);

  return {
    text: escapeMarkdownTableCell(normalizeText(processed.text)),
    hasFormulas: processed.hasFormulas,
  };
}

function escapeMarkdownTableCell(text: string): string {
  return text.replace(/(\\*)\|/g, (_match, backslashes: string) => {
    return `${'\\'.repeat(backslashes.length * 2 + 1)}|`;
  });
}

function preserveLatexPipeCommandsInMarkdownTable(latex: string): string {
  return latex.replace(/\\+\|/g, (command) => {
    return command === '\\|' ? '\\Vert{}' : command;
  });
}

type ListDialect = Pick<ExportContentDialect, 'extractInlineFormula' | 'extractCodeBlock'>;

/** The host's own block-code reading of an element, or null when the host does not claim it. */
function readHostCodeBlock(
  element: Element,
  adapter: ListDialect,
): { html: string; text: string } | null {
  const htmlParts: string[] = [];
  const textParts: string[] = [];
  const flags = { hasImages: false, hasFormulas: false, hasTables: false, hasCode: false };
  if (!adapter.extractCodeBlock(element, htmlParts, textParts, flags, element.localName)) {
    return null;
  }
  return { html: htmlParts.join(''), text: flags.hasCode ? textParts.join('').trim() : '' };
}

function containsHostCodeBlock(element: Element, adapter: ListDialect): boolean {
  return Array.from(element.querySelectorAll('*')).some(
    (descendant) => readHostCodeBlock(descendant, adapter) !== null,
  );
}

export function extractList(
  element: HTMLElement,
  adapter: ListDialect,
  depth: number = 0,
): { html: string; text: string; hasFormulas: boolean; hasCode: boolean } {
  const isOrdered = element.tagName === 'OL';
  const orderedStart = isOrdered ? (element as HTMLOListElement).start : 1;
  const items = Array.from(element.querySelectorAll(':scope > li'));
  const indent = '  '.repeat(depth); // 2 spaces per level

  const textLines: string[] = [];
  let hasFormulas = false;
  let hasCode = false;
  items.forEach((item, index) => {
    const prefix = isOrdered ? `${orderedStart + index}. ` : '- ';
    const continuationIndent = indent + ' '.repeat(prefix.length);
    let hasItemContent = false;
    let proseNodes: Node[] = [];

    const ensureItemMarker = (): void => {
      if (!hasItemContent) {
        textLines.push(indent + prefix.trimEnd());
        hasItemContent = true;
      }
    };

    const flushProse = (): void => {
      if (proseNodes.length === 0) return;

      const proseContainer = document.createElement('div');
      proseNodes.forEach((node) => proseContainer.appendChild(node.cloneNode(true)));
      proseNodes = [];

      const processed = processInlineContent(proseContainer, adapter);
      if (processed.hasFormulas) hasFormulas = true;
      const prose = normalizeText(processed.text || proseContainer.textContent || '');
      if (!prose) return;

      textLines.push((hasItemContent ? continuationIndent : indent + prefix) + prose);
      hasItemContent = true;
    };

    const pushCodeBlock = (fenced: string): void => {
      ensureItemMarker();
      hasCode = true;
      textLines.push(
        fenced
          .split('\n')
          .map((line) => continuationIndent + line)
          .join('\n'),
      );
    };

    const processItemNodes = (nodes: Node[]): void => {
      nodes.forEach((node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) {
          proseNodes.push(node);
          return;
        }

        const child = node as HTMLElement;
        if (child.tagName === 'UL' || child.tagName === 'OL') {
          flushProse();
          const nestedResult = extractList(child, adapter, depth + 1);
          if (nestedResult.hasFormulas) hasFormulas = true;
          if (nestedResult.hasCode) hasCode = true;
          if (nestedResult.text) {
            ensureItemMarker();
            textLines.push(nestedResult.text);
          }
          return;
        }

        const exportCodeBlocks = findExportCodeBlocks(child);
        const directExportCodeBlock = exportCodeBlocks.find((element) => element === child);
        if (directExportCodeBlock) {
          flushProse();
          const content = extractExportCodeBlock(directExportCodeBlock);
          if (content?.text) pushCodeBlock(content.text);
          return;
        }

        // Hosts whose blocks have no shared selector (ChatGPT's div or pre) read them through
        // their adapter, or the list flattens the code into prose with its header label.
        const hostCodeBlock = readHostCodeBlock(child, adapter);
        if (hostCodeBlock) {
          flushProse();
          if (hostCodeBlock.text) pushCodeBlock(hostCodeBlock.text);
          return;
        }

        if (
          exportCodeBlocks.length > 0 ||
          child.querySelector('ul, ol') ||
          containsHostCodeBlock(child, adapter)
        ) {
          flushProse();
          processItemNodes(Array.from(child.childNodes));
          return;
        }

        proseNodes.push(node);
      });
    };

    processItemNodes(Array.from(item.childNodes));

    flushProse();
    if (!hasItemContent) {
      textLines.push(indent + prefix);
    }
  });

  const html = serializeListHtml(
    element,
    (block) => readHostCodeBlock(block, adapter)?.html || null,
  );

  return {
    hasFormulas,
    hasCode,
    html,
    text: textLines.join('\n'),
  };
}
