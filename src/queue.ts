// The outbox: results tapped while the hall has no signal wait here, in
// order, and are sent when it does.
//
// Every entry gets a client id (`cid`) when it is tapped and keeps it until
// the server has answered it. The server stores the cid with what it did,
// so sending an entry twice - the answer got lost, the app was killed
// mid-request - saves it once. Each result says what the board said when it
// was tapped (`expected`); the server refuses it if the board has changed
// since, and the refusal stays on screen until somebody reads it. Nothing
// is dropped quietly.
//
// Only results and incidents queue. Pairing, publishing and players need the
// server's answer before anything else makes sense, so they are online-only
// and say so.

import { OfflineError, type Entry, type EntryAnswer, type ResultEntry } from "./api";
import { t } from "./i18n";

export interface KeyValue {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export interface Queued {
  server: string;
  tournament: number;
  entry: Entry;
  state: "waiting" | "refused";
  message?: string | null;
  reason?: string | null;
  /** The board as the round showed it ("2", "12a"), kept for the refusal's sake. */
  label?: string;
}

export interface FlushOutcome {
  saved: number;
  refused: number;
  waiting: number;
  offline: boolean;
}

const KEY = "manubrium.outbox.v1";
const BATCH = 25; // the server's Mobile.Sync.max_batch

// Up to BATCH entries a request, in order - except that an incident with a
// photo travels alone: a megabyte or two of base64 is enough for one request,
// and twenty-five of them would be more than the server reads.
function batches(waiting: Queued[]): Queued[][] {
  const out: Queued[][] = [];
  let current: Queued[] = [];
  for (const q of waiting) {
    const heavy = q.entry.kind === "incident" && !!q.entry.photo;
    if (heavy || current.length === BATCH) {
      if (current.length) out.push(current);
      current = [];
    }
    if (heavy) out.push([q]);
    else current.push(q);
  }
  if (current.length) out.push(current);
  return out;
}

export class Outbox {
  private items: Queued[] = [];
  private loaded = false;
  private flushing = new Map<string, Promise<FlushOutcome>>();

  constructor(
    private readonly store: KeyValue,
    private readonly uuid: () => string = () => crypto.randomUUID(),
  ) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    const raw = await this.store.get(KEY);
    try {
      const parsed = raw ? JSON.parse(raw) : [];
      this.items = Array.isArray(parsed) ? parsed : [];
    } catch {
      this.items = [];
    }
    this.loaded = true;
  }

  private async save(): Promise<void> {
    await this.store.set(KEY, JSON.stringify(this.items));
  }

  /** Everything for one tournament on one server, oldest first. */
  list(server: string, tournament: number): Queued[] {
    return this.items.filter((q) => q.server === server && q.tournament === tournament);
  }

  count(server: string, tournament?: number): number {
    return this.items.filter((q) => q.server === server && q.state === "waiting" && (tournament === undefined || q.tournament === tournament)).length;
  }

  /**
   * A result for a board. If an earlier result for the same board is still
   * waiting, this one expects THAT result, not the one the server last
   * showed: the two go in order, and the second must not be refused for
   * disagreeing with the first.
   */
  async addResult(
    server: string,
    tournament: number,
    fields: Omit<ResultEntry, "cid" | "kind">,
    label?: string,
  ): Promise<Queued> {
    await this.load();
    const earlier = [...this.items]
      .reverse()
      .find(
        (q) =>
          q.server === server &&
          q.tournament === tournament &&
          q.state === "waiting" &&
          q.entry.kind === "result" &&
          q.entry.pairing === fields.pairing,
      );

    const expected = earlier && earlier.entry.kind === "result" ? earlier.entry.result : fields.expected;
    const queued: Queued = {
      server,
      tournament,
      state: "waiting",
      entry: { ...fields, expected, cid: this.uuid(), kind: "result" },
      ...(label ? { label } : {}),
    };

    this.items.push(queued);
    await this.save();
    return queued;
  }

