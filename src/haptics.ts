// The buzz a hold makes: a light tap when the press starts, a firmer one
// when it locks. In the app it is @capacitor/haptics, the Taptic Engine on
// an iPhone and the vibrator on Android; in a browser it is
// navigator.vibrate where there is one (Android's Chrome) and silence where
// there is not (Safari, every desktop), which nobody has complained about.

import { Capacitor } from "@capacitor/core";

export type Buzz = "start" | "lock";

/** navigator.vibrate lengths, in milliseconds: short, so they read as clicks. */
export const WEB_BUZZ_MS: Record<Buzz, number> = { start: 10, lock: 25 };

type Haptics = typeof import("@capacitor/haptics");

// Loaded once, at start, so the first press does not wait for an import to
// buzz half a second late.
let plugin: Promise<Haptics | null> | null = null;

function nativeHaptics(): Promise<Haptics | null> {
  plugin ??= import("@capacitor/haptics").catch(() => null);
  return plugin;
}

if (Capacitor.isNativePlatform()) void nativeHaptics();

/** The browser half, separate so a test can hand it a navigator. */
export function webBuzz(kind: Buzz, nav: { vibrate?: Navigator["vibrate"] } | undefined = typeof navigator === "undefined" ? undefined : navigator): void {
  try {
    if (typeof nav?.vibrate === "function") nav.vibrate(WEB_BUZZ_MS[kind]);
  } catch {
    // A webview that refuses to buzz is still a webview that locks.
  }
}

/** Buzzes, natively in the app, through the browser otherwise. Never throws, never waits. */
export function buzz(kind: Buzz): void {
  if (!Capacitor.isNativePlatform()) return webBuzz(kind);
  void nativeHaptics()
    .then((h) => h?.Haptics.impact({ style: kind === "lock" ? h.ImpactStyle.Medium : h.ImpactStyle.Light }))
    .catch(() => undefined);
}
