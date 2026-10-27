/** Hands a file to the browser and releases its object URL on the next task or owner teardown. */
export function downloadPromptFile(
  data: string,
  filename: string,
  mimeType: string,
  signal: AbortSignal,
): void {
  if (signal.aborted) return;
  const url = URL.createObjectURL(new Blob([data], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();

  function release(): void {
    window.clearTimeout(timer);
    signal.removeEventListener('abort', release);
    URL.revokeObjectURL(url);
  }
  // Teardown must release the URL too, rather than only cancelling its deferred cleanup.
  const timer = window.setTimeout(release, 0);
  signal.addEventListener('abort', release, { once: true });
}
