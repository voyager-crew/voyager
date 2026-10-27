/** Keep the existing light/shadow ordering for both the probe and the later image sweep. */
export function collectImageHosts(root: Element, selector: string): Element[] {
  const hosts: Element[] = [];
  const visit = (node: Element | ShadowRoot): void => {
    if (node instanceof Element && node.matches(selector)) hosts.push(node);
    hosts.push(...Array.from(node.querySelectorAll(selector)));
    const walk = (element: Element): void => {
      if (element.shadowRoot) visit(element.shadowRoot);
      Array.from(element.children).forEach(walk);
    };
    Array.from(node.children).forEach(walk);
  };
  visit(root);
  return hosts;
}
