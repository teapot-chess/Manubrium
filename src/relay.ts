// A tournament run from a laptop through the cloud relay (OpenPairings'
// docs/design-cloud-relay.md, contract revision 7). The hosted server holds
// a locked mirror; every write the app makes there is passed to the laptop
// and answered `202 {"command": {..., "state": "pending"}}`. The laptop says
// yes or no later, and the app asks `GET /tournaments/:id/commands/:cid`.
//
// Nothing here pretends the change was made. A command is "sent, waiting for
// the desk" until the laptop has answered; then it is done, or refused with
// the desk's own sentence, or the desk's question (needs_acknowledgement),
// which the arbiter answers and the write goes again under a NEW key.
//
// The key: every write carries an `Idempotency-Key`, a UUID kept with it.
// The same key again is the same command, never a second one, so a resend
// after a lost answer is harmless. `KeyMemory` keeps a write's key while its
// answer is missing, so tapping the same thing again after "no connection"
// reuses it; once anything answers, the key is spent.

import type { KeyValue } from "./queue";
import type { Tournament } from "./api";
import { t } from "./i18n";

export type CommandState = "pending" | "accepted" | "refused";

/** `command-response.schema.json`'s `command`. */
export interface RelayCommand {
  cid: string;
  action: string | null;
  state: CommandState;
  status: number | null;
  error: string | null;
  message: string | null;
  response: Record<string, unknown> | null;
  submitted_at: string | null;
  answered_at: string | null;
}

/** The write as it was sent, so the desk's question can be answered by sending it again. */
export interface WriteRequest {
  method: string;
  path: string;
  body?: unknown;
}

/** The tournament's `relay` block (contract revision 6): null when it is not relayed. */
export interface Relay {
  label: string;
  since: string | null;
  last_seen_at: string | null;
  mirrored_at: string | null;
}

/**
 * A write on a relayed tournament: not done here, sent to the laptop. Thrown
 * by the client in place of the write's usual answer, which the hosted
 * server does not have. `command.state` says where it stands.
 */
export class RelayedWrite extends Error {
  constructor(
    readonly tournament: number,
    readonly command: RelayCommand,
    readonly request: WriteRequest,
  ) {
    super(commandSentence(command));
  }
}

/**
 * A relayed tournament as the screens should treat it. The hosted copy is
 * locked, so the server calls it read-only and blocks pairing as
 * "read_only"; but every write the app makes goes to the laptop, which
 * decides with the desk's own rules. So the buttons stay, and the laptop
 * says yes or no.
 */
export function writableWhenRelayed(tournament: Tournament): Tournament {
  if (!tournament.relay || tournament.archived) return tournament;
  const next = tournament.next_round;
  return {
    ...tournament,
    read_only: false,
    next_round: next && next.blocker === "read_only" ? { ...next, blocker: null } : next,
  };
}

const STATES: CommandState[] = ["pending", "accepted", "refused"];

/** The `command` of a 202 (or of a resend's 200), or null when the body is something else. */
export function relayCommandOf(body: unknown): RelayCommand | null {
  const c = (body as { command?: unknown } | null)?.command as Record<string, unknown> | undefined;
  // A live board's command is `{command: {id, kind, state, ...}}`: no cid.
  if (!c || typeof c !== "object" || typeof c.cid !== "string" || !STATES.includes(c.state as CommandState)) return null;
  return {
    cid: c.cid,
    action: typeof c.action === "string" ? c.action : null,
    state: c.state as CommandState,
    status: typeof c.status === "number" ? c.status : null,
    error: typeof c.error === "string" ? c.error : null,
    message: typeof c.message === "string" ? c.message : null,
    response: c.response && typeof c.response === "object" ? (c.response as Record<string, unknown>) : null,
    submitted_at: typeof c.submitted_at === "string" ? c.submitted_at : null,
    answered_at: typeof c.answered_at === "string" ? c.answered_at : null,
  };
}

