/** getRandomValues also works on authorized plain-HTTP custom sites. */
export function createMermaidId(): string {
  const values = crypto.getRandomValues(new Uint32Array(4));
  return `mermaid-${Array.from(values, (value) => value.toString(16).padStart(8, '0')).join('')}`;
}