  async addIncident(
    server: string,
    tournament: number,
    fields: Omit<Extract<Entry, { kind: "incident" }>, "cid" | "kind">,
    label?: string,
  ): Promise<Queued> {
    await this.load();
    const queued: Queued = {
      server,
      tournament,
      state: "waiting",
      entry: { at: new Date().toISOString(), ...fields, cid: this.uuid(), kind: "incident" },
      ...(label ? { label } : {}),
    };
    this.items.push(queued);
    await this.save();
    return queued;
  }

  /** Takes a refusal off the screen once it has been read. */
  async dismiss(cid: string): Promise<void> {
    await this.load();
    this.items = this.items.filter((q) => q.entry.cid !== cid);
    await this.save();
  }

  /** Forgets everything for a server, when it is removed from the app. */
  async forgetServer(server: string): Promise<void> {
    await this.load();
    this.items = this.items.filter((q) => q.server !== server);
    await this.save();
  }

  /**
   * Sends what is waiting for one tournament, oldest first, in batches the
   * server accepts. Saved entries leave the outbox; refused ones stay, with
   * the server's sentence; `retry` ones stay waiting. A network failure
   * stops the flush and keeps everything - the next one sends the same
   * cids again. One flush per tournament at a time.
   */
  flush(server: string, tournament: number, send: (entries: Entry[]) => Promise<EntryAnswer[]>): Promise<FlushOutcome> {
    const key = `${server}#${tournament}`;
    const running = this.flushing.get(key);
    if (running) return running;

    const run = this.doFlush(server, tournament, send).finally(() => this.flushing.delete(key));
    this.flushing.set(key, run);
    return run;
  }

  private async doFlush(
    server: string,
    tournament: number,
    send: (entries: Entry[]) => Promise<EntryAnswer[]>,
  ): Promise<FlushOutcome> {
    await this.load();
    const outcome: FlushOutcome = { saved: 0, refused: 0, waiting: 0, offline: false };

    const waiting = this.list(server, tournament).filter((q) => q.state === "waiting");
    for (const batch of batches(waiting)) {
      let answers: EntryAnswer[];
      try {
        answers = await send(batch.map((q) => q.entry));
      } catch (error) {
        if (error instanceof OfflineError) {
          outcome.offline = true;
          break;
        }
        throw error;
      }

      const byCid = new Map(answers.map((a) => [a.cid, a]));
      let retry = false;
      for (const q of batch) {
        const answer = byCid.get(q.entry.cid);
        if (!answer || answer.status === "retry") {
          retry = true;
        } else if (answer.status === "saved") {
          this.items = this.items.filter((item) => item !== q);
          outcome.saved += 1;
        } else {
          q.state = "refused";
          q.message = answer.message;
          q.reason = answer.reason;
          outcome.refused += 1;
        }
      }
      await this.save();
      // A busy server says so per entry; later batches would only queue
      // behind it. Order matters more than speed.
      if (retry) break;
    }

    outcome.waiting = this.count(server, tournament);
    return outcome;
  }
}

/**
 * What a refused entry says on screen. The server's sentence, with two
 * repairs for servers that predate them: a board it could not name ("Board
 * ?") is named from the entry itself, which always knew; and "Check with the
 * arbiter" is dropped, because whoever holds this app is signed in to an
 * account that IS the arbiter (organiser, editor or arbiter) - sending them
 * off to find one sends them looking for themselves.
 */
export function refusalText(q: Queued): string {
  const where = q.label ?? (q.entry.board ? String(q.entry.board) : null);
  let text = q.message ?? t("queue.not_accepted_default");
  text = text.replace(/^Board \?: ?/, where ? t("queue.board_prefix", { where }) : t("queue.round_prefix", { n: q.entry.round }));
  text = text.replace(/ ?Check with the arbiter\.?$/, " " + t("queue.look_again"));
  return text;
}
