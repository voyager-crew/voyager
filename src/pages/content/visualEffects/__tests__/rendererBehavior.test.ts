import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SchemeBridge } from '../../platformTheme/scheme';
import { DRAIN_CAP_MS, EFFECT_FRAME_MS } from '../effectClock';
import type { VisualEffectRenderer } from '../types';

vi.mock('@/core/utils/browser', () => ({
  isFirefox: vi.fn(() => false),
}));

type Kind = 'snow' | 'rain' | 'sakura';

const CANVAS_IDS: Record<Kind, string> = {
  snow: 'gv-snow-effect-canvas',
  rain: 'gv-rain-effect-canvas',
  sakura: 'gv-sakura-effect-canvas',
};

/** The context call whose first two arguments are a particle's position, per renderer. */
const POSITION_CALL = { snow: 'arc', rain: 'moveTo', sakura: 'translate' } as const;
/** Fastest resting fall speed per renderer, in px per 60 fps frame. */
const MAX_REST_SPEED: Record<Kind, number> = { snow: 1.6, rain: 20, sakura: 0.75 };

function createRecordingContext() {
  const fillStyles: string[] = [];
  const strokeStyles: string[] = [];
  const context = {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    ellipse: vi.fn(),
    quadraticCurveTo: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    setTransform: vi.fn(),
    drawImage: vi.fn(),
    lineWidth: 1,
    lineCap: 'butt',
    globalAlpha: 1,
    get fillStyle(): string {
      return fillStyles.at(-1) ?? '';
    },
    set fillStyle(value: string) {
      fillStyles.push(value);
    },
    get strokeStyle(): string {
      return strokeStyles.at(-1) ?? '';
    },
    set strokeStyle(value: string) {
      strokeStyles.push(value);
    },
  };
  return { context, fillStyles, strokeStyles };
}

/**
 * Deterministic random in [0, `span`). The default 0.5 keeps positions in the top half, so
 * nothing recycles in 1 s; a span of 1 spreads them over the whole viewport.
 */
function seededRandom(seed: number, span = 0.5): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return (state / 4294967296) * span;
  };
}

