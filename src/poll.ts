// Asking again every few seconds, but only while somebody is looking: the
// live boards are polled while their screen is open and the app is in the
// foreground, and not a request more. Leaving the screen stops it; putting
// the phone away pauses it; coming back asks at once.

import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";

export type Foreground = (onChange: (active: boolean) => void) => () => void;

/** The app's foreground state: Capacitor's App state on a phone, page visibility in a browser. */
export const watchForeground: Foreground = (onChange) => {
  if (Capacitor.isNativePlatform()) {
    const pending = App.addListener("appStateChange", ({ isActive }) => onChange(isActive));
    return () => {
      pending.then((h) => h.remove());
    };
  }
  const visible = () => onChange(document.visibilityState !== "hidden");
  document.addEventListener("visibilitychange", visible);
  return () => document.removeEventListener("visibilitychange", visible);
};

export const MIN_SECONDS = 2;
export const MAX_SECONDS = 60;

export interface Poller {
  /** Ask now, and count the interval again from here (after a command, say). */
  now(): void;
  stop(): void;
}

/**
 * Calls `tick` at once and then every `seconds` after each answer; `tick`
 * may return the server's `poll_seconds` to change the pace. A failed tick
 * is the caller's to show; the polling goes on. Paused in the background.
 */
export function poll(tick: () => Promise<number | void>, seconds: number, foreground: Foreground = watchForeground): Poller {
  let interval = clamp(seconds);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let active = true;
  let stopped = false;
  let inFlight = false;
  let again = false;

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!stopped && active) timer = setTimeout(run, interval * 1000);
  };

  async function run() {
    if (stopped || !active) return;
    if (inFlight) {
      again = true;
      return;
    }
    if (timer) clearTimeout(timer);
    timer = null;
    inFlight = true;
    try {
      const next = await tick();
      if (typeof next === "number" && Number.isFinite(next)) interval = clamp(next);
    } catch {
      // The screen shows the failure; the next tick may well work.
    } finally {
      inFlight = false;
    }
    if (again) {
      again = false;
      run();
    } else {
      schedule();
    }
  }

  const undo = foreground((isActive) => {
    if (stopped || isActive === active) return;
    active = isActive;
    if (active) run();
    else if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  });

  run();

  return {
    now: () => run(),
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      undo();
    },
  };
}

function clamp(n: number): number {
  return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, n || 5));
}
