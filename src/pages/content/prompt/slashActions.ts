/**
 * The `/` menu's two entries after the prompts: "Manage prompts…" opens the
 * Prompt Manager panel (where prompts are added and edited) and "Voyager
 * panel…" opens the Voyager panel. They follow a bare `/` and any matching
 * prompts, or show alone when the typed name matches their own label, so a
 * `/path` typed in prose still closes the menu as before.
 */
import { getTranslationSync } from '@/utils/i18n';

import { voyagerPanelOpener } from '../panelShell/opener';
import { promptBall } from './promptBall';
import { type PromptQuery, createQueryRange, dispatchInput } from './slashComposerText';

export interface SlashAction {
  readonly label: string;
  readonly run: () => void;
}

/** Prompt Manager answers the ball and its panel can open next to it. */
function promptManagerReady(): boolean {
  const view = promptBall.view();
  return view?.answers === 'prompt-manager' && !view.hidden;
}

export function slashActionsFor(query: string, promptsMatched: boolean): SlashAction[] {
  const actions: SlashAction[] = [];
  if (promptManagerReady()) {
    actions.push({
      label: getTranslationSync('panelShellManagePrompts'),
      run: () => promptBall.openPromptManager(),
    });
  }
  if (voyagerPanelOpener.available()) {
    actions.push({
      label: getTranslationSync('panelShellOpenPanel'),
      run: () => voyagerPanelOpener.open(),
    });
  }
  const typed = query.trim().toLocaleLowerCase();
  if (!typed || promptsMatched) return actions;
  return actions.filter((action) => action.label.toLocaleLowerCase().includes(typed));
}

/** Takes the typed `/query` back out of the composer, then runs the entry. */
export function runSlashAction(action: SlashAction, query: PromptQuery): void {
  if (query.input instanceof HTMLTextAreaElement) {
    query.input.setRangeText('', query.start, query.end, 'end');
  } else {
    const range = createQueryRange(query);
    range?.deleteContents();
    const selection = window.getSelection();
    if (range && selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }
  dispatchInput(query.input);
  action.run();
}

export function renderSlashAction(
  action: SlashAction,
  selected: boolean,
  choose: () => void,
): HTMLButtonElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'gv-pm-slash-option gv-pm-slash-action';
  row.setAttribute('role', 'option');
  row.setAttribute('aria-selected', String(selected));
  const name = document.createElement('span');
  name.className = 'gv-pm-slash-option-name';
  name.textContent = action.label;
  row.appendChild(name);
  row.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    choose();
  });
  return row;
}