describe('visual effect renderers', () => {
  let recording: ReturnType<typeof createRecordingContext>;
  let frames: Map<number, FrameRequestCallback>;
  let nextFrameId: number;
  let now: number;
  let focused: boolean;
  let renderer: VisualEffectRenderer | null;
  let bridge: SchemeBridge | null;

  function setViewport(width: number, height: number): void {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  }

  /** Run every pending animation frame at time `time`. */
  function flush(time: number): void {
    now = time;
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(time);
  }

  function positionsOf(kind: Kind): Array<[number, number]> {
    const call = recording.context[POSITION_CALL[kind]];
    return call.mock.calls.map((args) => [args[0] as number, args[1] as number]);
  }

  /** Flush one frame and return the particle positions it drew (empty when it was skipped). */
  function drawFrame(kind: Kind, time: number): Array<[number, number]> {
    recording.context[POSITION_CALL[kind]].mockClear();
    flush(time);
    return positionsOf(kind);
  }

  /** The page scheme bridge, from the same module instance the renderers import. */
  async function startTestScheme(): Promise<SchemeBridge> {
    const { startScheme } = await import('../../platformTheme/scheme');
    return startScheme({
      hostSelector: 'html',
      lightSelector: '',
      darkSelector: 'html.gv-test-dark',
    });
  }

  async function start(kind: Kind): Promise<VisualEffectRenderer> {
    const module =
      kind === 'snow'
        ? (await import('../snow')).createSnowRenderer
        : kind === 'rain'
          ? (await import('../rain')).createRainRenderer
          : (await import('../sakura')).createSakuraRenderer;
    renderer = module();
    renderer.enable();
    return renderer;
  }

  /** Run `kind` at `hz` from t=0 to 1 s and return the y of every particle in the last frame. */
  async function fallAt(kind: Kind, hz: number): Promise<number[]> {
    vi.resetModules();
    vi.spyOn(Math, 'random').mockImplementation(seededRandom(7));
    const effect = await start(kind);
    let last: Array<[number, number]> = [];
    for (let tick = 0; tick <= hz; tick += 1) {
      const drawn = drawFrame(kind, (tick * 1000) / hz);
      if (drawn.length > 0) last = drawn;
    }
    effect.destroy();
    renderer = null;
    return last.map(([, y]) => y);
  }

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    document.documentElement.removeAttribute('data-gv-scheme');
    document.documentElement.className = '';
    setViewport(1000, 1080);
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    focused = true;
    vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
    renderer = null;
    bridge = null;

    recording = createRecordingContext();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      recording.context as unknown as CanvasRenderingContext2D,
    );
    frames = new Map();
    nextFrameId = 1;
    now = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      const id = nextFrameId++;
      frames.set(id, callback);
      return id;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id);
    });
  });

  afterEach(() => {
    renderer?.destroy();
    bridge?.stop();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe.each(['snow', 'rain', 'sakura'] as const)('%s', (kind) => {
    it('falls the same real-time distance at 30, 60 and 120 Hz', async () => {
      setViewport(1000, 4000);
      const at60 = await fallAt(kind, 60);
      const at120 = await fallAt(kind, 120);
      const at30 = await fallAt(kind, 30);
      expect(at60.length).toBeGreaterThan(0);
      expect(at120).toHaveLength(at60.length);
      expect(at30).toHaveLength(at60.length);
      at60.forEach((y, index) => {
        expect(at120[index]).toBeCloseTo(y, 6);
        expect(at30[index]).toBeCloseTo(y, 6);
      });
    });

    it('accelerates out on drain and is gone within the cap', async () => {
      await start(kind);
      for (let frame = 0; frame < 10; frame += 1) flush(frame * EFFECT_FRAME_MS);
      const drainStart = now;
      renderer!.drain();
      let frame = 10;
      while (document.getElementById(CANVAS_IDS[kind]) && now - drainStart < 10_000) {
        flush(frame * EFFECT_FRAME_MS);
        frame += 1;
      }
      expect(document.getElementById(CANVAS_IDS[kind])).toBeNull();
      // A 1080 px viewport clears before the cap; the cap is the backstop.
      expect(now - drainStart).toBeLessThan(2_000);
      expect(now - drainStart).toBeLessThanOrEqual(DRAIN_CAP_MS);
      expect(frames.size).toBe(0);
    });

    it('still finishes a drain within the cap at 10 fps', async () => {
      setViewport(1000, 4000);
      await start(kind);
      flush(0);
      renderer!.drain();
      let time = 0;
      while (document.getElementById(CANVAS_IDS[kind]) && time < 10_000) {
        time += 100;
        flush(time);
      }
      expect(document.getElementById(CANVAS_IDS[kind])).toBeNull();
      expect(time).toBeLessThanOrEqual(DRAIN_CAP_MS);
    });

    it('enable during a drain restores resting speed and keeps the effect', async () => {
      await start(kind);
      let frame = 0;
      flush(0);
      renderer!.drain();
      for (frame = 1; frame <= 30; frame += 1) flush(frame * EFFECT_FRAME_MS);
      renderer!.enable();
      // One frame recycles whatever fell out during the drain.
      flush(frame++ * EFFECT_FRAME_MS);
      const before = drawFrame(kind, frame++ * EFFECT_FRAME_MS);
      const after = drawFrame(kind, frame++ * EFFECT_FRAME_MS);
      expect(after).toHaveLength(before.length);
      const fastest = Math.max(...after.map(([, y], index) => y - before[index][1]));
      expect(fastest).toBeLessThanOrEqual(MAX_REST_SPEED[kind] + 1e-6);

      for (let end = frame + 600; frame < end; frame += 1) flush(frame * EFFECT_FRAME_MS);
      expect(document.getElementById(CANVAS_IDS[kind])).not.toBeNull();
    });

    it('spreads particles across a widened window', async () => {
      // Seeded: with Math.random about 1 run in 100 placed no more than half the particles past
      // the old width, and failed as `44 > 44`.
      vi.spyOn(Math, 'random').mockImplementation(seededRandom(7, 1));
      await start(kind);
      drawFrame(kind, 0);
      setViewport(3000, 1080);
      window.dispatchEvent(new Event('resize'));
      const drawn = drawFrame(kind, EFFECT_FRAME_MS);
      const beyondOldWidth = drawn.filter(([x]) => x > 1100).length;
      expect(beyondOldWidth).toBeGreaterThan(drawn.length / 2);
    });

    it('pauses while the window is unfocused and resumes on focus', async () => {
      await start(kind);
      flush(0);
      expect(frames.size).toBe(1);

      focused = false;
      window.dispatchEvent(new Event('blur'));
      vi.advanceTimersByTime(0);
      expect(frames.size).toBe(0);

      focused = true;
      window.dispatchEvent(new Event('focus'));
      expect(frames.size).toBe(1);
      // The first frame after a long pause moves one normal step, not the whole gap.
      const before = drawFrame(kind, EFFECT_FRAME_MS);
      expect(before.length).toBeGreaterThan(0);
    });

    it('keeps animating a selection made while the page is unfocused, for a while', async () => {
      focused = false;
      await start(kind);
      expect(frames.size).toBe(1);
      flush(0);
      vi.advanceTimersByTime(29_000);
      flush(EFFECT_FRAME_MS);
      expect(frames.size).toBe(1);
      vi.advanceTimersByTime(1_000);
      expect(frames.size).toBe(0);
    });
  });

  it('switches the snow colour with the page scheme', async () => {
    bridge = await startTestScheme();
    await start('snow');
    flush(0);
    expect(recording.fillStyles.every((style) => style.startsWith('rgba(120,140,168,'))).toBe(true);

    document.documentElement.classList.add('gv-test-dark');
    await Promise.resolve();
    recording.fillStyles.length = 0;
    flush(EFFECT_FRAME_MS);
    expect(recording.fillStyles.length).toBeGreaterThan(0);
    expect(recording.fillStyles.every((style) => style.startsWith('rgba(255,255,255,'))).toBe(true);
  });

  it('switches the rain colour with the page scheme', async () => {
    bridge = await startTestScheme();
    document.documentElement.classList.add('gv-test-dark');
    await Promise.resolve();
    await start('rain');
    flush(0);
    expect(recording.strokeStyles.every((style) => style.startsWith('rgba(180,200,220,'))).toBe(
      true,
    );

    document.documentElement.classList.remove('gv-test-dark');
    await Promise.resolve();
    recording.strokeStyles.length = 0;
    flush(EFFECT_FRAME_MS);
    expect(recording.strokeStyles.length).toBeGreaterThan(0);
    expect(recording.strokeStyles.every((style) => style.startsWith('rgba(74,104,140,'))).toBe(
      true,
    );
  });

  it('re-renders sakura sprites only when the scheme changes', async () => {
    bridge = await startTestScheme();
    await start('sakura');
    // Light petals are a deeper pink with an outline.
    expect(recording.fillStyles).toContain('hsla(350,72%,80%,1)');
    expect(recording.context.stroke).toHaveBeenCalledTimes(8);

    recording.fillStyles.length = 0;
    flush(0);
    flush(EFFECT_FRAME_MS);
    expect(recording.fillStyles).toEqual([]);

    document.documentElement.classList.add('gv-test-dark');
    await Promise.resolve();
    expect(recording.fillStyles).toHaveLength(8);
    expect(recording.fillStyles).toContain('hsla(350,50%,94%,1)');
    expect(recording.context.stroke).toHaveBeenCalledTimes(8);
  });
});
