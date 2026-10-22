import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { ApiError, OfflineError } from "../api";
import { pushBack } from "../back";
import { shareText } from "../platform";
import { t } from "../i18n";

// The nine-square mark (brand/manubrium-mark.svg), inline: the handle - one
// filled column down an empty board - in currentColor, the centre square in
// the mark's own accent. Sized by CSS (.mark, .mark.big).
const OUTLINED = [
  [2.6, 2.6],
  [16.6, 2.6],
  [2.6, 9.6],
  [16.6, 9.6],
  [2.6, 16.6],
  [16.6, 16.6],
];

export function Mark(props: { big?: boolean }) {
  return (
    <svg class={props.big ? "mark big" : "mark"} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {OUTLINED.map(([x, y]) => (
        <rect key={`${x},${y}`} x={x} y={y} width="4.8" height="4.8" fill="none" stroke="currentColor" stroke-width="1.2" />
      ))}
      <rect x="9" y="2" width="6" height="6" fill="currentColor" />
      <rect class="mark-centre" x="9" y="9" width="6" height="6" />
      <rect x="9" y="16" width="6" height="6" fill="currentColor" />
    </svg>
  );
}

export function TopBar(props: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  backLabel?: string;
  right?: ComponentChildren;
}) {
  return (
    <header class="topbar">
      {props.onBack ? (
        <button type="button" class="icon-btn" onClick={props.onBack} aria-label={props.backLabel ?? t("common.back")}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
      ) : (
        <Mark />
      )}
      <div class="topbar-text">
        <h1>{props.title}</h1>
        {props.subtitle && <p>{props.subtitle}</p>}
      </div>
      <div class="topbar-right">{props.right}</div>
    </header>
  );
}

/** A sentence for the person holding the phone, whatever went wrong. */
export function describeError(error: unknown): string {
  if (error instanceof OfflineError) return t("common.no_connection");
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return t("common.something_went_wrong");
}

export function Notice(props: { kind?: "error" | "info" | "ok"; children: ComponentChildren; onClose?: () => void }) {
  return (
    <div class={`notice ${props.kind ?? "info"}`} role={props.kind === "error" ? "alert" : "status"}>
      <span>{props.children}</span>
      {props.onClose && (
        <button type="button" class="notice-close" onClick={props.onClose} aria-label={t("common.dismiss")}>
          ×
        </button>
      )}
    </div>
  );
}

/**
 * A bottom sheet. It takes the focus when it opens and hands it back when
 * it closes, and the back button or Escape closes it. `sticky` sheets close
 * only by their own buttons: for what a stray tap on the backdrop must not
 * throw away, like a code shown once.
 */
export function Sheet(props: { title: string; onClose: () => void; sticky?: boolean; children: ComponentChildren }) {
  const box = useRef<HTMLElement>(null);
  const close = useRef(props.onClose);
  close.current = props.onClose;
  const sticky = !!props.sticky;

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    box.current?.focus();
    const undo = pushBack(() => {
      if (!sticky) close.current();
    });
    return () => {
      undo();
      if (before && before.isConnected) before.focus();
    };
  }, [sticky]);

  return (
    <div class="sheet-backdrop" onClick={(e) => !sticky && e.target === e.currentTarget && props.onClose()}>
      <section class="sheet" role="dialog" aria-modal="true" aria-label={props.title} tabIndex={-1} ref={box}>
        <div class="sheet-grip" aria-hidden="true" />
        <h2>{props.title}</h2>
        {props.children}
      </section>
    </div>
  );
}

export function Empty(props: { children: ComponentChildren }) {
  return <p class="empty">{props.children}</p>;
}

/** The way out of a failed load: the same request again. */
export function TryAgain(props: { onClick: () => void; id?: string }) {
  return (
    <button type="button" class="btn block" id={props.id} onClick={props.onClick}>
      {t("common.try_again")}
    </button>
  );
}

export function Loading() {
  return <div class="loading" aria-busy="true" aria-label={t("common.loading")} />;
}

/** "1/2-1/2" is how the server spells it; a phone can afford the glyph. */
export function resultLabel(code: string): string {
  return code.replace(/1\/2/g, "½");
}

/**
 * A Share button: the phone's share sheet, or in a browser the Web Share
 * API or the clipboard. `text` is built when tapped, so it is never stale.
 */
export function ShareButton(props: { id: string; title: string; text: () => string | null; label?: string }) {
  const [said, setSaid] = useState<string | null>(null);
  async function go() {
    const text = props.text();
    if (!text) return;
    const outcome = await shareText(props.title, text);
    setSaid(outcome === "copied" ? t("common.copied") : outcome === "failed" ? t("common.could_not_share") : null);
    if (outcome === "copied" || outcome === "failed") setTimeout(() => setSaid(null), 2500);
  }
  return (
    <button type="button" class="chip share" id={props.id} onClick={go} aria-live="polite">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
      </svg>
      {said ?? props.label ?? t("common.share")}
    </button>
  );
}
