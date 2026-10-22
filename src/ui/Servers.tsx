import { useState } from "preact/hooks";
import type { Outbox } from "../queue";
import type { SavedServer } from "../servers";
import { Sheet, TopBar } from "./common";

const unsent = (n: number) => (n === 1 ? "1 result or incident is" : `${n} results or incidents are`);

export function Servers(props: {
  servers: SavedServer[];
  current: string | null;
  outbox: Outbox;
  onPick: (base: string) => void;
  /** Back to the tournaments of the server in use, when there is one. */
  onBack?: () => void;
  onAdd: () => void;
  onRemove: (server: SavedServer, signOut: boolean) => void;
}) {
  const [removing, setRemoving] = useState<SavedServer | null>(null);

  return (
    <div class="screen">
      <TopBar title="Servers" subtitle="Each with its own sign-in" onBack={props.onBack} backLabel="Tournaments" />
      <main class="content">
        <ul class="list" id="server-list">
          {props.servers.map((s) => {
            const waiting = props.outbox.count(s.base);
            return (
              <li key={s.base} class={`row ${s.base === props.current ? "current" : ""}`}>
                <button type="button" class="row-main" onClick={() => props.onPick(s.base)}>
                  <span class="row-title">
                    {s.label}
                    {s.info.desktop && <span class="tag">Desktop</span>}
                  </span>
                  <span class="row-sub">
                    {s.user.name || s.user.email}
                    {waiting > 0 && ` · ${waiting} waiting to send`}
                  </span>
                </button>
                <button type="button" class="icon-btn subtle" aria-label={`Remove ${s.label}`} onClick={() => setRemoving(s)}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" class="btn primary block" id="add-server" onClick={props.onAdd}>
          Add a server
        </button>
      </main>

      {removing && (
        <Sheet title={`Remove ${removing.label}?`} onClose={() => setRemoving(null)}>
          <p>
            {props.outbox.count(removing.base) > 0
              ? `${unsent(props.outbox.count(removing.base))} on this phone not sent yet. Removing the server throws them away.`
              : "This phone forgets the server. Signing out also withdraws its access on the server."}
          </p>
          <div class="sheet-actions">
            <button
              type="button"
              class="btn danger block"
              onClick={() => {
                props.onRemove(removing, true);
                setRemoving(null);
              }}
            >
              Sign out and remove
            </button>
            <button type="button" class="btn block" onClick={() => setRemoving(null)}>
              Keep it
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
