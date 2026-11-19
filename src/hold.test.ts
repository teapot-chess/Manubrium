// The hold-to-enter rules, with no DOM: a tap does nothing, a second's hold
// locks, and anything that ends the press early - lifting, sliding off,
// scrolling - cancels. Fake timers, so a second is a second.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOLD_MS, HoldController, holdTiming, LOCK_BUZZ_MS } from "./hold";

function make(ms?: number) {
  const calls = { lock: 0, tap: 0, changes: [] as boolean[] };
  const hold = new HoldController(() => ({
    ms,
    onLock: () => void calls.lock++,
    onTap: () => void calls.tap++,
    onChange: (h) => void calls.changes.push(h),
  }));
  return { hold, calls };
}

let buzz: ReturnType<typeof vi.fn>;
const original = holdTiming.vibrate;

beforeEach(() => {
  vi.useFakeTimers();
  buzz = vi.fn();
  holdTiming.vibrate = buzz as never;
  holdTiming.ms = HOLD_MS;
});

afterEach(() => {
  vi.useRealTimers();
  holdTiming.vibrate = original;
  holdTiming.ms = HOLD_MS;
});

describe("hold to enter", () => {
  it("is a second long", () => {
    expect(HOLD_MS).toBe(1000);
  });

  it("locks when the press has lasted a second, once, with a buzz", () => {
    const { hold, calls } = make();
    hold.start(true);
    vi.advanceTimersByTime(999);
    expect(calls.lock).toBe(0);
    vi.advanceTimersByTime(1);
    expect(calls.lock).toBe(1);
    expect(buzz).toHaveBeenCalledWith(LOCK_BUZZ_MS);
    // Letting go afterwards, and the click that follows, enter nothing more and say nothing.
    hold.release();
    hold.click();
    vi.advanceTimersByTime(5000);
    expect(calls.lock).toBe(1);
    expect(calls.tap).toBe(0);
  });

  it("does not lock on a tap: a press let go early says how it works and enters nothing", () => {
    const { hold, calls } = make();
    hold.start(true);
    vi.advanceTimersByTime(120);
    hold.release();
    hold.click();
    vi.advanceTimersByTime(5000);
    expect(calls.lock).toBe(0);
    expect(calls.tap).toBe(1);
    expect(buzz).not.toHaveBeenCalled();
  });

  it("cancels, silently, when the finger slides off or the page scrolls", () => {
    const { hold, calls } = make();
    hold.start(true);
    vi.advanceTimersByTime(600);
    hold.cancel();
    vi.advanceTimersByTime(5000);
    expect(calls.lock).toBe(0);
    expect(calls.tap).toBe(0);
    expect(calls.changes).toEqual([true, false]);
  });

  it("a bare click, with no press before it, is a tap too", () => {
    const { hold, calls } = make();
    hold.click();
    expect(calls.tap).toBe(1);
    expect(calls.lock).toBe(0);
  });

  it("ignores a second start while a hold runs, and can hold again after a cancel", () => {
    const { hold, calls } = make();
    hold.start(true);
    vi.advanceTimersByTime(500);
    hold.start(true);
    vi.advanceTimersByTime(500);
    expect(calls.lock).toBe(1);
    hold.start(false);
    hold.cancel();
    hold.start(false);
    vi.advanceTimersByTime(1000);
    expect(calls.lock).toBe(2);
  });

  it("takes its length from the shared timing, or from the button's own", () => {
    holdTiming.ms = 200;
    const a = make();
    a.hold.start(false);
    vi.advanceTimersByTime(200);
    expect(a.calls.lock).toBe(1);
    const b = make(50);
    b.hold.start(false);
    vi.advanceTimersByTime(50);
    expect(b.calls.lock).toBe(1);
  });

  it("fires nothing into a screen that is gone", () => {
    const { hold, calls } = make();
    hold.start(true);
    hold.dispose();
    vi.advanceTimersByTime(5000);
    expect(calls.lock).toBe(0);
  });

  it("buzzes through navigator.vibrate where the webview has it, and does without where it has not", () => {
    holdTiming.vibrate = original;
    const vibrate = vi.fn();
    vi.stubGlobal("navigator", { vibrate });
    holdTiming.vibrate(25);
    expect(vibrate).toHaveBeenCalledWith(25);
    vi.stubGlobal("navigator", {});
    expect(() => holdTiming.vibrate(25)).not.toThrow();
    vi.unstubAllGlobals();
  });
});
