// The app lock: off unless switched on. When on, the app asks for Face ID,
// Touch ID or the phone's passcode when it opens, and again after it has
// been in the background for the chosen time. The arbiter's own code is the
// way in when all of that fails (no biometrics set up, a glove, a cracked
// sensor). The code is kept only as a salted SHA-256 in the Keychain /
// Keystore, beside the server tokens; the settings in Preferences.

import type { KeyValue } from "./queue";

export const LOCK_KEY = "manubrium.lock.v1";
export const LOCK_CODE_KEY = "manubrium.lock.code.v1";

/** Minutes in the background before the lock comes back; 0 is "at once". */
export const LOCK_AFTER = [0, 1, 5, 15, 60] as const;

export interface LockSettings {
  enabled: boolean;
  after: number;
}

export const LOCK_OFF: LockSettings = { enabled: false, after: 5 };

export const CODE_MIN = 4;
export const CODE_MAX = 8;

/** A code is 4 to 8 digits: typed on a number pad, with gloves, in a hurry. */
export function validCode(code: string): boolean {
  return new RegExp(`^\\d{${CODE_MIN},${CODE_MAX}}$`).test(code);
}

export async function loadLock(store: KeyValue): Promise<LockSettings> {
  try {
    const raw = await store.get(LOCK_KEY);
    if (!raw) return LOCK_OFF;
    const v = JSON.parse(raw) as Partial<LockSettings>;
    const after = (LOCK_AFTER as readonly number[]).includes(v.after as number) ? (v.after as number) : LOCK_OFF.after;
    return { enabled: v.enabled === true, after };
  } catch {
    return LOCK_OFF;
  }
}

export async function saveLock(store: KeyValue, settings: LockSettings): Promise<void> {
  await store.set(LOCK_KEY, JSON.stringify(settings));
}

/** Whether coming back after `hiddenAt` (ms) at `now` needs the lock. */
export function lockOnReturn(settings: LockSettings, hiddenAt: number | null, now: number): boolean {
  if (!settings.enabled || hiddenAt === null) return false;
  return now - hiddenAt >= settings.after * 60_000;
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashCode(code: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${code}`);
  return hex(await crypto.subtle.digest("SHA-256", data));
}

/** Stores `code` as `salt$hash` under LOCK_CODE_KEY. */
export async function storeCode(vault: KeyValue, code: string): Promise<void> {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)).buffer as ArrayBuffer);
  await vault.set(LOCK_CODE_KEY, `${salt}$${await hashCode(code, salt)}`);
}

export async function checkCode(vault: KeyValue, code: string): Promise<boolean> {
  const stored = await vault.get(LOCK_CODE_KEY).catch(() => null);
  if (!stored) return false;
  const [salt, hash] = stored.split("$");
  if (!salt || !hash) return false;
  return (await hashCode(code, salt)) === hash;
}

/**
 * Wrong codes: five free, then a wait that doubles with every further miss,
 * from 30 seconds to a ceiling of 15 minutes. Long enough that guessing six
 * digits is a career; short enough that the arbiter who fumbled is back
 * before the round ends.
 */
export function waitAfter(misses: number): number {
  if (misses < 5) return 0;
  return Math.min(30_000 * 2 ** (misses - 5), 15 * 60_000);
}

const listeners = new Set<() => void>();

/** Called when the lock's settings change on this phone, so the lock reads them again. */
export function onLockChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function lockChanged(): void {
  for (const l of listeners) l();
}
