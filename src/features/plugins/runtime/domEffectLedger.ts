import { hasVoyagerOwner } from '@/core/gemini/composer/ownedInput';
import { nativeDomDecorations } from '@/core/services/NativeDomDecorationService';

/**
 * DomEffectLedger — the engine-level, ref-counted record of every class,
 * attribute and inline style the declarative plugins wrote (see the
 * `DeclarativeEngine` class doc). When two plugins touch the same
 * class/attribute/style, the *true* pre-plugin original is captured once;
 * releasing one plugin restores the value of the other still-active plugin
 * (last writer wins), and only the last release restores the original.
 */
import { InlineStyleParser } from './inlineStyleDeclarations';
import { InlineStyleLedger } from './inlineStyleLedger';

/**
 * One overwritten attribute. `original` is the value *before any
 * plugin touched it* (captured once): `null` = attribute was absent.
 * `stack` holds each active plugin's desired value; the
 * top entry is the one currently written to the DOM (last writer wins).
 */
interface OverrideLayer {
  readonly original: string | null;
  readonly stack: Array<{ id: string; value: string }>;
}

export class DomEffectLedger {
  /** element → className → set of plugin ids that requested the class. */
  private readonly classOwners = new Map<Element, Map<string, Set<string>>>();
  /** element → attribute name → layer. */
  private readonly attrLayers = new Map<Element, Map<string, OverrideLayer>>();
  /** Shared original longhands and ordered declarations, including variable shorthands. */
  private readonly styleLayers = new Map<HTMLElement, InlineStyleLedger>();
  /** Expands `style` attribute values and `setStyle` entries into longhands. */
  private styleParser: InlineStyleParser | null = null;

  constructor(
    private readonly doc: Document,
    private readonly trackNativeDecorations = false,
  ) {}

  addClass(id: string, el: Element, className: string): void {
    const perEl = mapGet(this.classOwners, el, () => new Map<string, Set<string>>());
    const owners = mapGet(perEl, className, () => new Set<string>());
    // Native decorations must not make later guarded semantic reads mistake the host for our UI.
    if (
      this.trackNativeDecorations &&
      !hasVoyagerOwner(el) &&
      !el.closest('[data-gv-component], [data-gv-layer], [data-gv-plugin]')
    )
      nativeDomDecorations.acquire(el, className, this);
    owners.add(id);
    // (Re)assert the class — also re-heals an SPA re-render that stripped it.
    if (!el.classList.contains(className)) el.classList.add(className);
  }

  setAttribute(id: string, el: Element, name: string, value: string): void {
    const perEl = mapGet(this.attrLayers, el, () => new Map<string, OverrideLayer>());
    const layer = mapGet(perEl, name, () => ({ original: el.getAttribute(name), stack: [] }));
    pushLayerValue(layer, id, value);
    el.setAttribute(name, topValue(layer));
  }

  setStyle(id: string, el: HTMLElement, prop: string, value: string, priority = ''): void {
    const ledger = mapGet(this.styleLayers, el, () => new InlineStyleLedger(el));
    ledger.set(id, [prop, value, priority], this.styles().properties(prop));
  }

  styles(): InlineStyleParser {
    this.styleParser ??= new InlineStyleParser(this.doc);
    return this.styleParser;
  }

  /** Remove every contribution of `id`, restoring the next-highest plugin's
   *  value (or the captured original when it was last). */
  release(id: string): void {
    for (const [el, perEl] of this.classOwners) {
      for (const [className, owners] of perEl) {
        if (owners.delete(id) && owners.size === 0) {
          if (this.trackNativeDecorations) nativeDomDecorations.release(el, className, this);
          el.classList.remove(className);
          perEl.delete(className);
        }
      }
      if (perEl.size === 0) this.classOwners.delete(el);
    }

    for (const [el, perEl] of this.attrLayers) {
      for (const [name, layer] of perEl) {
        if (!removeLayerValue(layer, id)) continue;
        if (layer.stack.length === 0) {
          if (layer.original === null) el.removeAttribute(name);
          else el.setAttribute(name, layer.original);
          perEl.delete(name);
        } else {
          el.setAttribute(name, topValue(layer));
        }
      }
      if (perEl.size === 0) this.attrLayers.delete(el);
    }

    for (const [el, ledger] of this.styleLayers) {
      if (ledger.release(id)) this.styleLayers.delete(el);
    }
  }

  /** Restore detached elements before dropping their ledger entries. This
   *  prevents the ledgers from pinning replaced SPA subtrees while preserving
   *  reversibility if a framework later reattaches the same element. */
  restoreDetached(): void {
    for (const [el, perEl] of this.classOwners) {
      if (this.doc.contains(el)) continue;
      for (const className of perEl.keys()) {
        if (this.trackNativeDecorations) nativeDomDecorations.release(el, className, this);
        el.classList.remove(className);
      }
      this.classOwners.delete(el);
    }

    for (const [el, perEl] of this.attrLayers) {
      if (this.doc.contains(el)) continue;
      for (const [name, layer] of perEl) {
        if (layer.original === null) el.removeAttribute(name);
        else el.setAttribute(name, layer.original);
      }
      this.attrLayers.delete(el);
    }

    for (const [el, ledger] of this.styleLayers) {
      if (this.doc.contains(el)) continue;
      ledger.restore();
      this.styleLayers.delete(el);
    }
  }
}

function mapGet<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  let value = map.get(key);
  if (value === undefined) {
    value = create();
    map.set(key, value);
  }
  return value;
}

/** Update-or-insert a plugin's desired value, moving it to the top of the stack. */
function pushLayerValue(layer: OverrideLayer, id: string, value: string): void {
  removeLayerValue(layer, id);
  layer.stack.push({ id, value });
}

/** Remove a plugin's entry from the stack. Returns true if one was present. */
function removeLayerValue(layer: OverrideLayer, id: string): boolean {
  const index = layer.stack.findIndex((entry) => entry.id === id);
  if (index < 0) return false;
  layer.stack.splice(index, 1);
  return true;
}

function topValue(layer: OverrideLayer): string {
  return layer.stack[layer.stack.length - 1].value;
}
