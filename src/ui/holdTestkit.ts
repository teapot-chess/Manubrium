// For tests that enter a result: results are held, not tapped, so a test
// holds the button too - for a few milliseconds instead of a second.
// Test-only; the app does not import this.

import { fireEvent } from "@testing-library/preact";
import { HOLD_MS, holdTiming } from "../hold";

/** Makes a hold last a few milliseconds, for tests on real timers. Call `slowHolds` after. */
export function fastHolds(ms = 5): void {
  holdTiming.ms = ms;
  holdTiming.buzz = () => undefined;
  // The stray-click shield drops the moment the test lets go.
  holdTiming.shield = { afterUpMs: 0, maxMs: 1500 };
}

export function slowHolds(): void {
  holdTiming.ms = HOLD_MS;
  holdTiming.shield = { afterUpMs: 450, maxMs: 1500 };
}

/** Holds the button (or the button an element is in) until it locks, then lets go. */
export async function hold(target: Element | null): Promise<void> {
  const button = target?.closest("button");
  if (!button) throw new Error("nothing to hold");
  fireEvent.pointerDown(button, { pointerId: 1, pointerType: "touch", isPrimary: true, button: 0 });
  await new Promise((resolve) => setTimeout(resolve, holdTiming.ms + 40));
  fireEvent.pointerUp(button, { pointerId: 1, pointerType: "touch", isPrimary: true, button: 0 });
  fireEvent.click(button);
}
