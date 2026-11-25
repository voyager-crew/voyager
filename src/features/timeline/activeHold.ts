/**
 * Holds a clicked marker active while navigation moves the page (#1116).
 *
 * Scroll events during the hold are the navigation's own and are ignored. A
 * person can still scroll in that time; their scroll events are dropped too,
 * so when the hold expires the active turn is recomputed once, but only if a
 * person's input arrived: the navigation's own scroll may leave an edge turn
 * short of the anchor line, and recomputing then would pick its neighbour.
 */
import { isUserEvent } from '@/core/utils/userEvent';

const HOLD_MS = 900;
const USER_INPUTS = ['wheel', 'touchmove', 'keydown', 'pointerdown'] as const;

export class ActiveHold {
  private until = 0;
  private userMoved = false;
  private expiry: number | null = null;
  private listening = false;

  constructor(
    private readonly signal: AbortSignal,
    /** Measure and recompute the active turn. */
    private readonly recompute: () => void,
  ) {}

  get held(): boolean {
    return Date.now() < this.until;
  }

  hold(): void {
    this.until = Date.now() + HOLD_MS;
    this.userMoved = false;
    this.listen();
    this.clearExpiry();
    if (this.signal.aborted) return;
    this.expiry = window.setTimeout(() => {
      this.expiry = null;
      if (this.userMoved && !this.signal.aborted) this.recompute();
    }, HOLD_MS + 1);
  }

  /** End the hold now, without the expiry check. */
  release(): void {
    this.until = 0;
    this.clearExpiry();
  }

  destroy(): void {
    this.release();
  }

  private clearExpiry(): void {
    if (this.expiry !== null) window.clearTimeout(this.expiry);
    this.expiry = null;
  }

  private listen(): void {
    if (this.listening || this.signal.aborted) return;
    this.listening = true;
    const onInput = (event: Event): void => {
      if (this.held && isUserEvent(event)) this.userMoved = true;
    };
    for (const name of USER_INPUTS)
      window.addEventListener(name, onInput, { passive: true, capture: true, signal: this.signal });
  }
}
