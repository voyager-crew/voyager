import { selectorLiteralParts } from './locatorLiterals';

const HTML_TAGS = new Set(
  'a abbr address area article aside audio b base bdi bdo blockquote body br button canvas caption cite code col colgroup data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe img input ins kbd label legend li link main map mark menu meta meter nav noscript object ol optgroup option output p picture pre progress q rp rt ruby s samp script search section select slot small source span strong style sub summary sup table tbody td template textarea tfoot th thead time title tr track u ul var video wbr'.split(
    ' ',
  ),
);

// Native control/state syntax is reusable grammar, not a published host landmark.
const GENERIC_ATTRIBUTES = new Set(
  'role hidden inert contenteditable disabled readonly multiple selected checked required autofocus tabindex type dir lang draggable spellcheck translate'.split(
    ' ',
  ),
);
const NATIVE_ATTRIBUTE_PRESENCE = new Set(
  'id class href src alt title name value placeholder for form slot style'.split(' '),
);

/** Keep host names, classes and attribute values locked without claiming generic HTML/ARIA. */
export function hasHostLocatorFragment(value: string): boolean {
  return selectorLiteralParts(value).some((part) => {
    if (/^[.#][\w-]+$/.test(part)) return true;
    if (/^[\w-]+$/.test(part)) return !HTML_TAGS.has(part);
    const attribute = part.match(/^\[([\w:-]+)([^\]]*)\]$/);
    if (!attribute) return false;
    const [, name, constraint] = attribute;
    if (GENERIC_ATTRIBUTES.has(name)) return false;
    if (name.startsWith('aria-'))
      return (name === 'aria-label' || name === 'aria-description') && constraint.includes('=');
    if (!constraint && NATIVE_ATTRIBUTE_PRESENCE.has(name)) return false;
    return true;
  });
}
