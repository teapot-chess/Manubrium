// Everything that differs between a phone and a browser tab, in one place.

import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { Device } from "@capacitor/device";
import { App } from "@capacitor/app";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";
import type { KeyValue } from "./queue";
import { secureKeyValue, type PlainBackend, type SecureBackend } from "./secure";

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

/** Scans a QR code with the camera; null when cancelled or not possible here. */
export async function scanQr(): Promise<string | null> {
  if (!native) return null;
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