/** The desk asked a question: what to send back in `acknowledged`, and what to show. */
export function commandQuestion(c: RelayCommand): { confirm: string[]; summary?: string; warnings: string[] } | null {
  if (c.state !== "refused" || c.error !== "needs_acknowledgement") return null;
  const r = c.response ?? {};
  return {
    confirm: Array.isArray(r.confirm) ? (r.confirm as unknown[]).filter((x): x is string => typeof x === "string") : [],
    summary: typeof r.summary === "string" ? r.summary : undefined,
    warnings: Array.isArray(r.warnings) ? (r.warnings as unknown[]).filter((x): x is string => typeof x === "string") : [],
  };
}

/** The same write again, with the desk's question answered. */
export function acknowledgedRequest(request: WriteRequest, confirm: string[]): WriteRequest {
  const body = request.body && typeof request.body === "object" ? (request.body as Record<string, unknown>) : {};
  const before = Array.isArray(body.acknowledged) ? (body.acknowledged as string[]) : [];
  return { ...request, body: { ...body, acknowledged: [...new Set([...before, ...confirm])] } };
}

/** What a command is, in a few words: by its action's first half. */
export function actionLabel(action: string | null): string {
  const group = (action ?? "").split(".")[0];
  const known = ["tournament", "round_edit", "settings", "incident", "player", "board_link", "live_board", "team", "lineup", "match", "team_event", "hall"];
  if (action === "tournament.pair") return t("relay.action.pair");
  if (action === "tournament.publish") return t("relay.action.publish");
  return known.includes(group) ? t(`relay.action.${group}` as "relay.action.player") : t("relay.action.other");
}

/** The sentence for a command where it stands. */
export function commandSentence(c: RelayCommand): string {
  if (c.state === "pending") return t("relay.sent_waiting");
  if (c.state === "accepted") return t("relay.accepted");
  return c.message || t("relay.refused_default");
}

// ---------------------------------------------------------------------------
// Asking again: soon at first, then less often. The laptop answers within a
// second or two when it is online; when it is not, a phone asking every two
// seconds for an hour helps nobody.

const STEPS = [2, 3, 5, 8, 13, 20, 30];
export const MAX_POLL_SECONDS = 60;

/** Seconds before asking about a command for the `attempt`-th time (0 = the first ask). */
export function pollDelay(attempt: number): number {
  if (attempt < 0) return STEPS[0];
  return attempt < STEPS.length ? STEPS[attempt] : MAX_POLL_SECONDS;
}

// ---------------------------------------------------------------------------
// The commands this phone sent and has not yet seen answered and read, kept
// across restarts like the outbox: an arbiter who put the phone away must
// still learn that the desk said no.

export interface KeptCommand {
  server: string;
  tournament: number;
  command: RelayCommand;
  request: WriteRequest;
  /** How many times it was asked about since the last answer or resume. */
  attempts: number;
  /** When to ask next (ms since the epoch). */
  next_at: number;
}

const KEY = "manubrium.commands.v1";
/** A request body bigger than this (a photo) is not kept: it would never need sending again. */
const KEEP_BODY_MAX = 64_000;

export class CommandBook {
  private items: KeptCommand[] = [];
  private loaded = false;

