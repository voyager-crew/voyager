/** The export dialog's Markdown-only on/off rows: prompt heading and text only. */

/** A Markdown-only on/off option, shown while Markdown is selected when `enabled`. */
export function createMarkdownSwitchSection(
  className: string,
  enabled: boolean,
  labelText: string,
  hintText: string,
  onToggle: (checked: boolean) => void,
): HTMLElement {
  const section = document.createElement('div');
  section.className = `${className} gv-export-markdown-switch-section`;
  section.dataset.enabled = enabled ? 'true' : 'false';
  section.style.display = enabled ? 'flex' : 'none';

  const copy = document.createElement('div');
  copy.className = 'gv-export-prompt-heading-copy';

  const label = document.createElement('div');
  label.className = 'gv-export-fontsize-label gv-export-prompt-heading-label';
  label.textContent = labelText;

  const hint = document.createElement('div');
  hint.className = 'gv-export-format-description gv-export-prompt-heading-hint';
  hint.textContent = hintText;

  copy.appendChild(label);
  copy.appendChild(hint);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'gv-coach-switch gv-export-prompt-heading-switch';
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-label', labelText);
  toggle.setAttribute('aria-checked', 'false');

  const knob = document.createElement('span');
  knob.className = 'gv-coach-knob';
  toggle.appendChild(knob);

  let checked = false;
  toggle.addEventListener('click', () => {
    checked = !checked;
    onToggle(checked);
    toggle.setAttribute('aria-checked', checked ? 'true' : 'false');
  });

  section.appendChild(copy);
  section.appendChild(toggle);
  return section;
}
