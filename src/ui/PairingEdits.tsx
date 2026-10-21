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

const ACK_LABELS: Record<string, string> = {
  frozen_round: "This is not the latest round. Change it anyway.",
  sent_round_changed: "This round was already sent for rating. Change it anyway.",
  pairing_rules: "Keep these boards although they break the pairing rules.",
  second_half_bye: "This is the player's second half-point bye. Give it anyway.",
  mpa_pibe: "Keep the boards as they are; the difference is recorded with the round.",
};

const BYE_TYPES: [string, string][] = [
  ["absent", "Absent"],
  ["requested-half", "Half-point bye"],
  ["requested-zero", "Zero-point bye"],
  ["full-point", "Full-point bye"],
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
    <div class="ask" id="ask" role="alertdialog" aria-label="Confirm">
      {ask.summary && <p class="ask-summary">{ask.summary}</p>}
      {checker && (
        <>
          <p>
            {checker.checked
              ? "The pairing checker would pair this round differently."
              : "This round cannot be checked; the change itself is recorded."}
          </p>
          {checker.missing.length > 0 && <p class="fine">Checker's boards not here: {checker.missing.join("; ")}</p>}
          {checker.added.length > 0 && <p class="fine">Boards the checker would not make: {checker.added.join("; ")}</p>}
        </>
      )}
      {[...ask.warnings, ...(checker?.warnings ?? [])].map((w) => (
        <p key={w} class="warning">
          {w}
        </p>
      ))}
      <ul class="ask-list">
        {ask.confirm.map((id) => (
          <li key={id}>{ACK_LABELS[id] ?? id}</li>
        ))}
      </ul>
      <div class="two-btn">
        <button type="button" class="btn" onClick={props.onNo} disabled={props.busy}>
          Cancel
        </button>
        <button type="button" class="btn primary" id="ask-yes" onClick={props.onYes} disabled={props.busy}>
          Do it anyway
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
        <p class="sheet-sub">Swap {swapFrom.name} with:</p>
        <ul class="list compact" id="swap-targets">
          {others.map((p) => (
            <li key={p.id} class="row">
              <button
                type="button"
                class="row-main"
                id={`swap-with-${p.id}`}
                disabled={flow.busy}
                onClick={() => apply({ kind: "swap", a: swapFrom.id, b: p.id }, `${swapFrom.name} and ${p.name} swapped.`)}
              >
                <span class="row-title">{p.name}</span>
                <span class="row-sub">{boardOf(round, p.id) ?? "Not on a board"}</span>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" class="btn ghost block" onClick={() => setSwapFrom(null)}>
          Back
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
          apply({ kind: "vacate", player: vacating.id, ...(type ? { bye_type: type } : {}) }, `${vacating.name} is not playing this round.`)
        }
      />
    );
  } else if (filling) {
    body = (
      <>
        <p class="sheet-sub">Who takes the empty seat?</p>
        {pool.length === 0 && <p class="fine">Everyone is on a board.</p>}
        <ul class="list compact" id="fill-from">
          {pool.map((e) => (
            <li key={e.player.id} class="row">
              <button
                type="button"
                class="row-main"
                id={`fill-with-${e.player.id}`}
                disabled={flow.busy}
                onClick={() => apply({ kind: "fill", pairing: board.id, player: e.player.id }, `${e.player.name} joins board ${board.label}.`)}
              >
                <span class="row-title">{e.player.name}</span>
                <span class="row-sub">{e.type ?? (e.absent ? "absent" : "unpaired")}</span>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" class="btn ghost block" onClick={() => setFilling(false)}>
          Back
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
        onClick={() => apply({ kind: "delete", pairing: board.id }, `Board ${board.label} removed.`)}
      >
        Remove this board
      </button>
    );
  } else if (board.vacant && lone) {
    body = (
      <>
        <p class="sheet-sub">{lone.name} has no opponent.</p>
        <button
          type="button"
          class="btn primary block"
          id="give-bye"
          disabled={flow.busy}
          onClick={() => apply({ kind: "bye", pairing: board.id }, `${lone.name} gets the bye.`)}
        >
          Give {lone.name} the bye
        </button>
        <button type="button" class="btn block" id="fill-seat" onClick={() => setFilling(true)}>
          Fill the empty seat
        </button>
        <button type="button" class="btn block" onClick={() => setSwapFrom(lone)}>
          Swap {lone.name} with…
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
              Swap with another player
            </button>
            {!board.bye && (
              <button type="button" class="btn ghost block" id={`vacate-${p.id}`} onClick={() => setVacating(p)}>
                Not playing this round
              </button>
            )}
          </div>
        ))}
      </>
    );
  }

  return (
    <Sheet title={`Board ${board.label}: change the pairing`} onClose={props.onClose}>
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
  return b ? `Board ${b.label}` : null;
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
      <p class="sheet-sub">{props.player.name} leaves the board; the opponent waits for a new one or a bye.</p>
      {props.askType && (
        <>
          <label for="vacate-type">Recorded as</label>
          <select id="vacate-type" value={type} onChange={(e) => setType((e.target as HTMLSelectElement).value)}>
            {BYE_TYPES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </>
      )}
      <button type="submit" class="btn primary block" id="vacate-confirm" disabled={props.busy}>
        {props.player.name} is not playing
      </button>
      <button type="button" class="btn ghost block" onClick={props.onBack}>
        Back
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
      <h3>Not on a board</h3>
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
                <span class="row-sub">{e.type ?? (e.absent ? "absent" : "unpaired")}</span>
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
            apply({ kind: "pool_pair", a, b }, `${name(a)} – ${name(b)} on a new board.`);
          }}
        >
          Pair {name(picked[0])} – {name(picked[1])} on a new board
        </button>
      )}
      {!flow.asking && picked.length === 1 && (
        <button
          type="button"
          class="btn block"
          id="pool-bye"
          disabled={flow.busy}
          onClick={() => apply({ kind: "pool_bye", player: picked[0] }, `${name(picked[0])} gets the bye.`)}
        >
          Give {name(picked[0])} the bye
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

/** Hand edits are open on this round: say so, and finish them under the checker. */
export function FinishEdits(props: { ctx: Ctx; t: Tournament; round: Round; onDone: (message: string) => void }) {
  const { ctx, t, round } = props;
  const [error, setError] = useState<string | null>(null);
  const flow = useAsking(setError);
  if (!round.hand_edits?.open) return null;

  return (
    <div class="hand-edits" id="hand-edits">
      <Notice kind="info">Round {round.number} has hand edits open. Finish them when the boards are right: the pairing checker looks at the round then.</Notice>
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
              props.onDone(pibe ? `Hand edits finished; recorded as ${pibe}.` : "Hand edits finished.");
            })
          }
        >
          Finish hand edits
        </button>
      )}
      {error && (
        <Notice kind="error" onClose={() => setError(null)}>
          {error}
        </Notice>
      )}
    </div>
  );
}
