// Secret storage for the device tokens: the iOS Keychain and the Android
// Keystore on a phone, plain Preferences in a browser, and - once - the
// move from one to the other.
//
// The tokens used to live in Capacitor Preferences (UserDefaults /
// SharedPreferences), which is backed up and readable by anything with the
// app's sandbox. The Keychain and the Keystore are not. The store exposes
// the same `KeyValue` as everything else, so `ServerList` cannot tell the
// difference; the migration happens on the first read of a key that the
// secure store does not have yet and the plain one does.
//
// Nothing here imports Capacitor: the backends are injected, so the tests
// run against fakes and `platform.ts` wires the real ones.

import type { KeyValue } from "./queue";

/** The native vault: `@aparajita/capacitor-secure-storage`'s string API. */
export interface SecureBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** The previous home of the tokens, which also serves as the fallback. */
export interface PlainBackend extends KeyValue {
  remove(key: string): Promise<void>;
}

export interface SecureOptions {
  /** `null` where there is no vault (a browser): everything goes to `plain`. */
  secure: SecureBackend | null;
  plain: PlainBackend;
  /** Where to say that the vault failed and the plain store took over. */
  warn?: (message: string, error: unknown) => void;
}

/**
 * A `KeyValue` that keeps its values in the vault when there is one.
 *
 * - `get` reads the vault; when the key is not there but the plain store
 *   has it, the value is copied into the vault and removed from the plain
 *   store. Each key moves exactly once.
 * - `set` writes the vault only.
 * - If the vault throws (a locked keychain, a Keystore that lost its key
 *   after a restore), the store warns once and uses the plain backend for
 *   the rest of the session. Losing the vault must not lose the tournament.
 */
export function secureKeyValue(options: SecureOptions): KeyValue {
  const { plain, warn = () => {} } = options;
  let secure = options.secure;

  const giveUp = (what: string, error: unknown): null => {
    if (secure) {
      warn(`Secure storage failed on ${what}; using preferences for this session`, error);
      secure = null;
    }
    return null;
  };

  return {
    async get(key) {
      if (!secure) return plain.get(key);

      let value: string | null;
      try {
        value = await secure.getItem(key);
      } catch (error) {
        giveUp("get", error);
        return plain.get(key);
      }
      if (value !== null) return value;

      // Not in the vault: is it still where the old versions kept it?
      const old = await plain.get(key);
      if (old === null) return null;
      try {
        await secure.setItem(key, old);
      } catch (error) {
        giveUp("migrate", error);
        return old;
      }
      await plain.remove(key);
      return old;
    },

    async set(key, value) {
      if (secure) {
        try {
          await secure.setItem(key, value);
          return;
        } catch (error) {
          giveUp("set", error);
        }
      }
      await plain.set(key, value);
    },
  };
}
