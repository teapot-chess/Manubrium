// Everything that differs between a phone and a browser tab, in one place.

import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { Device } from "@capacitor/device";
import { App } from "@capacitor/app";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";
import type { KeyValue } from "./queue";
import { secureKeyValue, type PlainBackend, type SecureBackend } from "./secure";
import { webShare, type ShareOutcome } from "./share";

export const native = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform(); // "ios" | "android" | "web"

/** Preferences: UserDefaults on iOS, SharedPreferences on Android, localStorage in a browser. */
export const storage: KeyValue = {
  async get(key) {
    return (await Preferences.get({ key })).value;
  },
  async set(key, value) {
    await Preferences.set({ key, value });
  },
};

const preferences: PlainBackend = {
  ...storage,
  async remove(key) {
    await Preferences.remove({ key });
  },
};

// The plugin prefixes every key; ours keeps the app's items apart from any
// other plugin's in the same keychain. Set before the first call, once.
const vaultReady = native ? SecureStorage.setKeyPrefix("manubrium_") : Promise.resolve();

const vault: SecureBackend = {
  async getItem(key) {
    await vaultReady;
    return SecureStorage.getItem(key);
  },
  async setItem(key, value) {
    await vaultReady;
    await SecureStorage.setItem(key, value);
  },
  async removeItem(key) {
    await vaultReady;
    await SecureStorage.removeItem(key);
  },
};

/**
 * Where the device tokens live: the iOS Keychain or the Android Keystore
 * on a phone, Preferences in a browser. Tokens an earlier version left in
 * Preferences are moved over on first read (src/secure.ts).
 */
export const secureStorage: KeyValue = secureKeyValue({
  secure: native ? vault : null,
  plain: preferences,
  warn: (message, error) => console.warn(message, error),
});

/** What the account page will list this phone as. */
export async function deviceName(): Promise<string> {
  try {
    const info = await Device.getInfo();
    const name = (info as { name?: string }).name;
    if (name) return name.slice(0, 60);
    return `${info.manufacturer ?? ""} ${info.model ?? ""}`.trim().slice(0, 60) || "Phone";
  } catch {
    return "Browser";
  }
}

// The camera, the share sheet and the scanner are other screens: the app
// goes to the background while they are up and comes back after. That is
// not the arbiter leaving, and the app lock must not take it as such.
let away = 0;

/** Whether the app is in the background only because it opened the camera, the scanner or the share sheet. */
export function awayOnPurpose(): boolean {
  return away > 0;
}

async function onPurpose<T>(run: () => Promise<T>): Promise<T> {
  away++;
  try {
    return await run();
  } finally {
    // The resume arrives just after the plugin answers; let it land first.
    setTimeout(() => {
      away--;
    }, 1500);
  }
}

/** Scans a QR code with the camera; null when cancelled or not possible here. */
export async function scanQr(): Promise<string | null> {
  if (!native) return null;
  return onPurpose(scanNow);
}

async function scanNow(): Promise<string | null> {
  const { CapacitorBarcodeScanner, CapacitorBarcodeScannerTypeHint } = await import("@capacitor/barcode-scanner");
  try {
    const result = await CapacitorBarcodeScanner.scanBarcode({ hint: CapacitorBarcodeScannerTypeHint.QR_CODE });
    return result.ScanResult || null;
  } catch {
    return null;
  }
}

/** Calls `handler` with a `manubrium://` link the phone was opened with. */
export function onOpenLink(handler: (url: string) => void): void {
  if (!native) return;
  App.addListener("appUrlOpen", ({ url }) => {
    if (url.startsWith("manubrium:")) handler(url);
  });
}

/**
 * Android's back button, and Escape anywhere: `back()` takes one step back
 * and says whether there was one. At the root Android puts the app away, as
 * every other app does; a browser tab stays where it is.
 */
export function onBackButton(back: () => boolean): () => void {
  const key = (e: KeyboardEvent) => {
    if (e.key === "Escape" && back()) e.preventDefault();
  };
  document.addEventListener("keydown", key);
  const pending = native
    ? App.addListener("backButton", () => {
        if (!back()) App.minimizeApp().catch(() => undefined);
      })
    : null;
  return () => {
    document.removeEventListener("keydown", key);
    pending?.then((h) => h.remove());
  };
}

/** Calls `handler` when the app comes back to the foreground or online; returns the undo. */
export function onResume(handler: () => void): () => void {
  let undoNative: (() => void) | null = null;
  const visible = () => {
    if (document.visibilityState === "visible") handler();
  };

  if (native) {
    const pending = App.addListener("resume", handler);
    undoNative = () => {
      pending.then((h) => h.remove());
    };
  } else {
    document.addEventListener("visibilitychange", visible);
  }
  window.addEventListener("online", handler);

  return () => {
    undoNative?.();
    document.removeEventListener("visibilitychange", visible);
    window.removeEventListener("online", handler);
  };
}

