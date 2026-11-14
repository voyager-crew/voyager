/**
 * Text-only Markdown: drops every image embed so the export needs no assets
 * and downloads as one .md file. Alt text goes with the image (it is mostly a
 * placeholder such as "Image" or "Uploaded image 1"); captions and source lines
 * are their own text and stay. Code blocks and inline code are left untouched.
 */

const DESTINATION = String.raw`\([^)\s]*(?:\s+"[^"]*")?\)`;
const IMAGE = String.raw`!\[(?:\\.|[^\]\\])*\]` + DESTINATION;
/** An inline code span (kept as is), a link wrapping only an image, or an image. */
const CODE_SPAN_OR_IMAGE = new RegExp(
  String.raw`(\`+)[^\`]*?\1|\[\s*` + IMAGE + String.raw`\s*\]` + DESTINATION + '|' + IMAGE,
  'g',
);
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

function stripLineImages(line: string): string {
  const stripped = line.replace(CODE_SPAN_OR_IMAGE, (match: string, ticks: string | undefined) =>
    ticks ? match : '',
  );
  // An image between two words leaves a double space behind.
  return stripped === line ? line : stripped.replace(/(\S) {2,}(?=\S)/g, '$1 ').trimEnd();
}

export function stripMarkdownImages(markdown: string): string {
  const output: string[] = [];
  let fence: string | null = null;
  let droppedSinceKept = false;

  for (const line of markdown.split('\n')) {
    if (fence) {
      output.push(line);
      if (line.trim().startsWith(fence) && line.trim().replace(/[`~]/g, '') === '') fence = null;
      continue;
    }
    const opened = FENCE_OPEN.exec(line);
    if (opened) {
      fence = opened[1];
      output.push(line);
      droppedSinceKept = false;
      continue;
    }

    const stripped = stripLineImages(line);
    if (stripped !== line && stripped.trim() === '') {
      droppedSinceKept = true;
      continue;
    }
    // A dropped image line must not leave two blank lines where there was one.
    if (stripped.trim() === '' && droppedSinceKept && output[output.length - 1]?.trim() === '') {
      continue;
    }
    output.push(stripped);
    droppedSinceKept = droppedSinceKept && stripped.trim() === '';
  }

  return output.join('\n');
}
