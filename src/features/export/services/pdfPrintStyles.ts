import { buildKatexExportStyles } from './katexExportStyles';
import { buildListExportStyles } from './listExportStyles';
import { buildMermaidExportStyles } from './mermaidExportStyles';
import { PDF_PRINT_CONTAINER_ID } from './pdfPrintDocument';

export const PDF_PRINT_STYLES_ID = 'gv-pdf-print-styles';
export const PDF_PRINT_BODY_CLASS = 'gv-pdf-printing';

/**
 * Inject print-optimized styles
 */
export function injectPDFPrintStyles(fontSize?: number): void {
  // Check if already injected
  if (document.getElementById(PDF_PRINT_STYLES_ID)) return;

  const basePt = fontSize ?? 11;
  const codePt = Math.max(basePt - 2, 6);
  const footerPt = Math.max(basePt - 2, 6);

  const style = document.createElement('style');
  style.id = PDF_PRINT_STYLES_ID;
  style.textContent = `
      /* Hide print container on screen */
      .gv-print-only {
        display: none;
      }

      /* Its inline display wins on screen too, so it waits off screen instead */
      @media screen {
        #${PDF_PRINT_CONTAINER_ID} {
          position: fixed !important;
          top: 0 !important;
          left: -200vw !important;
          width: 100vw !important;
          pointer-events: none !important;
        }
      }

      /* Show print container when printing */
      @media print {
        /* Hide everything except print container */
        body.${PDF_PRINT_BODY_CLASS} > *:not(#${PDF_PRINT_CONTAINER_ID}) {
          display: none !important;
          visibility: hidden !important;
        }

        body.${PDF_PRINT_BODY_CLASS} #${PDF_PRINT_CONTAINER_ID} {
          display: block !important;
          visibility: visible !important;
        }

        body.${PDF_PRINT_BODY_CLASS} #${PDF_PRINT_CONTAINER_ID},
        body.${PDF_PRINT_BODY_CLASS} #${PDF_PRINT_CONTAINER_ID} * {
          visibility: visible !important;
        }

        /* Force white print canvas to avoid dark-theme background leaks on trailing pages */
        html,
        body {
          background: #fff !important;
        }

        body.${PDF_PRINT_BODY_CLASS} {
          background: #fff !important;
        }

        /* Gemini immersive-mode print CSS may force descendants to display:none */
        body.${PDF_PRINT_BODY_CLASS} #${PDF_PRINT_CONTAINER_ID} * {
          display: revert !important;
        }

        ${buildKatexExportStyles(`body.${PDF_PRINT_BODY_CLASS} #${PDF_PRINT_CONTAINER_ID}`, true)}

        /* Preserve KaTeX layout primitives after the global display override above.
           Without these, sub/sup scripts (e.g. x_1) may become misaligned in PDF print. */
        body.${PDF_PRINT_BODY_CLASS} #${PDF_PRINT_CONTAINER_ID} .katex-display,
        body.${PDF_PRINT_BODY_CLASS} #${PDF_PRINT_CONTAINER_ID} .katex-display > .katex,
        body.${PDF_PRINT_BODY_CLASS} #${PDF_PRINT_CONTAINER_ID} .katex-display > .katex > .katex-html {
          display: block !important;
        }

        body.${PDF_PRINT_BODY_CLASS} #${PDF_PRINT_CONTAINER_ID} .katex .base,
        body.${PDF_PRINT_BODY_CLASS} #${PDF_PRINT_CONTAINER_ID} .katex .strut,
        body.${PDF_PRINT_BODY_CLASS} #${PDF_PRINT_CONTAINER_ID} .katex .vlist > span > span,
        body.${PDF_PRINT_BODY_CLASS} #${PDF_PRINT_CONTAINER_ID} .katex .mspace,
        body.${PDF_PRINT_BODY_CLASS} #${PDF_PRINT_CONTAINER_ID} .katex .mfrac .frac-line,
        body.${PDF_PRINT_BODY_CLASS} #${PDF_PRINT_CONTAINER_ID} .katex .rule,
        body.${PDF_PRINT_BODY_CLASS} #${PDF_PRINT_CONTAINER_ID} .katex .hline,
        body.${PDF_PRINT_BODY_CLASS} #${PDF_PRINT_CONTAINER_ID} .katex .hdashline,
        body.${PDF_PRINT_BODY_CLASS} #${PDF_PRINT_CONTAINER_ID} .katex .overline .overline-line,
        body.${PDF_PRINT_BODY_CLASS} #${PDF_PRINT_CONTAINER_ID} .katex .underline .underline-line,
        body.${PDF_PRINT_BODY_CLASS} #${PDF_PRINT_CONTAINER_ID} .katex .nulldelimiter,
        body.${PDF_PRINT_BODY_CLASS} #${PDF_PRINT_CONTAINER_ID} .katex .clap > .fix,
        body.${PDF_PRINT_BODY_CLASS} #${PDF_PRINT_CONTAINER_ID} .katex .llap > .fix,
        body.${PDF_PRINT_BODY_CLASS} #${PDF_PRINT_CONTAINER_ID} .katex .rlap > .fix,
        body.${PDF_PRINT_BODY_CLASS} #${PDF_PRINT_CONTAINER_ID} .katex .mtable .vertical-separator,
        body.${PDF_PRINT_BODY_CLASS} #${PDF_PRINT_CONTAINER_ID} .katex .mtable .arraycolsep,
        body.${PDF_PRINT_BODY_CLASS} #${PDF_PRINT_CONTAINER_ID} .katex .cd-vert-arrow,
        body.${PDF_PRINT_BODY_CLASS} #${PDF_PRINT_CONTAINER_ID} .katex .cd-label-left,
        body.${PDF_PRINT_BODY_CLASS} #${PDF_PRINT_CONTAINER_ID} .katex .cd-label-right {
          display: inline-block !important;
        }

        body.${PDF_PRINT_BODY_CLASS} #${PDF_PRINT_CONTAINER_ID} .katex .vlist-t {
          display: inline-table !important;
        }

        body.${PDF_PRINT_BODY_CLASS} #${PDF_PRINT_CONTAINER_ID} .katex .vlist-r {
          display: table-row !important;
        }

        body.${PDF_PRINT_BODY_CLASS} #${PDF_PRINT_CONTAINER_ID} .katex .vlist,
        body.${PDF_PRINT_BODY_CLASS} #${PDF_PRINT_CONTAINER_ID} .katex .vlist-s {
          display: table-cell !important;
        }

        body.${PDF_PRINT_BODY_CLASS} #${PDF_PRINT_CONTAINER_ID} .katex .vlist > span,
        body.${PDF_PRINT_BODY_CLASS} #${PDF_PRINT_CONTAINER_ID} .katex .katex-html > .newline,
        body.${PDF_PRINT_BODY_CLASS} #${PDF_PRINT_CONTAINER_ID} .katex .overlay,
        body.${PDF_PRINT_BODY_CLASS} #${PDF_PRINT_CONTAINER_ID} .katex svg,
        body.${PDF_PRINT_BODY_CLASS} #${PDF_PRINT_CONTAINER_ID} .katex .stretchy {
          display: block !important;
        }

        body.${PDF_PRINT_BODY_CLASS} #${PDF_PRINT_CONTAINER_ID} .katex .vbox,
        body.${PDF_PRINT_BODY_CLASS} #${PDF_PRINT_CONTAINER_ID} .katex .hbox,
        body.${PDF_PRINT_BODY_CLASS} #${PDF_PRINT_CONTAINER_ID} .katex .thinbox {
          display: inline-flex !important;
        }

        body.${PDF_PRINT_BODY_CLASS} #${PDF_PRINT_CONTAINER_ID} .gv-print-turn-text .katex {
          line-height: 1.2 !important;
        }

        /* Keep key layouts after the global descendant display override above */
        body.${PDF_PRINT_BODY_CLASS} #${PDF_PRINT_CONTAINER_ID} .gv-print-cover-page {
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
        }

        body.${PDF_PRINT_BODY_CLASS} #${PDF_PRINT_CONTAINER_ID} .gv-print-turn-header {
          display: flex !important;
        }

        body.${PDF_PRINT_BODY_CLASS} #${PDF_PRINT_CONTAINER_ID} .gv-print-turn-text img {
          display: block !important;
        }

        /* Reset page styles */
        @page {
          margin: 2cm;
          size: A4;
        }

        /* Document container */
        .gv-print-document {
          font-family: Georgia, 'Times New Roman', serif;
          font-size: ${basePt}pt;
          line-height: 1.6;
          color: #000;
          background: #fff;
          max-width: 100%;
        }

        /* Cover Page Header */
        .gv-print-cover-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          page-break-after: always;
          margin: 0;
          padding: 0;
          border: none;
        }

        .gv-print-cover-content {
          text-align: center;
          max-width: 80%;
        }

        .gv-print-cover-title {
          font-size: 36pt;
          font-weight: 800;
          letter-spacing: -0.02em;
          margin: 0 0 1.5em 0;
          color: oklch(0.7227 0.1920 149.5793);
          line-height: 1.2;
          word-wrap: break-word;
        }

        .gv-print-meta {
          font-size: 12pt;
          color: #666;
          line-height: 2;
          margin-top: 0.5em;
        }

        .gv-print-meta p {
          margin: 0.3em 0;
        }

        .gv-print-meta a {
          color: #666;
          text-decoration: none;
        }

        .gv-print-meta a:after {
          content: none !important;
        }

        /* Content */
        .gv-print-content {
          margin: 2em 0;
        }

        /* Turn */
        .gv-print-turn {
          margin-bottom: 2em;
          page-break-inside: avoid;
        }

        .gv-print-turn-header {
          display: flex;
          align-items: center;
          gap: 0.5em;
          margin-bottom: 0.5em;
          font-size: 12pt;
          font-weight: bold;
          color: #555;
        }

        .gv-print-turn-starred .gv-print-turn-header {
          color: #d97706;
        }

        .gv-print-star {
          font-size: 14pt;
        }

        /* Turn sections */
        .gv-print-turn-user,
        .gv-print-turn-assistant {
          margin: 1em 0;
        }

        .gv-print-turn-label {
          font-weight: 600;
          font-size: ${basePt}pt;
          margin-bottom: 0.5em;
          color: #222;
        }

        .gv-print-turn-text {
          padding-left: 1em;
          border-left: 3px solid #e5e7eb;
          color: #1a1a1a;
        }

        /* Constrain images to avoid oversized visuals */
        .gv-print-turn-text img {
          max-width: 60%;
          height: auto;
          display: block;
          margin: 0.5em 0;
          page-break-inside: avoid;
        }

        .gv-print-turn-text .gv-export-attachment {
          display: flex;
          align-items: center;
          gap: 0.55em;
          width: fit-content;
          max-width: 100%;
          margin: 0.5em 0;
          padding: 0.55em 0.75em;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          background: #f8fafc;
          page-break-inside: avoid;
        }

        .gv-print-turn-text .gv-export-attachment-icon {
          flex: none;
        }

        .gv-print-turn-text .gv-export-attachment-name {
          overflow-wrap: anywhere;
        }

        ${buildMermaidExportStyles('.gv-print-turn-text', {
          containerMargin: '1em auto',
          avoidContainerBreak: true,
          diagramSelector: '> img',
          importantDisplay: true,
          preservePrintBackground: true,
          diagramMaxHeight: '160mm',
        })}

        ${buildListExportStyles('.gv-print-turn-text', true)}

        .gv-print-turn-assistant .gv-print-turn-text {
          border-left-color: #93c5fd;
        }

        .gv-print-turn-text p {
          margin: 0.5em 0;
        }

        .gv-print-turn-text em {
          color: #666;
        }

        /* Code blocks (if any) */
        .gv-print-turn-text code,
        .gv-print-turn-text pre {
          font-family: 'Courier New', monospace;
          font-size: ${codePt}pt;
          background: #f5f5f5;
          padding: 0.2em 0.4em;
          border-radius: 3px;
        }

        .gv-print-turn-text pre {
          padding: 0.75em;
          border-left: 3px solid #d1d5db;
          overflow-x: auto;
          white-space: pre-wrap;
          word-wrap: break-word;
        }

        /* Math formulas */
        .gv-print-turn-text .math-inline,
        .gv-print-turn-text .math-block,
        .gv-print-turn-text [data-math] {
          page-break-inside: avoid;
        }

        .gv-print-turn-text .math-block {
          display: block;
          margin: 1em 0;
          text-align: center;
          overflow-x: auto;
        }

        .gv-print-turn-text .math-inline {
          display: inline;
        }

        /* Footer */
        .gv-print-footer {
          margin-top: 2em;
          padding-top: 1em;
          border-top: 1px solid #ccc;
          font-size: ${footerPt}pt;
          color: #666;
          text-align: center;
        }

        .gv-print-footer p {
          margin: 0.25em 0;
        }

        /* Links */
        a {
          color: #2563eb;
          text-decoration: none;
        }

        /* Hide Gemini inline source/citation chips (render as link icons) */
        sources-carousel-inline,
        source-inline-chips,
        source-inline-chip,
        .source-inline-chip-container {
          display: none !important;
        }

        a[href]:after {
          content: " (" attr(href) ")";
          font-size: ${footerPt}pt;
          color: #666;
        }

        /* Utilities */
        strong {
          font-weight: 600;
        }
      }
    `;

  document.head.appendChild(style);
}
