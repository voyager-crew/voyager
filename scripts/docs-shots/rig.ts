/** Steps against the running rig (run.ts): page and panel scripts, trusted input, 2x captures. */
import { writeFileSync } from 'node:fs';

import { Cdp } from './session';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Page scripts get `gv.settings(request)`, a promise over the dev settings bridge. */
const BRIDGE = `globalThis.gv ??= { settings: (req) => new Promise((resolve) => {
  const id = Math.random();
  const on = (e) => { if (e.data?.source === 'gv-dev-settings-result' && e.data.id === id) { removeEventListener('message', on); resolve(e.data); } };
  addEventListener('message', on);
  postMessage({ source: 'gv-dev-settings', id, ...req }, location.origin);
  setTimeout(() => resolve({ ok: false, error: 'timeout' }), 4000);
}) };`;

const PANEL_FRAME = `(() => { let found; const walk = (root) => root.querySelectorAll('*').forEach((e) => {
  if (e.tagName === 'IFRAME' && e.src.includes('/src/pages/panel/')) found = e;
  if (e.shadowRoot) walk(e.shadowRoot); });
  walk(document); if (!found) return null; const r = found.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`;

const MODIFIERS: Record<string, number> = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
const KEY_CODES: Record<string, number> = { Enter: 13, Escape: 27, Backspace: 8, Tab: 9 };

export class Rig {
  private constructor(
    readonly cdp: Cdp,
    readonly page: string,
  ) {}

  static async connect(): Promise<Rig> {
    const cdp = await Cdp.connect();
    return new Rig(cdp, await cdp.page());
  }

  async setup(): Promise<void> {
    // A background tab never runs animation frames, and the panel opens on one.
    await this.cdp.send('Page.bringToFront', {}, this.page);
    await this.cdp.send(
      'Emulation.setDeviceMetricsOverride',
      { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false },
      this.page,
    );
    await this.cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }, this.page);
  }

  evalPage(expression: string): Promise<unknown> {
    return this.cdp.evaluate(this.page, `${BRIDGE}\n${expression}`);
  }

  async evalPanel(expression: string): Promise<unknown> {
    return this.cdp.evaluate(await this.cdp.panel(), expression);
  }

  async settings(request: Record<string, unknown>): Promise<unknown> {
    return this.evalPage(`await gv.settings(${JSON.stringify(request)})`);
  }

  async panelFrame(): Promise<Box | null> {
    return (await this.evalPage(PANEL_FRAME)) as Box | null;
  }

  /** A panel element's box in page CSS px, by selector or by exact text or label. */
  async panelElement(query: string): Promise<Box> {
    const frame = await this.panelFrame();
    if (!frame) throw new Error('the panel is not open');
    const box = (await this.evalPanel(
      `(() => { const q = ${JSON.stringify(query)}; let el = null;
        try { el = document.querySelector(q); } catch {}
        if (!el) el = [...document.querySelectorAll('button, a, label, [role=tab], [role=switch], summary, input, textarea')]
          .find((e) => (e.textContent || '').trim() === q || e.getAttribute('aria-label') === q);
        if (!el) return null; el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`,
    )) as Box | null;
    if (!box) throw new Error(`no panel element for ${query}`);
    return { ...box, x: box.x + frame.x, y: box.y + frame.y };
  }

  async click(x: number, y: number): Promise<void> {
    const send = (type: string, at = { x, y }) =>
      this.cdp.send(
        'Input.dispatchMouseEvent',
        { type, ...at, button: 'left', clickCount: 1 },
        this.page,
      );
    await send('mouseMoved');
    await send('mousePressed');
    await send('mouseReleased');
    // Park the pointer in a corner so no hover state lingers in a shot.
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 }, this.page);
  }

  async pclick(query: string): Promise<void> {
    const box = await this.panelElement(query);
    await this.click(box.x + box.width / 2, box.y + box.height / 2);
  }

  async key(key: string, modifier?: string): Promise<void> {
    const code = key.length === 1 ? `Key${key.toUpperCase()}` : key;
    const base = {
      key,
      code,
      modifiers: modifier ? MODIFIERS[modifier] : 0,
      windowsVirtualKeyCode: KEY_CODES[key] ?? key.toUpperCase().charCodeAt(0),
    };
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base }, this.page);
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }, this.page);
  }

  async type(text: string): Promise<void> {
    await this.cdp.send('Input.insertText', { text }, this.page);
  }

  /** The viewport, or a region in CSS px, at the page's 2x. `scale` 0.5 gives 1x. */
  async shot(out: string, clip?: Box, scale = 1): Promise<void> {
    const region = clip ?? { x: 0, y: 0, width: 1440, height: 900 };
    const { data } = await this.cdp.send<{ data: string }>(
      'Page.captureScreenshot',
      { format: 'png', clip: { ...region, scale } },
      this.page,
    );
    writeFileSync(out, Buffer.from(data, 'base64'));
  }

  async pshot(out: string, query: string, pad = 0): Promise<Box> {
    const box = await this.panelElement(query);
    const clip = {
      x: box.x - pad,
      y: box.y - pad,
      width: box.width + 2 * pad,
      height: box.height + 2 * pad,
    };
    await this.shot(out, clip);
    return clip;
  }

  close(): void {
    this.cdp.close();
  }
}

export const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