  constructor(
    private readonly store: KeyValue,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await this.store.get(KEY);
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

  list(server: string, tournament: number): KeptCommand[] {
    return this.items.filter((k) => k.server === server && k.tournament === tournament);
  }

  pendingCount(server: string, tournament?: number): number {
    return this.items.filter((k) => k.server === server && k.command.state === "pending" && (tournament === undefined || k.tournament === tournament)).length;
  }

  /** A write the server passed to the laptop. The same cid again replaces the one kept. */
  async add(server: string, tournament: number, command: RelayCommand, request: WriteRequest): Promise<KeptCommand> {
    await this.load();
    const body = request.body === undefined ? undefined : JSON.stringify(request.body).length <= KEEP_BODY_MAX ? request.body : undefined;
    const kept: KeptCommand = {
      server,
      tournament,
      command,
      request: { method: request.method, path: request.path, ...(body === undefined ? {} : { body }) },
      attempts: 0,
      next_at: this.now() + pollDelay(0) * 1000,
    };
    this.items = [...this.items.filter((k) => !(k.server === server && k.command.cid === command.cid)), kept];
    await this.save();
    return kept;
  }

  /** The pending commands of a tournament that are due to be asked about. */
  due(server: string, tournament: number): KeptCommand[] {
    const now = this.now();
    return this.list(server, tournament).filter((k) => k.command.state === "pending" && k.next_at <= now);
  }

  /** When the next ask is due for this tournament (ms since the epoch), or null with nothing pending. */
  nextDue(server: string, tournament: number): number | null {
    const times = this.list(server, tournament)
      .filter((k) => k.command.state === "pending")
      .map((k) => k.next_at);
    return times.length ? Math.min(...times) : null;
  }

  /** Milliseconds until the next ask is due for this tournament (0: now), or null with nothing pending. */
  nextDelay(server: string, tournament: number): number | null {
    const next = this.nextDue(server, tournament);
    return next === null ? null : Math.max(0, next - this.now());
  }

  /** What the server said about one: still pending (ask later, less often), or answered. */
  async answered(server: string, command: RelayCommand): Promise<void> {
    await this.load();
    const kept = this.items.find((k) => k.server === server && k.command.cid === command.cid);
    if (!kept) return;
    kept.command = command;
    if (command.state === "pending") {
      kept.attempts += 1;
      kept.next_at = this.now() + pollDelay(kept.attempts) * 1000;
    }
    await this.save();
  }

  /** Asking failed (no network): the same pace as a pending answer. */
  async askFailed(server: string, cid: string): Promise<void> {
    await this.load();
    const kept = this.items.find((k) => k.server === server && k.command.cid === cid);
    if (!kept) return;
    kept.attempts += 1;
    kept.next_at = this.now() + pollDelay(kept.attempts) * 1000;
    await this.save();
  }

  /** Back in the app, or back online: ask about everything at once, and start the pace again. */
  async wake(server: string, tournament: number): Promise<void> {
    await this.load();
    const now = this.now();
    for (const k of this.list(server, tournament)) {
      if (k.command.state !== "pending") continue;
      k.attempts = 0;
      k.next_at = now;
    }
    await this.save();
  }

  /** Read and done with: off the screen. */
  async dismiss(server: string, cid: string): Promise<void> {
    await this.load();
    this.items = this.items.filter((k) => !(k.server === server && k.command.cid === cid));
    await this.save();
  }

  async forgetServer(server: string): Promise<void> {
    await this.load();
    this.items = this.items.filter((k) => k.server !== server);
    await this.save();
  }
}

// ---------------------------------------------------------------------------

/**
 * The Idempotency-Key of a write whose answer never came. Tapping the same
 * write again (same server, method, path and body) within `ttl` reuses it,
 * so a write that did reach the server is not made twice; any answer at all
 * spends it.
 */
export class KeyMemory {
  private keys = new Map<string, { key: string; at: number }>();

  constructor(
    private readonly uuid: () => string = () => crypto.randomUUID(),
    private readonly now: () => number = () => Date.now(),
    private readonly ttl = 10 * 60_000,
  ) {}

  private static id(base: string, request: WriteRequest): string {
    return `${base} ${request.method} ${request.path} ${request.body === undefined ? "" : JSON.stringify(request.body)}`;
  }

  /** The key to send: the lost one again, or a new one. */
  keyFor(base: string, request: WriteRequest): string {
    const id = KeyMemory.id(base, request);
    const kept = this.keys.get(id);
    if (kept && this.now() - kept.at < this.ttl) return kept.key;
    const key = this.uuid();
    this.keys.set(id, { key, at: this.now() });
    return key;
  }

  /** The server answered (anything): the key is spent. */
  answered(base: string, request: WriteRequest): void {
    this.keys.delete(KeyMemory.id(base, request));
  }
}
