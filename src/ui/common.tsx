import type { ComponentChildren } from "preact";
import { ApiError, OfflineError } from "../api";

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
        <button type="button" class="icon-btn" onClick={props.onBack} aria-label={props.backLabel ?? "Back"}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
      ) : (
        <span class="mark" aria-hidden="true" />
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
  if (error instanceof OfflineError) return "No connection. This needs the server; try again when the phone has a signal.";
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

export function Notice(props: { kind?: "error" | "info" | "ok"; children: ComponentChildren; onClose?: () => void }) {
  return (
    <div class={`notice ${props.kind ?? "info"}`} role={props.kind === "error" ? "alert" : "status"}>
      <span>{props.children}</span>
      {props.onClose && (
        <button type="button" class="notice-close" onClick={props.onClose} aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  );
}

export function Sheet(props: { title: string; onClose: () => void; children: ComponentChildren }) {
  return (
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <section class="sheet" role="dialog" aria-modal="true" aria-label={props.title}>
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

export function Loading() {
  return <div class="loading" aria-busy="true" aria-label="Loading" />;
}

/** "1/2-1/2" is how the server spells it; a phone can afford the glyph. */
export function resultLabel(code: string): string {
  return code.replace(/1\/2/g, "½");
}
