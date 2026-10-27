import { chatgptPageData } from '@/features/plugins/builtin/chatgptPageData';
import chatgptSite from '@/features/plugins/catalog/sites/chatgpt/site.json';
/**
 * The chat/Work switch of a new chat or project page. Structure first: the
 * site's `pageHooks.modeSwitch` group holding exactly two buttons, in a known
 * order, the same in every UI language. Only when that is not found does the
 * pair's text (`pageHooks.modes.*.switchLabels`) stand in, in the shapes
 * measured before: on a project page, among buttons carrying the pressed
 * attribute (its chat view tab can read the same, 「聊天」); on the new-chat
 * page, two buttons carrying `data-state` close together.
 *
 * Only a switch found by structure, or a project's text-found pair, is read
 * for what it shows pressed; the new-chat page's text-found pair is only
 * clicked, as before (its `data-state` values were never measured).
 */
import type { PageHooksSection } from '@/features/plugins/sites/sections/pageHooksData';
import type { SiteAdapter } from '@/features/plugins/types';
import { isRendered } from '@/pages/content/export/adapter/chatgptThread';

import { allLabels } from './projectPage';

export type PressedMode = 'chat' | 'work' | 'unknown';

export interface ModeSwitch {
  readonly chat: HTMLButtonElement;
  readonly work: HTMLButtonElement;
  /** Whether what it shows pressed is evidence of the mode. */
  readonly readable: boolean;
}

/** How far up from one button of a text-found pair the other may sit. */
const PAIR_MAX_DEPTH = 3;
const HOME_STATE_ATTRIBUTE = chatgptPageData.modeHomeStateAttribute;
/** The project pair's pressed attribute when the site data has none. */
const DEFAULT_PRESSED_ATTRIBUTE = chatgptSite.pageHooks.modeSwitch.pressedAttribute;

function hooksOf(adapter: SiteAdapter | null): PageHooksSection | null {
  return adapter?.pageHooks ?? null;
}

/** The text a person sees (`innerText` skips visually hidden parts; jsdom only has `textContent`). */
function textOf(element: HTMLElement): string {
  return (element.innerText ?? element.textContent ?? '').trim();
}

function labels(hooks: PageHooksSection | null, mode: 'chat' | 'work'): readonly string[] {
  return hooks ? allLabels(hooks.modes[mode].switchLabels) : [];
}

/** The one rendered group holding exactly two rendered buttons, mapped by the site's order. */
export function findStructuredModeSwitch(hooks: PageHooksSection | null): ModeSwitch | null {
  if (!hooks) return null;
  const { group, button, order } = hooks.modeSwitch;
  const pairs = Array.from(document.querySelectorAll(group))
    .filter((element) => element instanceof HTMLElement && isRendered(element))
    .map((element) =>
      Array.from(element.querySelectorAll<HTMLButtonElement>(button)).filter(isRendered),
    )
    .filter((buttons) => buttons.length === 2);
  if (pairs.length !== 1) return null;
  const [first, second] = pairs[0];
  return order[0] === 'chat'
    ? { chat: first, work: second, readable: true }
    : { chat: second, work: first, readable: true };
}

/** The rendered buttons labelled `wanted` that carry `attribute`. */
function pressableButtons(
  root: ParentNode,
  wanted: readonly string[],
  attribute: string,
): HTMLButtonElement[] {
  return Array.from(
    root.querySelectorAll<HTMLButtonElement>(`${chatgptPageData.modeButton}[${attribute}]`),
  ).filter((button) => wanted.includes(textOf(button)) && isRendered(button));
}

/** The one such button nearest to `anchor`, within a few ancestors; else null. */
function partnerOf(
  anchor: HTMLElement,
  wanted: readonly string[],
  attribute: string,
): HTMLButtonElement | null {
  let container: Element | null = anchor.parentElement;
  for (let depth = 1; container && depth <= PAIR_MAX_DEPTH; depth += 1) {
    const near = pressableButtons(container, wanted, attribute).filter(
      (button) => button !== anchor,
    );
    if (near.length === 1) return near[0];
    if (near.length > 1) return null;
    container = container.parentElement;
  }
  return null;
}

function pressedAttributeOf(hooks: PageHooksSection | null): string {
  return hooks?.modeSwitch.pressedAttribute ?? DEFAULT_PRESSED_ATTRIBUTE;
}

/** A project page's pair by text, found from its Work button outwards. */
function findLabelledProjectSwitch(hooks: PageHooksSection | null): ModeSwitch | null {
  const attribute = pressedAttributeOf(hooks);
  const works = pressableButtons(document, labels(hooks, 'work'), attribute);
  if (works.length !== 1) return null;
  const chat = partnerOf(works[0], labels(hooks, 'chat'), attribute);
  return chat ? { chat, work: works[0], readable: true } : null;
}

/** The one rendered button whose whole text is one of `wanted`, else null. */
function uniqueButton(wanted: readonly string[]): HTMLButtonElement | null {
  const found = Array.from(
    document.querySelectorAll<HTMLButtonElement>(chatgptPageData.modeButton),
  ).filter((button) => wanted.includes(textOf(button)) && isRendered(button));
  return found.length === 1 ? found[0] : null;
}

/** The new-chat page's pair by text: one button per mode, both with `data-state`, close together. */
function findLabelledHomeSwitch(hooks: PageHooksSection | null): ModeSwitch | null {
  const chat = uniqueButton(labels(hooks, 'chat'));
  const work = uniqueButton(labels(hooks, 'work'));
  if (!chat || !work) return null;
  if (!chat.hasAttribute(HOME_STATE_ATTRIBUTE) || !work.hasAttribute(HOME_STATE_ATTRIBUTE)) {
    return null;
  }
  let container: Element | null = chat.parentElement;
  for (let depth = 1; container && depth <= PAIR_MAX_DEPTH; depth += 1) {
    if (container.contains(work)) return { chat, work, readable: false };
    container = container.parentElement;
  }
  return null;
}

/** The page's switch: by structure, else by text in the shape of `page`. */
export function findModeSwitch(
  adapter: SiteAdapter | null,
  page: 'home' | 'project',
): ModeSwitch | null {
  const hooks = hooksOf(adapter);
  return (
    findStructuredModeSwitch(hooks) ??
    (page === 'project' ? findLabelledProjectSwitch(hooks) : findLabelledHomeSwitch(hooks))
  );
}

/** What `control` shows pressed. */
export function pressedModeOf(adapter: SiteAdapter | null, control: ModeSwitch): PressedMode {
  const attribute = pressedAttributeOf(hooksOf(adapter));
  const chat = control.chat.getAttribute(attribute) === 'true';
  const work = control.work.getAttribute(attribute) === 'true';
  return chat && !work ? 'chat' : work && !chat ? 'work' : 'unknown';
}

/** What the page's switch shows pressed, when it can be read; null with no readable switch. */
export function readPressedMode(
  adapter: SiteAdapter | null,
  page: 'home' | 'project',
): PressedMode | null {
  const control = findModeSwitch(adapter, page);
  return control?.readable ? pressedModeOf(adapter, control) : null;
}
