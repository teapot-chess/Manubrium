// Hand edits to a paired round, the Pairings page's in a phone's shape:
// swap two players, mark one as not playing, give a lone player the bye,
// fill an empty seat, pair two from the pool, remove an empty last board,
// and finish the edits under the pairing checker.
//
// Every edit goes to the server, which applies the desk's own rules. Where
// the desk's dialog would ask a question, the server answers
// `needs_acknowledgement`; the phone shows the same question and sends the
// edit again only when the arbiter says so. Nothing queues: an edit needs
// the server's answer before the next one makes sense.

import { useState } from "preact/hooks";
import { needsAcknowledgement, type Board, type BoardPlayer, type HandEdit, type Round, type Tournament } from "../api";
import type { Ctx } from "./App";
import { describeError, Notice, Sheet } from "./common";
import { byeLabel } from "../byes";
import { t as tr } from "../i18n";

const ackLabels = (): Record<string, string> => ({
  frozen_round: tr("pe.ack.frozen_round"),
  sent_round_changed: tr("pe.ack.sent_round_changed"),
  pairing_rules: tr("pe.ack.pairing_rules"),
  second_half_bye: tr("pe.ack.second_half_bye"),
  mpa_pibe: tr("pe.ack.mpa_pibe"),
});

const byeTypes = (): [string, string][] => [
  ["absent", tr("pe.bye.absent")],
  ["requested-half", tr("pe.bye.requested-half")],
  ["requested-zero", tr("pe.bye.requested-zero")],
  ["full-point", tr("pe.bye.full-point")],
];

export type Ask = NonNullable<ReturnType<typeof needsAcknowledgement>>;

/**
 * Runs a server call that may ask a question first. `call(acks)` is made
 * with no answers; a `needs_acknowledgement` turns into `asking`, and
 * `answer()` makes the same call again with the ids the server named.
 */
export function useAsking(onError: (message: string) => void) {
  const [asking, setAsking] = useState<{ ask: Ask; call: (acks: string[]) => Promise<void> } | null>(null);
  const [busy, setBusy] = useState(false);

  async function attempt(call: (acks: string[]) => Promise<void>, acks: string[] = []) {
    setBusy(true);
    try {
      await call(acks);
      setAsking(null);
    } catch (e) {
      const ask = needsAcknowledgement(e);
      if (ask) setAsking({ ask, call });
      else {
        setAsking(null);
        onError(describeError(e));
      }
    } finally {
      setBusy(false);
    }
  }

  return {
    busy,
    asking,
    run: (call: (acks: string[]) => Promise<void>) => attempt(call),
    answer: () => (asking ? attempt(asking.call, asking.ask.confirm) : Promise.resolve()),
    cancel: () => setAsking(null),
  };
}

/** The desk's confirmation dialog, on a phone. */
export function AskBox(props: { ask: Ask; busy: boolean; onYes: () => void; onNo: () => void }) {
  const { ask } = props;
  const checker = ask.checker;
  return (
    <div class="ask" id="ask" role="alertdialog" aria-label={tr("round.confirm")}>
      {ask.summary && <p class="ask-summary">{ask.summary}</p>}
      {checker && (
        <>
          <p>
            {checker.checked
              ? tr("pe.checker_would")
              : tr("pe.checker_cannot")}
          </p>
          {checker.missing.length > 0 && <p class="fine">{tr("pe.checker_missing", { list: checker.missing.join("; ") })}</p>}
          {checker.added.length > 0 && <p class="fine">{tr("pe.checker_added", { list: checker.added.join("; ") })}</p>}
        </>
      )}
      {[...ask.warnings, ...(checker?.warnings ?? [])].map((w) => (
        <p key={w} class="warning">
          {w}
        </p>
      ))}
      <ul class="ask-list">
        {ask.confirm.map((id) => (
          <li key={id}>{Object.hasOwn(ackLabels(), id) ? ackLabels()[id] : id}</li>
        ))}
      </ul>
      <div class="two-btn">
        <button type="button" class="btn" onClick={props.onNo} disabled={props.busy}>
          {tr("common.cancel")}
        </button>
        <button type="button" class="btn primary" id="ask-yes" onClick={props.onYes} disabled={props.busy}>
          {tr("pe.do_anyway")}
        </button>
      </div>
    </div>
  );
}

