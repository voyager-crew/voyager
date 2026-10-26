/** The declarative ledger and guarded native owners distinguish their decorations from Voyager UI. */
export class NativeDomDecorationService {
  private readonly classes = new WeakMap<Element, Map<string, Set<object>>>();

  acquire(element: Element, name: string, owner: object): void {
    let names = this.classes.get(element);
    let owners = names?.get(name);
    if (!names) {
      names = new Map();
      this.classes.set(element, names);
    }
    if (!owners) {
      owners = new Set();
      names.set(name, owners);
    }
    owners.add(owner);
  }

  release(element: Element, name: string, owner: object): void {
    const names = this.classes.get(element);
    const owners = names?.get(name);
    owners?.delete(owner);
    if (!owners?.size) names?.delete(name);
    if (!names?.size) this.classes.delete(element);
  }

  has(element: Element, name: string): boolean {
    return (this.classes.get(element)?.get(name)?.size ?? 0) > 0;
  }
}

export const nativeDomDecorations = new NativeDomDecorationService();
