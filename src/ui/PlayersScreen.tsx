// Players: late entries, withdrawing and re-entering, rounds off, the basic
// fields. Online only - each change waits for the server's yes, because
// the next pairing depends on it.

import { useEffect, useState } from "preact/hooks";
import { ApiError, type Player, type Tournament } from "../api";
import type { Ctx } from "./App";
import { describeError, Empty, Loading, Notice, Sheet } from "./common";

export function PlayersScreen(props: { ctx: Ctx; t: Tournament }) {
  const { ctx, t } = props;
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Player | "new" | null>(null);
  const [filter, setFilter] = useState("");

  async function load() {
    try {
      setPlayers(await ctx.api.players(t.id));
      setError(null);
    } catch (e) {
      setError(describeError(e));
    }
  }

  useEffect(() => {
    load();
  }, [t.id]);

  const shown = (players ?? []).filter((p) => p.name.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <div class="players">
      <div class="toolbar">
        <input
          type="search"
          placeholder="Find a player"
          value={filter}
          onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
          aria-label="Find a player"
        />
        {!t.read_only && (
          <button type="button" class="btn primary" id="add-player" onClick={() => setEditing("new")}>
            Late entry
          </button>
        )}
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {!players && !error && <Loading />}
      {players && shown.length === 0 && <Empty>{filter ? "Nobody by that name." : "No players yet."}</Empty>}
      <ul class="list" id="player-list">
        {shown.map((p) => (
          <li key={p.id} class="row">
            <button type="button" class="row-main" disabled={t.read_only} onClick={() => setEditing(p)}>
              <span class="row-title">
                {p.pairing_number ? <span class="tpn">{p.pairing_number}</span> : null}
                {p.title && <em>{p.title} </em>}
                {p.name}
                {p.status !== "active" && <span class="tag warn">{p.status}</span>}
              </span>
              <span class="row-sub">
                {[p.rating, p.federation, p.club].filter(Boolean).join(" · ")}
                {p.absent_rounds.length > 0 && ` · off in round ${p.absent_rounds.join(", ")}`}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {editing && (
        <PlayerSheet
          ctx={ctx}
          t={t}
          player={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function PlayerSheet(props: { ctx: Ctx; t: Tournament; player: Player | null; onClose: () => void; onSaved: () => void }) {
  const { ctx, t, player } = props;
  const [name, setName] = useState(player?.name ?? "");
  const [fideId, setFideId] = useState(player?.fide_id ? String(player.fide_id) : "");
  const [rating, setRating] = useState(player?.fide_rating ? String(player.fide_rating) : "");
  const [federation, setFederation] = useState(player?.federation ?? "");
  const [club, setClub] = useState(player?.club ?? "");
  const [off, setOff] = useState<number[]>(player?.absent_rounds ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ ids: string[]; message: string; changes: Record<string, unknown> } | null>(null);

  const rounds = Array.from({ length: t.rounds_count ?? 0 }, (_, i) => i + 1);
  const basic = { name: name.trim(), fide_id: fideId.trim(), fide_rating: rating.trim(), federation: federation.trim(), club: club.trim() };

  async function save(changes: Record<string, unknown>, acknowledged: string[] = []) {
    setBusy(true);
    setError(null);
    try {
      if (player) await ctx.api.updatePlayer(t.id, player.id, changes, acknowledged);
      else await ctx.api.createPlayer(t.id, changes as { name: string });
      props.onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.code === "needs_acknowledgement") {
        setConfirm({ ids: (e.body.confirm as string[]) ?? [], message: e.message, changes });
      } else {
        setError(describeError(e));
      }
    } finally {
      setBusy(false);
    }
  }

  if (confirm) {
    return (
      <Sheet title="Confirm" onClose={props.onClose}>
        <p>{confirm.message}</p>
        <div class="sheet-actions">
          <button type="button" class="btn primary block" disabled={busy} onClick={() => save(confirm.changes, confirm.ids)}>
            Confirm
          </button>
          <button type="button" class="btn block" onClick={() => setConfirm(null)}>
            Back
          </button>
        </div>
        {error && <Notice kind="error">{error}</Notice>}
      </Sheet>
    );
  }

  return (
    <Sheet title={player ? player.name : "Late entry"} onClose={props.onClose}>
      <form
        class="form"
        onSubmit={(e) => {
          e.preventDefault();
          save(player ? { ...basic, absent_rounds: off } : basic);
        }}
      >
        <label for="p-name">Name (Last, First)</label>
        <input id="p-name" value={name} required onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        <div class="two">
          <div>
            <label for="p-fide">FIDE ID</label>
            <input id="p-fide" inputMode="numeric" value={fideId} onInput={(e) => setFideId((e.target as HTMLInputElement).value)} />
          </div>
          <div>
            <label for="p-rating">FIDE rating</label>
            <input id="p-rating" inputMode="numeric" value={rating} onInput={(e) => setRating((e.target as HTMLInputElement).value)} />
          </div>
        </div>
        <div class="two">
          <div>
            <label for="p-fed">Federation</label>
            <input id="p-fed" maxLength={3} value={federation} onInput={(e) => setFederation((e.target as HTMLInputElement).value.toUpperCase())} />
          </div>
          <div>
            <label for="p-club">Club</label>
            <input id="p-club" value={club} onInput={(e) => setClub((e.target as HTMLInputElement).value)} />
          </div>
        </div>

        {player && rounds.length > 0 && (
          <fieldset class="rounds-off">
            <legend>Rounds off (asked for)</legend>
            {rounds.map((r) => (
              <label key={r} class={`round-chip ${off.includes(r) ? "on" : ""}`}>
                <input
                  type="checkbox"
                  checked={off.includes(r)}
                  onChange={(e) => setOff((e.target as HTMLInputElement).checked ? [...off, r].sort((a, b) => a - b) : off.filter((x) => x !== r))}
                />
                {r}
              </label>
            ))}
          </fieldset>
        )}

        <button type="submit" class="btn primary block" disabled={busy || !name.trim()}>
          {busy ? "Saving…" : player ? "Save" : "Add to the tournament"}
        </button>
      </form>

      {player && player.status !== "expelled" && (
        <button
          type="button"
          class={`btn block ${player.status === "withdrawn" ? "" : "danger"}`}
          disabled={busy}
          onClick={() => save({ withdrawn: player.status !== "withdrawn" })}
        >
          {player.status === "withdrawn" ? "Re-enter the tournament" : "Withdraw from the tournament"}
        </button>
      )}
      {error && <Notice kind="error">{error}</Notice>}
    </Sheet>
  );
}
