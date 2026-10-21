// A new tournament from the phone: the short form, the rest at the desk.
// Online only, and not queued - a tournament half-made on a phone in a
// basement is nobody's friend.

import { useEffect, useState } from "preact/hooks";
import type { NewTournament as Fields, Tournament, TournamentOptions } from "../api";
import type { Ctx } from "./App";
import { describeError, Loading, Notice, TopBar } from "./common";

type Form = {
  name: string;
  start_date: string;
  end_date: string;
  city: string;
  venue: string;
  system: string;
  rounds_count: string;
  time_control: string;
  federation: string;
  rated: boolean;
};

const today = () => new Date().toISOString().slice(0, 10);

/** The form's first state: the server's defaults where it gives them, today's date otherwise. */
export function startForm(options: TournamentOptions | null): Form {
  const d = options?.defaults ?? {};
  const str = (k: string, fallback = "") => (typeof d[k] === "string" ? (d[k] as string) : typeof d[k] === "number" ? String(d[k]) : fallback);
  return {
    name: str("name"),
    start_date: str("start_date", today()),
    end_date: str("end_date", str("start_date", today())),
    city: str("city"),
    venue: str("venue"),
    system: str("system", options?.systems[0]?.id ?? ""),
    rounds_count: str("rounds_count"),
    time_control: str("time_control"),
    federation: str("federation"),
    rated: typeof d.rated === "boolean" ? d.rated : false,
  };
}

/** What `POST /tournaments` gets: blanks as null, rounds as a number. */
export function toFields(f: Form): Fields {
  const blank = (s: string) => (s.trim() === "" ? null : s.trim());
  const rounds = parseInt(f.rounds_count, 10);
  return {
    name: f.name.trim(),
    start_date: blank(f.start_date),
    end_date: blank(f.end_date),
    city: blank(f.city),
    venue: blank(f.venue),
    system: f.system,
    rounds_count: Number.isFinite(rounds) && rounds > 0 ? rounds : null,
    time_control: blank(f.time_control),
    federation: blank(f.federation)?.toUpperCase() ?? null,
    rated: f.rated,
  };
}

export function NewTournament(props: { ctx: Ctx; onCancel: () => void; onCreated: (t: Tournament) => void }) {
  const { ctx } = props;
  const [options, setOptions] = useState<TournamentOptions | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setError(null);
    try {
      const o = await ctx.api.tournamentOptions();
      setOptions(o);
      setForm(startForm(o));
    } catch (e) {
      setError(describeError(e));
    }
  }

  useEffect(() => {
    load();
  }, [ctx.server.base]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const text = (k: keyof Form) => (e: Event) => set(k, (e.target as HTMLInputElement).value as never);

  async function create(e: Event) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      props.onCreated(await ctx.api.createTournament(toFields(form)));
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="screen">
      <TopBar title="New tournament" subtitle={ctx.server.label} onBack={props.onCancel} backLabel="Tournaments" />
      <main class="content narrow">
        {error && (
          <Notice kind="error" onClose={form ? () => setError(null) : undefined}>
            {error}
          </Notice>
        )}
        {!form && !error && <Loading />}
        {!form && error && (
          <button type="button" class="btn block" onClick={load}>
            Try again
          </button>
        )}
        {form && options && (
          <form class="form" id="new-tournament" onSubmit={create}>
            <label for="nt-name">Name</label>
            <input id="nt-name" required value={form.name} onInput={text("name")} placeholder="Hall Open 2026" />
            <div class="two">
              <div>
                <label for="nt-start">Starts</label>
                <input id="nt-start" type="date" value={form.start_date} onInput={text("start_date")} />
              </div>
              <div>
                <label for="nt-end">Ends</label>
                <input id="nt-end" type="date" min={form.start_date || undefined} value={form.end_date} onInput={text("end_date")} />
              </div>
            </div>
            <div class="two">
              <div>
                <label for="nt-city">City</label>
                <input id="nt-city" value={form.city} onInput={text("city")} />
              </div>
              <div>
                <label for="nt-venue">Venue</label>
                <input id="nt-venue" value={form.venue} onInput={text("venue")} />
              </div>
            </div>
            <label for="nt-system">System</label>
            <select id="nt-system" value={form.system} onChange={(e) => set("system", (e.target as HTMLSelectElement).value)}>
              {options.systems.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <div class="two">
              <div>
                <label for="nt-rounds">Rounds</label>
                <input id="nt-rounds" type="number" inputMode="numeric" min={1} max={99} value={form.rounds_count} onInput={text("rounds_count")} />
              </div>
              <div>
                <label for="nt-tc">Time control</label>
                <input id="nt-tc" value={form.time_control} onInput={text("time_control")} placeholder="90+30" />
              </div>
            </div>
            <div class="two">
              <div>
                <label for="nt-fed">Federation</label>
                <input
                  id="nt-fed"
                  maxLength={3}
                  value={form.federation}
                  onInput={(e) => set("federation", (e.target as HTMLInputElement).value.toUpperCase())}
                  placeholder="BEL"
                />
              </div>
              <div class="check-cell">
                <label class="check" for="nt-rated">
                  <input id="nt-rated" type="checkbox" checked={form.rated} onChange={(e) => set("rated", (e.target as HTMLInputElement).checked)} />
                  FIDE rated
                </label>
              </div>
            </div>
            <button type="submit" class="btn primary block" id="nt-create" disabled={busy || !form.name.trim() || !form.system}>
              {busy ? "Making it…" : "Make the tournament"}
            </button>
            <p class="fine">Needs a connection. Tie-breaks, arbiters and the rest wait at the desk, or under More once it exists.</p>
          </form>
        )}
      </main>
    </div>
  );
}
