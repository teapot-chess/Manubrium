// More, "This phone": what this phone keeps for itself, whichever server and
// tournament it is on - the colour theme, the default-time reminder and the
// app lock. Each is in Preferences (the code in the Keychain / Keystore) and
// never sent anywhere. Further phone-wide switches belong here as rows.

import { useEffect, useState } from "preact/hooks";
import { currentTheme, palette, saveTheme, THEMES, type ThemeId } from "../themes";
import { CODE_MAX, CODE_MIN, LOCK_AFTER, LOCK_OFF, loadLock, lockChanged, saveLock, storeCode, validCode, type LockSettings } from "../lock";
import { loadPhoneSettings, PHONE_DEFAULTS, savePhoneSettings, type PhoneSettings as Phone } from "../phoneSettings";
import { deviceUnlockAvailable, native, secureStorage, storage } from "../platform";
import { Sheet } from "./common";
import { t as tr, type Key } from "../i18n";

export const themeName = (id: ThemeId) => tr(`theme.${id}` as Key);

export function PhoneSettings() {
  const [theme, setThemeState] = useState<ThemeId>(currentTheme());
  const [phone, setPhone] = useState<Phone>(PHONE_DEFAULTS);
  const [lock, setLock] = useState<LockSettings>(LOCK_OFF);
  const [device, setDevice] = useState(false);
  const [settingCode, setSettingCode] = useState(false);

  useEffect(() => {
    loadPhoneSettings(storage).then(setPhone);
    loadLock(storage).then(setLock);
    deviceUnlockAvailable().then(setDevice);
  }, []);

  async function pickTheme(id: ThemeId) {
    setThemeState(id);
    await saveTheme(storage, id);
  }

  async function changePhone(next: Phone) {
    setPhone(next);
    await savePhoneSettings(storage, next);
  }

  async function changeLock(next: LockSettings) {
    setLock(next);
    await saveLock(storage, next);
    lockChanged();
  }

  return (
    <section id="phone-settings">
      <h2>{tr("phone.title")}</h2>

      <h3 class="sub">{tr("phone.theme")}</h3>
      <div class="themes" role="radiogroup" aria-label={tr("phone.theme")}>
        {THEMES.map((id) => {
          const light = palette(id, false);
          const dark = palette(id, true);
          return (
            <button
              type="button"
              key={id}
              role="radio"
              aria-checked={theme === id}
              class={`theme-pick ${theme === id ? "active" : ""}`}
              id={`theme-${id}`}
              onClick={() => void pickTheme(id)}
            >
              <span class="swatch" aria-hidden="true">
                <span style={{ background: light.bg }}>
                  <i style={{ background: light.accent }} />
                  <i style={{ background: light["mark-centre"] }} />
                </span>
                <span style={{ background: dark.bg }}>
                  <i style={{ background: dark.accent }} />
                  <i style={{ background: dark["mark-centre"] }} />
                </span>
              </span>
              <span class="theme-name">{themeName(id)}</span>
            </button>
          );
        })}
      </div>
      <p class="fine">{tr("phone.theme_fine")}</p>

      <ul class="list compact">
        <li class="row">
          <label class="row-main pick" for="remind-default-time">
            <input
              type="checkbox"
              id="remind-default-time"
              checked={phone.remindDefaultTime}
              onChange={(e) => void changePhone({ ...phone, remindDefaultTime: (e.target as HTMLInputElement).checked })}
            />
            <span>
              <span class="row-title">{tr("phone.remind")}</span>
              <span class="row-sub">{native ? tr("phone.remind_fine") : tr("phone.remind_web")}</span>
            </span>
          </label>
        </li>
        <li class="row">
          <label class="row-main pick" for="app-lock-on">
            <input
              type="checkbox"
              id="app-lock-on"
              checked={lock.enabled}
              onChange={(e) => {
                if ((e.target as HTMLInputElement).checked) setSettingCode(true);
                else void changeLock({ ...lock, enabled: false });
              }}
            />
            <span>
              <span class="row-title">{tr("phone.lock")}</span>
              <span class="row-sub">{device ? tr("phone.lock_fine") : tr("phone.lock_fine_code")}</span>
            </span>
          </label>
        </li>
        {lock.enabled && (
          <li class="row lock-options">
            <label for="app-lock-after">{tr("phone.lock_after")}</label>
            <select id="app-lock-after" value={String(lock.after)} onChange={(e) => void changeLock({ ...lock, after: Number((e.target as HTMLSelectElement).value) })}>
              {LOCK_AFTER.map((m) => (
                <option key={m} value={String(m)}>
                  {m === 0 ? tr("phone.lock_at_once") : m === 1 ? tr("phone.lock_minute") : tr("phone.lock_minutes", { n: m })}
                </option>
              ))}
            </select>
            <button type="button" class="chip" id="app-lock-code" onClick={() => setSettingCode(true)}>
              {tr("phone.lock_change_code")}
            </button>
          </li>
        )}
      </ul>

      {settingCode && (
        <CodeSheet
          onClose={() => setSettingCode(false)}
          onSet={async (code) => {
            await storeCode(secureStorage, code);
            setSettingCode(false);
            await changeLock({ ...lock, enabled: true });
          }}
        />
      )}
    </section>
  );
}

/** The arbiter's own code, typed twice: the way in when Face ID is not. */
function CodeSheet(props: { onClose: () => void; onSet: (code: string) => Promise<void> }) {
  const [first, setFirst] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const mismatch = again.length >= first.length && again !== "" && again !== first;
  const ready = validCode(first) && first === again;
  const digits = (e: Event) => (e.target as HTMLInputElement).value.replace(/\D/g, "");
  return (
    <Sheet title={tr("phone.code_title")} onClose={props.onClose} dirty={first !== ""}>
      <form
        class="form"
        id="lock-code-set"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!ready) return;
          setBusy(true);
          try {
            await props.onSet(first);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p class="fine">{tr("phone.code_text", { min: CODE_MIN, max: CODE_MAX })}</p>
        <label for="lock-code-new">{tr("phone.code_new")}</label>
        <input id="lock-code-new" type="password" inputMode="numeric" autocomplete="off" maxLength={CODE_MAX} value={first} onInput={(e) => setFirst(digits(e))} />
        <label for="lock-code-again">{tr("phone.code_again")}</label>
        <input id="lock-code-again" type="password" inputMode="numeric" autocomplete="off" maxLength={CODE_MAX} value={again} onInput={(e) => setAgain(digits(e))} />
        {mismatch && <p class="fine lock-wrong">{tr("phone.code_mismatch")}</p>}
        <button type="submit" class="btn primary block" id="lock-code-save" disabled={!ready || busy}>
          {tr("phone.code_save")}
        </button>
      </form>
    </Sheet>
  );
}
