// Players: adding them from the FIDE or national list (or by hand), the
// check-in at the door, late entries, withdrawing and re-entering, byes,
// the basic fields. Online only - each change waits for the server's yes,
// because the next pairing depends on it.

import { useEffect, useRef, useState } from "preact/hooks";
import { ApiError, type Bye, type Player, type SearchHit, type Tournament } from "../api";
import { byeRows, byesChanged, byesToSend, setBye } from "../byes";
import { DEBOUNCE_MS, hitDetails, MIN_QUERY, searchQuery, sourceOf } from "../search";
import type { Ctx } from "./App";
import { describeError, Empty, Loading, Notice, Sheet } from "./common";

export function PlayersScreen(props: { ctx: Ctx; t: Tournament }) {
  const { ctx, t } = props;
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Player | "new" | null>(null);
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState("");
  const [checkIn, setCheckIn] = useState(false);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);

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

  // Ticked at once, sent at once; put back if the server says no.
  async function togglePresent(p: Player) {
    const present = !p.present;
    const swap = (to: Player) => setPlayers((list) => (list ?? []).map((x) => (x.id === to.id ? to : x)));
    swap({ ...p, present });
    setBusy(p.id);
    setError(null);
    try {
      const saved = await ctx.api.updatePlayer(t.id, p.id, { present });
      if (saved && typeof saved.id === "number") swap({ ...p, ...saved });
    } catch (e) {
      swap(p);
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  }

  const playing = (players ?? []).filter((p) => p.status === "active");
  const here = playing.filter((p) => p.present).length;
  const needle = filter.trim().toLowerCase();
  const shown = (players ?? []).filter(
    (p) => p.name.toLowerCase().includes(needle) && !(checkIn && onlyMissing && (p.present || p.status !== "active")),
  );

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
          <button type="button" class="btn primary" id="add-player" onClick={() => setAdding(true)}>
            Add
          </button>
        )}
      </div>

      {!t.read_only && players && players.length > 0 && (
        <div class={`checkin-bar ${checkIn ? "on" : ""}`}>
          <button
            type="button"
            class={`chip ${checkIn ? "active" : ""}`}
            id="checkin-toggle"
            aria-pressed={checkIn}
            onClick={() => {
              setCheckIn(!checkIn);
              setOnlyMissing(false);
            }}
          >
            {checkIn ? "Done" : "Check-in"}
          </button>
          <span class="checkin-count" id="checkin-count">
            {here} of {playing.length} present
          </span>
          {checkIn && (
            <button
              type="button"
              class={`chip ${onlyMissing ? "active" : ""}`}
              id="checkin-missing"
              aria-pressed={onlyMissing}
              onClick={() => setOnlyMissing(!onlyMissing)}
            >
              Not yet here
            </button>
          )}
        </div>
      )}

      {error && (
        <Notice kind="error" onClose={() => setError(null)}>
          {error}
        </Notice>
      )}
      {!players && !error && <Loading />}
      {players && shown.length === 0 && (
        <Empty>{checkIn && onlyMissing && !needle ? "Everybody is here." : filter ? "Nobody by that name." : "No players yet."}</Empty>
      )}
      <ul class="list" id="player-list">
        {shown.map((p) => (
          <li key={p.id} class={`row ${checkIn && p.present ? "is-present" : ""}`}>
            <button
              type="button"
              class="row-main"
              disabled={t.read_only || (checkIn && (busy === p.id || p.status !== "active"))}
              onClick={() => (checkIn ? togglePresent(p) : setEditing(p))}
              id={checkIn ? `present-${p.id}` : `player-${p.id}`}
              aria-pressed={checkIn ? !!p.present : undefined}
            >
              <span class="row-title">
                {p.pairing_number ? <span class="tpn">{p.pairing_number}</span> : null}
                {p.title && <em>{p.title} </em>}
                {p.name}
                {p.status !== "active" && <span class="tag warn">{p.status}</span>}
                {!checkIn && p.present && <span class="tag">here</span>}
              </span>
              <span class="row-sub">
                {[p.rating, p.federation, p.club].filter(Boolean).join(" · ")}
                {p.byes && p.byes.length > 0
                  ? ` · bye in round ${p.byes.map((b) => b.round).join(", ")}`
                  : p.absent_rounds.length > 0 && ` · off in round ${p.absent_rounds.join(", ")}`}
              </span>
            </button>
            {checkIn && p.status === "active" && (
              <span class={`tick ${p.present ? "on" : ""}`} aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              </span>
            )}
          </li>
        ))}
      </ul>

      {adding && (
        <AddPlayersSheet
          ctx={ctx}
          t={t}
          onAdded={load}
          onManual={() => {
            setAdding(false);
            setEditing("new");
          }}
          onClose={() => setAdding(false)}
        />
      )}

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

