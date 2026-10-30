// The settings an arbiter changes mid-event, from the phone: the server
// says which ones it will take now (`settings.editable` - FIDE mode and a
// paired round lock some), and checks every change as the desk's Settings
// pages do. Everything else stays at the desk.

import { useState } from "preact/hooks";
import type { SettingsChange, Tournament } from "../api";
import type { Ctx } from "./App";
import { describeError, Notice, Sheet } from "./common";
import { t as tr } from "../i18n";

const textFields = (): [keyof SettingsChange, string][] => [
  ["time_control", tr("set.time_control")],
  ["chief_arbiter", tr("set.chief_arbiter")],
  ["deputy_arbiter", tr("set.deputy_arbiter")],
  ["venue", tr("set.venue")],
  ["city", tr("set.city")],
];

const byeValues = (): [number, string][] => [
  [1, tr("set.bye_1")],
  [0.5, tr("set.bye_half")],
  [0, tr("set.bye_0")],
];

type Draft = Record<string, unknown>;

export function initial(t: Tournament): Draft {
  const s = t.settings;
  return {
    time_control: s.time_control ?? "",
    chief_arbiter: s.chief_arbiter ?? "",
    deputy_arbiter: s.deputy_arbiter ?? "",
    venue: s.venue ?? "",
    city: s.city ?? "",
    rounds_count: s.rounds_count ?? t.rounds_count ?? 1,
    bye_value: s.bye_value ?? 1,
    ask_bye_type: s.ask_bye_type === true,
    shared_places: s.shared_places === true,
    tiebreaks: Array.isArray(s.configured_tiebreaks) ? [...(s.configured_tiebreaks as string[])] : [],
  };
}

/** Only what changed, and only what the server said it would take. */
export function changes(t: Tournament, draft: Draft): SettingsChange {
  const before = initial(t);
  const editable = (t.settings.editable as string[] | undefined) ?? [];
  const out: Record<string, unknown> = {};
  for (const key of editable) {
    if (JSON.stringify(draft[key]) !== JSON.stringify(before[key])) out[key] = draft[key];
  }
  return out as SettingsChange;
}

export function SettingsEditor(props: { ctx: Ctx; t: Tournament; onClose: () => void; onSaved: () => void }) {
  const { ctx, t } = props;
  const [draft, setDraft] = useState<Draft>(() => initial(t));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const editable = new Set((t.settings.editable as string[] | undefined) ?? []);
  const options = (t.settings.tiebreak_options as { code: string; name: string }[] | undefined) ?? [];
  const tiebreaks = draft.tiebreaks as string[];
  const set = (key: string, value: unknown) => setDraft({ ...draft, [key]: value });
  const nameOf = (code: string) => options.find((o) => o.code === code)?.name ?? code;
  const diff = changes(t, draft);

  async function save(e: Event) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await ctx.api.updateSettings(t.id, diff);
      props.onSaved();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  function move(i: number, by: number) {
    const next = [...tiebreaks];
    const [x] = next.splice(i, 1);
    next.splice(i + by, 0, x);
    set("tiebreaks", next);
  }

  return (
    <Sheet title={tr("set.title")} onClose={props.onClose} dirty={Object.keys(diff).length > 0}>
      <form class="form" id="settings-form" onSubmit={save}>
        {textFields().map(([key, label]) => (
          <div key={key}>
            <label for={`set-${key}`}>{label}</label>
            <input
              id={`set-${key}`}
              value={String(draft[key] ?? "")}
              disabled={!editable.has(key)}
              onInput={(e) => set(key, (e.target as HTMLInputElement).value)}
            />
          </div>
        ))}

        <div class="two">
          <div>
            <label for="set-rounds_count">{tr("set.rounds")}</label>
            <input
              id="set-rounds_count"
              type="number"
              inputMode="numeric"
              min={t.paired_rounds || 1}
              value={String(draft.rounds_count)}
              disabled={!editable.has("rounds_count")}
              onInput={(e) => set("rounds_count", Number((e.target as HTMLInputElement).value))}
            />
          </div>
          <div>
            <label for="set-bye_value">{tr("set.bye_scores")}</label>
            <select
              id="set-bye_value"
              value={String(draft.bye_value)}
              disabled={!editable.has("bye_value")}
              onChange={(e) => set("bye_value", Number((e.target as HTMLSelectElement).value))}
            >
              {byeValues().map(([v, l]) => (
                <option key={v} value={String(v)}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label class="check">
          <input
            type="checkbox"
            id="set-ask_bye_type"
            checked={draft.ask_bye_type === true}
            disabled={!editable.has("ask_bye_type")}
            onChange={(e) => set("ask_bye_type", (e.target as HTMLInputElement).checked)}
          />
          <span>{tr("set.ask_bye_type")}</span>
        </label>
        <label class="check">
          <input
            type="checkbox"
            id="set-shared_places"
            checked={draft.shared_places === true}
            disabled={!editable.has("shared_places")}
            onChange={(e) => set("shared_places", (e.target as HTMLInputElement).checked)}
          />
          <span>{tr("set.shared_places")}</span>
        </label>

        <h3>{tr("set.tiebreaks")}</h3>
        {!editable.has("tiebreaks") && <p class="fine">{tr("set.tiebreaks_locked")}</p>}
        <ol class="list compact tiebreaks" id="set-tiebreaks">
          {tiebreaks.map((code, i) => (
            <li key={code} class="row">
              <span class="row-main static">
                <span class="row-title">{nameOf(code)}</span>
              </span>
              {editable.has("tiebreaks") && (
                <span class="row-tools">
                  <button type="button" class="icon-btn subtle" aria-label={tr("set.move_up", { name: nameOf(code) })} disabled={i === 0} onClick={() => move(i, -1)}>
                    ↑
                  </button>
                  <button type="button" class="icon-btn subtle" aria-label={tr("set.remove", { name: nameOf(code) })} onClick={() => set("tiebreaks", tiebreaks.filter((c) => c !== code))}>
                    ×
                  </button>
                </span>
              )}
            </li>
          ))}
        </ol>
        {editable.has("tiebreaks") && (
          <>
            <label for="set-add-tiebreak">{tr("set.add_tiebreak")}</label>
            <select
              id="set-add-tiebreak"
              value=""
              onChange={(e) => {
                const code = (e.target as HTMLSelectElement).value;
                if (code) set("tiebreaks", [...tiebreaks, code]);
              }}
            >
              <option value="">{tr("set.choose")}</option>
              {options
                .filter((o) => !tiebreaks.includes(o.code))
                .map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.name}
                  </option>
                ))}
            </select>
          </>
        )}

        {error && <Notice kind="error">{error}</Notice>}
        <button type="submit" class="btn primary block" id="settings-save" disabled={busy || Object.keys(diff).length === 0}>
          {busy ? tr("set.saving") : tr("set.save")}
        </button>
      </form>
    </Sheet>
  );
}
