import { getSiteSelectorView } from '@/core/selectors';
import { resolvePlacementViewOperation } from '@/core/selectors/placement';
import { inputSiteId, packagedInputSelector } from '@/core/services/composer/siteInputData';

/** Keep the HUD near its configured composer without attaching it to the page body. */

/** Badge height plus its gap: the strip above the mount the badge renders into. */
const HUD_CLEARANCE_PX = 28;
/** Every `overflow` value that hides what sits outside the box. */
const CLIPPING_OVERFLOW = new Set(['hidden', 'clip', 'auto', 'scroll']);

function clipsOverflow(element: Element): boolean {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (!style) return false;
  return CLIPPING_OVERFLOW.has(style.overflowY) || CLIPPING_OVERFLOW.has(style.overflow);
}

/**
 * The badge floats just above its mount, so a mount that sits inside a box
 * hiding its overflow renders nothing at all — DeepSeek's composer card clips
 * exactly that strip. Climb out of any ancestor whose own top is close enough
 * to swallow the badge, so a newly adapted site needs no rule of its own.
 */
function unclippedMount(mount: HTMLElement | null): HTMLElement | null {
  if (!mount) return null;
  const body = mount.ownerDocument.body;
  let result = mount;
  for (let node = mount.parentElement; node && node !== body; node = node.parentElement) {
    if (!clipsOverflow(node)) continue;
    const headroom = result.getBoundingClientRect().top - HUD_CLEARANCE_PX;
    if (node.getBoundingClientRect().top <= headroom) continue;
    result = node.parentElement ?? result;
  }
  return result;
}

export function getVimComposerMount(
  input: HTMLElement | null,
  configuredSelector: string | null,
  acceptWrapper = false,
): HTMLElement | null {
  if (!input) return null;
  const doc = input.ownerDocument;
  const site = inputSiteId(doc);
  const view = site ? getSiteSelectorView(site) : null;
  const mountKeys = ['vim.mountInput', 'vim.mountRoot', 'vim.mountChatInput', 'vim.mountChatRoot'];
  if (!view || !mountKeys.some((key) => view.remoteKeys.has(key))) {
    if (input.matches(packagedInputSelector('vim.mountInput', doc)))
      return unclippedMount(input.closest(packagedInputSelector('vim.mountRoot', doc)));
    if (input.matches(packagedInputSelector('vim.mountChatInput', doc)))
      return unclippedMount(input.closest(packagedInputSelector('vim.mountChatRoot', doc)));
  } else {
    const readPair = (inputKey: string, rootKey: string): HTMLElement | null => {
      const read = (get: (key: string) => string): HTMLElement | null =>
        input.matches(get(inputKey)) ? unclippedMount(input.closest(get(rootKey))) : null;
      return site
        ? resolvePlacementViewOperation(getSiteSelectorView(site), [inputKey, rootKey], (view) =>
            read((key) => view.profiles[key].join(',')),
          )
        : read((key) => packagedInputSelector(key, doc));
    };
    const native = readPair('vim.mountInput', 'vim.mountRoot');
    if (native) return native;
    const chat = readPair('vim.mountChatInput', 'vim.mountChatRoot');
    if (chat) return chat;
  }
  if (!configuredSelector) return null;
  let composer = input;
  try {
    if (!input.matches(configuredSelector)) {
      const wrapper = acceptWrapper ? input.closest<HTMLElement>(configuredSelector) : null;
      if (!wrapper) return null;
      composer = wrapper;
    }
  } catch {
    return null;
  }
  const parent = composer.parentElement;
  return parent &&
    parent !== input.ownerDocument.body &&
    parent !== input.ownerDocument.documentElement
    ? unclippedMount(parent)
    : null;
}
