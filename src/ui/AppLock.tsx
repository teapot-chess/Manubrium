// The lock in front of the whole app (src/lock.ts has the rules). Nothing
// underneath is drawn while it is locked: a screenshot in the app switcher
// shows the lock, not the round - and while the lock is on, the moment the
// app stops being the one in front a plain cover goes up, before the system
// takes that picture. (The lock itself comes on at the return, after the
// delay the arbiter chose; the cover has no delay.)

import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { checkCode, loadLock, loadThrottle, lockOnReturn, missed, onLockChange, saveThrottle, validCode, CODE_MAX, type LockSettings, LOCK_OFF } from "../lock";
import { awayOnPurpose, deviceUnlock, deviceUnlockAvailable, onActiveChange, onPause, onResume, secureStorage, storage } from "../platform";
import { Mark } from "./common";
import { t as tr } from "../i18n";

export function AppLock(props: { children: ComponentChildren }) {
  const [settings, setSettings] = useState<LockSettings | null>(null);
  const [locked, setLocked] = useState(false);
  const [device, setDevice] = useState(false);
  const [code, setCode] = useState("");
  const [wrong, setWrong] = useState(false);
  const [misses, setMisses] = useState(0);
  const [blockedUntil, setBlockedUntil] = useState(0);
  const [covered, setCovered] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const hiddenAt = useRef<number | null>(null);
  const settingsRef = useRef<LockSettings>(LOCK_OFF);
  const asking = useRef(false);

  // On start: locked if the lock is on.
  useEffect(() => {
    let first = true;
    const read = () =>
      loadLock(storage).then((s) => {
        settingsRef.current = s;
        setSettings(s);
        if (first && s.enabled) setLocked(true);
        first = false;
      });
    read();
    deviceUnlockAvailable().then(setDevice);
    loadThrottle(storage).then((t) => {
      setMisses((m) => Math.max(m, t.misses));
      setBlockedUntil((b) => Math.max(b, t.blockedUntil));
    });
    return onLockChange(() => void read());
  }, []);

  useEffect(() => {
    const undoPause = onPause(() => {
      // The camera or the share sheet the app opened itself is not leaving.
      if (!awayOnPurpose()) hiddenAt.current = Date.now();
    });
    const undoResume = onResume(() => {
      if (lockOnReturn(settingsRef.current, hiddenAt.current, Date.now())) setLocked(true);
      hiddenAt.current = null;
    });
    return () => {
      undoPause();
      undoResume();
    };
  }, []);

  useEffect(
    () =>
      onActiveChange((active) => {
        if (active) setCovered(false);
        else if (settingsRef.current.enabled && !awayOnPurpose()) setCovered(true);
      }),
    [],
  );

  // Locked: ask the phone straight away, once per locking.
  useEffect(() => {
    if (!locked || !device || asking.current) return;
    void unlockWithDevice();
  }, [locked, device]);

  useEffect(() => {
    if (blockedUntil <= now) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [blockedUntil, now]);

  async function unlockWithDevice() {
    asking.current = true;
    try {
      if (await deviceUnlock(tr("lock.reason"), tr("lock.use_code"))) open();
    } finally {
      asking.current = false;
    }
  }

  function open() {
    setLocked(false);
    setCode("");
    setWrong(false);
    setMisses(0);
    setBlockedUntil(0);
    void saveThrottle(storage, { misses: 0, blockedUntil: 0 });
  }

  async function tryCode(e: Event) {
    e.preventDefault();
    if (Date.now() < blockedUntil || !validCode(code)) return;
    if (await checkCode(secureStorage, code)) return open();
    const next = missed({ misses, blockedUntil }, Date.now());
    setMisses(next.misses);
    setWrong(true);
    setCode("");
    void saveThrottle(storage, next);
    if (next.blockedUntil) {
      setBlockedUntil(next.blockedUntil);
      setNow(Date.now());
    }
  }

  if (settings === null) return <div class="splash" aria-busy="true"><Mark big /></div>;
  // The cover goes OVER the app rather than instead of it: coming back from
  // a glance at another app must not throw away the screen the arbiter was on.
  if (!locked) {
    return (
      <>
        {props.children}
        {covered && (
          <div class="lock-screen" id="app-cover" aria-hidden="true">
            <Mark big />
          </div>
        )}
      </>
    );
  }

  const waitSeconds = Math.ceil(Math.max(0, blockedUntil - now) / 1000);
  return (
    <div class="lock-screen" id="app-lock">
      <Mark big />
      <h1>{tr("lock.title")}</h1>
      {device && (
        <button type="button" class="btn primary block" id="lock-device" onClick={() => void unlockWithDevice()}>
          {tr("lock.unlock")}
        </button>
      )}
      <form class="form lock-code" id="lock-code-form" onSubmit={tryCode}>
        <label for="lock-code">{device ? tr("lock.or_code") : tr("lock.code")}</label>
        <input
          id="lock-code"
          type="password"
          inputMode="numeric"
          autocomplete="off"
          maxLength={CODE_MAX}
          value={code}
          onInput={(e) => {
            setCode((e.target as HTMLInputElement).value.replace(/\D/g, ""));
            setWrong(false);
          }}
        />
        {wrong && <p class="fine lock-wrong">{tr("lock.wrong")}</p>}
        {waitSeconds > 0 && <p class="fine lock-wrong">{tr("lock.wait", { n: waitSeconds })}</p>}
        <button type="submit" class="btn block" id="lock-code-go" disabled={!validCode(code) || waitSeconds > 0}>
          {tr("lock.open")}
        </button>
      </form>
    </div>
  );
}