function seated(round: Round): BoardPlayer[] {
  return round.boards.flatMap((b) => [b.white, b.black]).filter((p): p is BoardPlayer => !!p);
}

/** The sheet for changing one board. */
export function BoardEditSheet(props: {
  ctx: Ctx;
  t: Tournament;
  round: Round;
  board: Board;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { ctx, t, round, board } = props;
  const [error, setError] = useState<string | null>(null);
  const [swapFrom, setSwapFrom] = useState<BoardPlayer | null>(null);
  const [vacating, setVacating] = useState<BoardPlayer | null>(null);
  const [filling, setFilling] = useState(false);
  const flow = useAsking(setError);
  const pool = round.pool ?? [];
  const askType = t.settings.ask_bye_type === true;

  const apply = (edit: HandEdit, message: string) =>
    flow.run(async (acks) => {
      await ctx.api.edit(t.id, round.number, edit, acks);
      props.onDone(message);
    });

  const lone = board.white ?? board.black;
  let body;

  if (flow.asking) {
    body = <AskBox ask={flow.asking.ask} busy={flow.busy} onYes={flow.answer} onNo={flow.cancel} />;
  } else if (swapFrom) {
    const others = [
      ...seated(round).filter((p) => p.id !== swapFrom.id),
      ...pool.map((e) => e.player),
    ];
    body = (
      <>
        <p class="sheet-sub">{tr("pe.swap_with", { name: swapFrom.name })}</p>
        <ul class="list compact" id="swap-targets">
          {others.map((p) => (
            <li key={p.id} class="row">
              <button
                type="button"
                class="row-main"
                id={`swap-with-${p.id}`}
                disabled={flow.busy}
                onClick={() => apply({ kind: "swap", a: swapFrom.id, b: p.id }, tr("pe.swapped", { a: swapFrom.name, b: p.name }))}
              >
                <span class="row-title">{p.name}</span>
                <span class="row-sub">{boardOf(round, p.id) ?? tr("pe.not_on_board")}</span>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" class="btn ghost block" onClick={() => setSwapFrom(null)}>
          {tr("common.back")}
        </button>
      </>
    );
  } else if (vacating) {
    body = (
      <VacateForm
        player={vacating}
        askType={askType}
        busy={flow.busy}
        onBack={() => setVacating(null)}
        onVacate={(type) =>
          apply({ kind: "vacate", player: vacating.id, ...(type ? { bye_type: type } : {}) }, tr("pe.not_playing_msg", { name: vacating.name }))
        }
      />
    );
  } else if (filling) {
    body = (
      <>
        <p class="sheet-sub">{tr("pe.who_fills")}</p>
        {pool.length === 0 && <p class="fine">{tr("pe.everyone_on_board")}</p>}
        <ul class="list compact" id="fill-from">
          {pool.map((e) => (
            <li key={e.player.id} class="row">
              <button
                type="button"
                class="row-main"
                id={`fill-with-${e.player.id}`}
                disabled={flow.busy}
                onClick={() => apply({ kind: "fill", pairing: board.id, player: e.player.id }, tr("pe.joins", { name: e.player.name, label: board.label }))}
              >
                <span class="row-title">{e.player.name}</span>
                <span class="row-sub">{e.type ? byeLabel(e.type) : e.absent ? tr("pe.absent") : tr("pe.unpaired")}</span>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" class="btn ghost block" onClick={() => setFilling(false)}>
          {tr("common.back")}
        </button>
      </>
    );
  } else if (board.empty) {
    body = (
      <button
        type="button"
        class="btn danger block"
        id="delete-board"
        disabled={flow.busy}
        onClick={() => apply({ kind: "delete", pairing: board.id }, tr("pe.board_removed", { label: board.label }))}
      >
        {tr("pe.remove_board")}
      </button>
    );
  } else if (board.vacant && lone) {
    body = (
      <>
        <p class="sheet-sub">{tr("pe.no_opponent", { name: lone.name })}</p>
        <button
          type="button"
          class="btn primary block"
          id="give-bye"
          disabled={flow.busy}
          onClick={() => apply({ kind: "bye", pairing: board.id }, tr("pe.gets_bye", { name: lone.name }))}
        >
          {tr("pe.give_bye", { name: lone.name })}
        </button>
        <button type="button" class="btn block" id="fill-seat" onClick={() => setFilling(true)}>
          {tr("pe.fill_seat")}
        </button>
        <button type="button" class="btn block" onClick={() => setSwapFrom(lone)}>
          {tr("pe.swap_with_dots", { name: lone.name })}
        </button>
      </>
    );
  } else {
    const players = [board.white, board.black].filter((p): p is BoardPlayer => !!p);
    body = (
      <>
        {players.map((p) => (
          <div key={p.id} class="edit-player">
            <h3>{p.name}</h3>
            <button type="button" class="btn block" id={`swap-${p.id}`} onClick={() => setSwapFrom(p)}>
              {tr("pe.swap_another")}
            </button>
            {!board.bye && (
              <button type="button" class="btn ghost block" id={`vacate-${p.id}`} onClick={() => setVacating(p)}>
                {tr("pe.not_playing_round")}
              </button>
            )}
          </div>
        ))}
      </>
    );
  }

  return (
    <Sheet title={tr("pe.change_title", { label: board.label })} onClose={props.onClose}>
      {body}
      {error && (
        <Notice kind="error" onClose={() => setError(null)}>
          {error}
        </Notice>
      )}
    </Sheet>
  );
}

function boardOf(round: Round, playerId: number): string | null {
  const b = round.boards.find((x) => x.white?.id === playerId || x.black?.id === playerId);
  return b ? tr("round.board", { label: b.label }) : null;
}

function VacateForm(props: {
  player: BoardPlayer;
  askType: boolean;
  busy: boolean;
  onBack: () => void;
  onVacate: (type: string | null) => void;
}) {
  const [type, setType] = useState("absent");
  return (
    <form
      class="form"
      onSubmit={(e) => {
        e.preventDefault();
        props.onVacate(props.askType ? type : null);
      }}
    >
      <p class="sheet-sub">{tr("pe.leaves", { name: props.player.name })}</p>
      {props.askType && (
        <>
          <label for="vacate-type">{tr("pe.recorded_as")}</label>
          <select id="vacate-type" value={type} onChange={(e) => setType((e.target as HTMLSelectElement).value)}>
            {byeTypes().map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </>
      )}
      <button type="submit" class="btn primary block" id="vacate-confirm" disabled={props.busy}>
        {tr("pe.vacate_confirm", { name: props.player.name })}
      </button>
      <button type="button" class="btn ghost block" onClick={props.onBack}>
        {tr("common.back")}
      </button>
    </form>
  );
}

/** Everyone not on a board, for the desk's roles: pair two, or give one the bye. */
export function PoolPanel(props: { ctx: Ctx; t: Tournament; round: Round; onDone: (message: string) => void }) {
  const { ctx, t, round } = props;
  const [picked, setPicked] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const flow = useAsking(setError);
  const pool = round.pool ?? [];
  if (pool.length === 0) return null;

  const name = (id: number) => pool.find((e) => e.player.id === id)?.player.name ?? "?";
  const apply = (edit: HandEdit, message: string) =>
    flow.run(async (acks) => {
      await ctx.api.edit(t.id, round.number, edit, acks);
      setPicked([]);
      props.onDone(message);
    });

  return (
    <section class="pool" id="pool">
      <h3>{tr("pe.not_on_board")}</h3>
      <ul class="list compact">
        {pool.map((e) => (
          <li key={e.player.id} class="row">
            <label class="row-main pick">
              <input
                type="checkbox"
                id={`pool-${e.player.id}`}
                checked={picked.includes(e.player.id)}
                disabled={t.read_only}
                onChange={(ev) =>
                  setPicked((ev.target as HTMLInputElement).checked ? [...picked, e.player.id].slice(-2) : picked.filter((x) => x !== e.player.id))
                }
              />
              <span>
                <span class="row-title">{e.player.name}</span>
                <span class="row-sub">{e.type ? byeLabel(e.type) : e.absent ? tr("pe.absent") : tr("pe.unpaired")}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {flow.asking && <AskBox ask={flow.asking.ask} busy={flow.busy} onYes={flow.answer} onNo={flow.cancel} />}
      {!flow.asking && picked.length === 2 && (
        <button
          type="button"
          class="btn primary block"
          id="pool-pair"
          disabled={flow.busy}
          onClick={() => {
            const [a, b] = picked;
            apply({ kind: "pool_pair", a, b }, tr("pe.pair_done", { a: name(a), b: name(b) }));
          }}
        >
          {tr("pe.pair_two", { a: name(picked[0]), b: name(picked[1]) })}
        </button>
      )}
      {!flow.asking && picked.length === 1 && (
        <button
          type="button"
          class="btn block"
          id="pool-bye"
          disabled={flow.busy}
          onClick={() => apply({ kind: "pool_bye", player: picked[0] }, tr("pe.gets_bye", { name: name(picked[0]) }))}
        >
          {tr("pe.give_bye", { name: name(picked[0]) })}
        </button>
      )}
      {error && (
        <Notice kind="error" onClose={() => setError(null)}>
          {error}
        </Notice>
      )}
    </section>
  );
}

/**
 * Hand edits are open on this round: say so, and finish them under the
 * checker - or undo them, back to where they began, while the server says
 * that is still possible (the desk's "Discard hand edits"; one way back,
 * not a step-by-step one).
 */
export function FinishEdits(props: { ctx: Ctx; t: Tournament; round: Round; onDone: (message: string) => void }) {
  const { ctx, t, round } = props;
  const [error, setError] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [busy, setBusy] = useState(false);
  const flow = useAsking(setError);
  if (!round.hand_edits?.open) return null;

  async function undo() {
    setBusy(true);
    setError(null);
    try {
      await ctx.api.discardEdits(t.id, round.number);
      setUndoing(false);
      props.onDone(tr("pe.discarded", { n: round.number }));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="hand-edits" id="hand-edits">
      <Notice kind="info">{tr("pe.hand_edits_open", { n: round.number })}</Notice>
      {flow.asking ? (
        <AskBox ask={flow.asking.ask} busy={flow.busy} onYes={flow.answer} onNo={flow.cancel} />
      ) : (
        <button
          type="button"
          class="btn primary block"
          id="finish-edits"
          disabled={flow.busy || t.read_only}
          onClick={() =>
            flow.run(async (acks) => {
              const { pibe } = await ctx.api.finishEdits(t.id, round.number, acks);
              props.onDone(pibe ? tr("pe.finished_pibe", { pibe }) : tr("pe.finished"));
            })
          }
        >
          {tr("pe.finish")}
        </button>
      )}
      {round.hand_edits.discardable && !t.read_only && !flow.asking && (
        undoing ? (
          <div class="ask" id="discard-ask" role="alertdialog" aria-label={tr("pe.discard")}>
            <p>{tr("pe.discard_q", { n: round.number })}</p>
            <div class="two-btn">
              <button type="button" class="btn" id="discard-keep" disabled={busy} onClick={() => setUndoing(false)}>
                {tr("common.keep")}
              </button>
              <button type="button" class="btn danger" id="discard-yes" disabled={busy} onClick={undo}>
                {tr("pe.discard_yes")}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" class="btn ghost block" id="discard-edits" disabled={flow.busy} onClick={() => setUndoing(true)}>
            {tr("pe.discard")}
          </button>
        )
      )}
      {error && (
        <Notice kind="error" onClose={() => setError(null)}>
          {error}
        </Notice>
      )}
    </div>
  );
}
