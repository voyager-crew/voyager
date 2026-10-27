/** A shared app landmark is not evidence that a target belongs to a foreign region. */
export function hasForeignPageOwner(element: Element, selector: string): boolean {
  // A preview can copy a whole main; modal ownership remains a content protocol, not an app landmark.
  if (element.closest('dialog, [role="dialog"], [role="alertdialog"], [role="menu"]')) return true;
  if (!element.closest(selector)) return false;
  const doc = element.ownerDocument;
  const mains = Array.from(doc.querySelectorAll('main, [role="main"]')).filter(
    (owner) => !owner.parentElement?.closest('main, [role="main"]'),
  );
  // A nested or second preview main cannot appoint itself as the app boundary.
  const boundary = mains.length === 1 && mains[0].contains(element) ? mains[0] : doc.body;
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.matches(selector)) return true;
    if (node === boundary) break;
  }
  return false;
}
