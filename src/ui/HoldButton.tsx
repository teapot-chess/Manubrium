// The button every result is entered with: it does its thing only when held
// for a second (src/hold.ts has the rules). A tap shows the notice and
// enters nothing. While held, a fill sweeps across the button; with
// "reduce motion" on, the sweep is replaced by an outline and the hold is
// just as long.
//
// Touch, mouse and keyboard (hold Enter or Space) all work. The listeners
// are native ones on the element, not Preact's, so the pointer events do not
// depend on how a framework spells them.

import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { HoldController, holdTiming } from "../hold";
import { t as tr } from "../i18n";

let counter = 0;
const NOTICE_MS = 2500;

export function HoldButton(props: {
  id?: string;
  class?: string;
  disabled?: boolean;
  /** The hold completed. */
  onLock: () => void;
  /** Overrides the one second, for a test. */
  ms?: number;
  children: ComponentChildren;
}) {
  const [holding, setHolding] = useState(false);
  const [hint, setHint] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [describedBy] = useState(() => `hold-help-${++counter}`);

  // The controller reads the latest props at the moment it fires.
  const latest = useRef(props);
  latest.current = props;
  const controller = useRef<HoldController | null>(null);
  if (!controller.current) {
    controller.current = new HoldController(() => ({
      ms: latest.current.ms,
      onLock: () => {
        setHint(false);
        latest.current.onLock();
      },
      onTap: () => {
        setHint(true);
        if (hintTimer.current) clearTimeout(hintTimer.current);
        hintTimer.current = setTimeout(() => setHint(false), NOTICE_MS);
      },
      onChange: setHolding,
    }));
  }

  useEffect(() => {
    const el = button.current;
    const hold = controller.current;
    if (!el || !hold) return;

    const down = (e: Event) => {
      const p = e as PointerEvent;
      if (latest.current.disabled || (p.pointerType === "mouse" && p.button !== 0)) return;
      // A touch is captured by the element it began on, so sliding off would
      // never be seen as leaving. Letting go of the capture makes it so.
      try {
        if (el.hasPointerCapture?.(p.pointerId)) el.releasePointerCapture(p.pointerId);
      } catch {
        // No capture to release.
      }
      setHint(false);
      hold.start(true);
    };
    const up = () => hold.release();
    const leave = () => hold.cancel();
    const click = (e: Event) => {
      e.preventDefault();
      if (!latest.current.disabled) hold.click();
    };
    const keydown = (e: Event) => {
      const k = e as KeyboardEvent;
      if (k.key !== "Enter" && k.key !== " ") return;
      // Enter would click on key down, Space on key up: neither may.
      k.preventDefault();
      if (k.repeat || latest.current.disabled) return;
      setHint(false);
      hold.start(false);
    };
    const keyup = (e: Event) => {
      const k = e as KeyboardEvent;
      if (k.key !== "Enter" && k.key !== " ") return;
      k.preventDefault();
      hold.release();
    };
    const menu = (e: Event) => e.preventDefault();

    const events: [string, (e: Event) => void][] = [
      ["pointerdown", down],
      ["pointerup", up],
      ["pointerleave", leave],
      ["pointercancel", leave],
      ["click", click],
      ["keydown", keydown],
      ["keyup", keyup],
      ["blur", leave],
      ["contextmenu", menu],
    ];
    for (const [name, fn] of events) el.addEventListener(name, fn);
    return () => {
      for (const [name, fn] of events) el.removeEventListener(name, fn);
      hold.dispose();
      if (hintTimer.current) clearTimeout(hintTimer.current);
    };
  }, []);

  // A button that was disabled mid-hold stops holding.
  useEffect(() => {
    if (props.disabled) controller.current?.cancel();
  }, [props.disabled]);

  return (
    <span class="hold-wrap">
      <button
        type="button"
        ref={button}
        id={props.id}
        class={["btn", "hold", props.class, holding ? "holding" : ""].filter(Boolean).join(" ")}
        disabled={props.disabled}
        aria-describedby={describedBy}
        style={{ "--hold-ms": `${props.ms ?? holdTiming.ms}ms` } as never}
      >
        <span class="hold-fill" aria-hidden="true" />
        <span class="hold-label">{props.children}</span>
      </button>
      <span class="sr-only" id={describedBy}>
        {tr("hold.help")}
      </span>
      {hint && (
        <span class="hold-notice" role="status">
          {tr("hold.notice")}
        </span>
      )}
    </span>
  );
}
