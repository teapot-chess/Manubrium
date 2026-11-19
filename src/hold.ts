// Hold to enter: a result is entered only after its button has been held
// for a second. A tap, or a thumb that slides off, does nothing - a result
// in a hall is the one thing nobody wants to enter by brushing past it.
//
// This is the logic, with no DOM and no framework: a small state machine
// that is told when a press starts, ends or is cancelled, and says when
// the hold has lasted long enough. `ui/HoldButton.tsx` wires it to a
// button; the tests drive it directly with fake timers.

import { buzz, type Buzz } from "./haptics";

/** How long a result button must be held. */
export const HOLD_MS = 1000;

/**
 * The timing and the buzz, in one object so a test can change them. The
 * buzz is native haptics in the app and navigator.vibrate in a browser
 * that has one (src/haptics.ts): a light one when a press starts, so the
 * thumb knows it is being held, and a firmer one when it locks.
 */
export const holdTiming: { ms: number; buzz: (kind: Buzz) => void } = {
  ms: HOLD_MS,
  buzz,
};

export interface HoldOptions {
  /** The hold lasted long enough: enter the result. */
  onLock: () => void;
  /** A press ended early, or a bare click came: say how it works. */
  onTap: () => void;
  /** Whether the hold is running changed, for the progress fill. */
  onChange?: (holding: boolean) => void;
  /** Overrides `holdTiming.ms` for this button. */
  ms?: number;
}

export class HoldController {
  holding = false;
  /** A press has a click coming that has already been dealt with. */
  private clickPending = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private options: () => HoldOptions) {}

  /** A press began (pointer down, Enter or Space down). Ignored while one is running. */
  start(viaPointer: boolean): void {
    if (this.holding) return;
    const o = this.options();
    this.holding = true;
    this.clickPending = viaPointer;
    o.onChange?.(true);
    holdTiming.buzz("start");
    this.timer = setTimeout(() => {
      this.timer = null;
      this.holding = false;
      const now = this.options();
      now.onChange?.(false);
      holdTiming.buzz("lock");
      now.onLock();
    }, o.ms ?? holdTiming.ms);
  }

  /** The press ended where it began (pointer up, key up). Early, that is a tap. */
  release(): void {
    if (!this.holding) return;
    this.stop();
    this.options().onTap();
  }

  /** The press was abandoned: the finger slid off, the page scrolled, focus went elsewhere. Says nothing. */
  cancel(): void {
    if (!this.holding) return;
    this.stop();
    this.clickPending = false;
  }

  /**
   * The browser's click. After a press it is the same gesture a second time
   * and is ignored; on its own (an assistive technology's "activate", a
   * script) it is a tap too, and enters nothing.
   */
  click(): void {
    if (this.clickPending) {
      this.clickPending = false;
      return;
    }
    if (!this.holding) this.options().onTap();
  }

  /** The button went away: nothing may fire into a screen that is gone. */
  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.holding = false;
  }

  private stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.holding = false;
    this.options().onChange?.(false);
  }
}
