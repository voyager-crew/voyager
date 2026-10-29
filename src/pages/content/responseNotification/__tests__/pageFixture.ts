/** Gemini's stop button while it writes, visible so the completion run counts it. */
export function showStopButton(): HTMLButtonElement {
  const stop = document.createElement('button');
  stop.setAttribute('aria-label', 'Stop response');
  Object.defineProperty(stop, 'offsetWidth', { value: 20 });
  document.body.appendChild(stop);
  return stop;
}