/**
 * Takes a photo for an incident: the camera on a phone, a file picker in a
 * browser. A JPEG as base64 (no `data:` prefix), shrunk to 1600 pixels on
 * its longest side as the hall pages do, or null when cancelled.
 */
export async function takePhoto(): Promise<string | null> {
  if (native) return onPurpose(photoNow);
  return pickJpeg();
}

async function photoNow(): Promise<string | null> {
  const { Camera, CameraResultType, CameraSource } = await import("@capacitor/camera");
  try {
    const photo = await Camera.getPhoto({
      source: CameraSource.Camera,
      resultType: CameraResultType.Base64,
      quality: 70,
      width: 1600,
      height: 1600,
      correctOrientation: true,
      saveToGallery: false,
    });
    return photo.base64String ?? null;
  } catch {
    return null;
  }
}

function pickJpeg(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg";
    input.setAttribute("capture", "environment");
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    };
    input.click();
  });
}

/**
 * Hands text to the phone's share sheet. In a browser: the Web Share API
 * where there is one, the clipboard where there is not. Says which, so the
 * screen can tell the person; "cancelled" when they closed the sheet.
 */
export async function shareText(title: string, text: string): Promise<ShareOutcome> {
  if (native) {
    const { Share } = await import("@capacitor/share");
    return onPurpose(async () => {
      try {
        await Share.share({ title, text, dialogTitle: title });
        return "shared" as const;
      } catch {
        // Closing the sheet rejects too; there is no telling the two apart.
        return "cancelled" as const;
      }
    });
  }
  return webShare(title, text);
}

/**
 * Calls `handler(false)` the moment the app stops being the one in front -
 * before the system takes its app-switcher snapshot, which `pause` is late
 * for on iOS - and `handler(true)` when it is back. Returns the undo.
 */
export function onActiveChange(handler: (active: boolean) => void): () => void {
  if (native) {
    const pending = App.addListener("appStateChange", (state) => handler(state.isActive));
    return () => {
      pending.then((h) => h.remove());
    };
  }
  const changed = () => handler(document.visibilityState === "visible");
  document.addEventListener("visibilitychange", changed);
  return () => document.removeEventListener("visibilitychange", changed);
}

/** Calls `handler` when the app goes to the background; returns the undo. */
export function onPause(handler: () => void): () => void {
  const hidden = () => {
    if (document.visibilityState === "hidden") handler();
  };
  if (native) {
    const pending = App.addListener("pause", handler);
    return () => {
      pending.then((h) => h.remove());
    };
  }
  document.addEventListener("visibilitychange", hidden);
  return () => document.removeEventListener("visibilitychange", hidden);
}

/**
 * A local notification at `at`, replacing any earlier one with the same id.
 * Asks for permission the first time; false when there is none (or no
 * phone: a browser tab gets nothing, the countdown on screen is all).
 */
export async function remindAt(id: number, at: Date, title: string, body: string): Promise<boolean> {
  if (!native) return false;
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  try {
    let perm = await LocalNotifications.checkPermissions();
    if (perm.display === "prompt" || perm.display === "prompt-with-rationale") perm = await LocalNotifications.requestPermissions();
    if (perm.display !== "granted") return false;
    await LocalNotifications.cancel({ notifications: [{ id }] }).catch(() => undefined);
    if (at.getTime() <= Date.now()) return true;
    await LocalNotifications.schedule({ notifications: [{ id, title, body, schedule: { at, allowWhileIdle: true } }] });
    return true;
  } catch {
    return false;
  }
}

export async function cancelReminder(id: number): Promise<void> {
  if (!native) return;
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  await LocalNotifications.cancel({ notifications: [{ id }] }).catch(() => undefined);
}

/** Whether the phone can unlock the app itself: biometrics, or at least a passcode. */
export async function deviceUnlockAvailable(): Promise<boolean> {
  if (!native) return false;
  const { BiometricAuth } = await import("@aparajita/capacitor-biometric-auth");
  try {
    const r = await BiometricAuth.checkBiometry();
    return r.isAvailable || r.deviceIsSecure;
  } catch {
    return false;
  }
}

/** Face ID, Touch ID, a fingerprint or the phone's passcode. True when the phone says yes. */
export async function deviceUnlock(reason: string, cancelTitle: string): Promise<boolean> {
  if (!native) return false;
  const { BiometricAuth } = await import("@aparajita/capacitor-biometric-auth");
  return onPurpose(async () => {
    try {
      await BiometricAuth.authenticate({
        reason,
        cancelTitle,
        allowDeviceCredential: true,
        androidTitle: reason,
        androidConfirmationRequired: false,
      });
      return true;
    } catch {
      return false;
    }
  });
}