// Search the lists the server offers and tap to add; typing by hand is the
// fallback for whoever is on none of them. The sheet stays open, because
// late entries come in groups.
export function AddPlayersSheet(props: { ctx: Ctx; t: Tournament; onAdded: () => void; onManual: () => void; onClose: () => void }) {
  const { ctx, t } = props;
  const [sources, setSources] = useState<{ id: string; label: string }[]>([{ id: "fide", label: "FIDE" }]);
  const [source, setSource] = useState("fide");
  const [text, setText] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const asked = useRef(0);

  useEffect(() => {
    ctx.api.tournamentOptions().then(
      (o) => {
        if (Array.isArray(o.player_sources) && o.player_sources.length > 0) {
          setSources(o.player_sources);
          if (!o.player_sources.some((s) => s.id === "fide")) setSource(o.player_sources[0].id);
        }
      },
      () => undefined, // FIDE alone, then; the search itself says so if the server is gone
    );
  }, []);

  useEffect(() => {
    const q = searchQuery(text);
    const ask = ++asked.current;
    if (!q) {
      setHits(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const found = await ctx.api.searchPlayers(t.id, q, source);
        if (ask !== asked.current) return; // typed on meanwhile
        setHits(found);
        setError(null);
      } catch (e) {
        if (ask === asked.current) setError(describeError(e));
      } finally {
        if (ask === asked.current) setSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, source]);

  const key = (h: SearchHit) => `${h.source}:${h.fide_id ?? ""}:${h.national_id ?? ""}`;
  const listName = sources.find((s) => s.id === source)?.label ?? "the";

  async function add(h: SearchHit) {
    const from = sourceOf(h);
    if (!from) {
      setError("That entry has no id on the list to add by. Enter the player by hand.");
      return;
    }
    setAdding(key(h));
    setError(null);
    try {
      await ctx.api.addPlayerFrom(t.id, from);
      setAdded((list) => [...list, key(h)]);
      props.onAdded();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setAdding(null);
    }
  }

  return (
    <Sheet title="Add players" onClose={props.onClose}>
      {sources.length > 1 && (
        <div class="segmented" role="group" aria-label="Which list">
          {sources.map((s) => (
            <button
              type="button"
              key={s.id}
              id={`source-${s.id}`}
              class={source === s.id ? "active" : ""}
              aria-pressed={source === s.id}
              onClick={() => setSource(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
      <label for="player-search">Name or ID on the {listName} list</label>
      <input
        id="player-search"
        type="search"
        value={text}
        autocomplete="off"
        spellcheck={false}
        placeholder="Last name, first name"
        onInput={(e) => setText((e.target as HTMLInputElement).value)}
      />
      {error && <Notice kind="error">{error}</Notice>}
      {!searchQuery(text) && <p class="fine">At least {MIN_QUERY} letters. Tap a name to add it; the list's details come along.</p>}
      {searching && !hits && <Loading />}
      {hits && hits.length === 0 && !searching && <Empty>Nobody by that name on this list.</Empty>}
      {hits && hits.length > 0 && (
        <ul class={`list compact search-hits ${searching ? "stale" : ""}`} id="search-hits">
          {hits.map((h, i) => {
            const k = key(h);
            const done = h.already_in || added.includes(k);
            return (
              <li key={k} class="row">
                <button type="button" class="row-main" id={`hit-${i}`} disabled={done || adding !== null} onClick={() => add(h)}>
                  <span class="row-title">
                    {h.title && <em>{h.title} </em>}
                    {h.name}
                    {h.already_in && <span class="tag">In the tournament</span>}
                    {!h.already_in && added.includes(k) && <span class="tag">Added</span>}
                  </span>
                  <span class="row-sub">{hitDetails(h)}</span>
                </button>
                {!done && (
                  <span class="add-plus" aria-hidden="true">
                    {adding === k ? "…" : "+"}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" class="btn ghost block" id="add-by-hand" onClick={props.onManual}>
        Not on a list? Enter by hand
      </button>
    </Sheet>
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
  // A server that names bye kinds keeps byes per round; an older one only knows "rounds off".
  const byesMode = !!player && (t.bye_kinds?.length ?? 0) > 0 && Array.isArray(player.byes);
  const [byes, setByes] = useState<Bye[]>(player?.byes ?? []);

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
          save(player && !byesMode ? { ...basic, absent_rounds: off } : basic);
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

        {player && !byesMode && rounds.length > 0 && (
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

      {byesMode && player && <ByesEditor ctx={ctx} t={t} player={player} byes={byes} onChange={setByes} onSaved={props.onSaved} />}

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

// A player's requested byes, round by round. Paired rounds are shown, not
// changed; what may be asked for is the server's call, and it says why not.
function ByesEditor(props: { ctx: Ctx; t: Tournament; player: Player; byes: Bye[]; onChange: (b: Bye[]) => void; onSaved: () => void }) {
  const { ctx, t, player, byes } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kinds = t.bye_kinds ?? [];
  const label = (id: string) => kinds.find((k) => k.id === id)?.label ?? id;
  const rows = byeRows(t.rounds_count ?? 0, t.paired_rounds, byes);
  const changed = byesChanged(player.byes ?? [], byes, t.paired_rounds);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await ctx.api.setByes(t.id, player.id, byesToSend(byes, t.paired_rounds));
      props.onSaved();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section class="byes-editor" id="byes-editor">
      <h3>Byes</h3>
      {rows.length === 0 && <p class="fine">The number of rounds is not set yet.</p>}
      <ul class="bye-rows">
        {rows.map((r) => (
          <li key={r.round} class={r.locked ? "locked" : r.kind ? "on" : ""}>
            <span class="bye-round">Round {r.round}</span>
            {r.locked ? (
              <span class="bye-fixed" id={`bye-${r.round}`}>
                {r.kind ? label(r.kind) : "Plays"}
                <small>paired</small>
              </span>
            ) : (
              <select
                id={`bye-${r.round}`}
                aria-label={`Round ${r.round}`}
                value={r.kind ?? ""}
                onChange={(e) => props.onChange(setBye(byes, r.round, (e.target as HTMLSelectElement).value || null, t.paired_rounds))}
              >
                <option value="">Plays</option>
                {kinds.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
                {r.kind && !kinds.some((k) => k.id === r.kind) && <option value={r.kind}>{r.kind}</option>}
              </select>
            )}
          </li>
        ))}
      </ul>
      <button type="button" class="btn block" id="save-byes" disabled={busy || !changed} onClick={save}>
        {busy ? "Saving…" : "Save the byes"}
      </button>
      {error && <Notice kind="error">{error}</Notice>}
    </section>
  );
}
