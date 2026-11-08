// What this phone remembers about itself, apart from the theme, the
// language and the lock (each in its own module): small switches in
// Preferences, read where they are needed.

import type { KeyValue } from "./queue";

export const PHONE_KEY = "manubrium.phone.v1";

export interface PhoneSettings {
  /** A local notification when a round's default time is reached. */
  remindDefaultTime: boolean;
}

export const PHONE_DEFAULTS: PhoneSettings = { remindDefaultTime: false };

export async function loadPhoneSettings(store: KeyValue): Promise<PhoneSettings> {
  try {
    const raw = await store.get(PHONE_KEY);
    const v = raw ? (JSON.parse(raw) as Partial<PhoneSettings>) : {};
    return { remindDefaultTime: v.remindDefaultTime === true };
  } catch {
    return PHONE_DEFAULTS;
  }
}

export async function savePhoneSettings(store: KeyValue, settings: PhoneSettings): Promise<void> {
  await store.set(PHONE_KEY, JSON.stringify(settings));
}
