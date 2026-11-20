// The hall path of a relayed tournament (OpenPairings' docs/design-cloud-relay.md,
// step 5; contract revision 8). On the hall's network the phone can reach
// the laptop that runs the tournament directly, and the cloud is the way
// round when it cannot. The laptop is still the only judge: this is a
// shorter road to the same desk, not a second desk.
//
// Where the laptop answers comes with the tournament (`relay.hall`: its
// addresses, its own id for the tournament, and a pass the cloud signed for
// this phone). The pass is not the device token, lives twelve hours and is
// replaced by every read of the tournament.
//
// What makes trying both paths safe: every write carries the same
// Idempotency-Key (a sync entry its cid) on either path, and the laptop
// answers a key it has seen with the answer it gave, never a second run.
// What makes the same request work on both: rows are named by uid, which
// both copies share, where their ids do not. A request that still names a
// row by a plain id (an old outbox entry, a board code) goes to the cloud,
// which knows what its own ids mean.

import { isLocalHost, isSharedAddress } from "./link";

/** `relay.hall` (contract revision 8). */
export interface RelayHall {
  urls: string[];
  tournament_id: number;
  seen_at: string | null;
  token: string;
  expires_at: string;
}

/** Which way the tournament's last request went. */
export type HallPathName = "hall" | "cloud";

/** How long the laptop gets to answer before the cloud is asked: it is the same room. */
export const HALL_TIMEOUT_MS = 2500;
/** After the laptop did not answer, reads go to the cloud first for this long. */
export const HALL_QUIET_MS = 30_000;
/** A pass this close to its end is not used: the cloud hands out a new one. */
const EXPIRY_MARGIN_MS = 60_000;

/** A laptop address the phone may send its pass to: plain http on a private address, or https. */
export function usableHallUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  if (url.protocol === "http:" && (!isLocalHost(url.hostname) || isSharedAddress(url.hostname))) return null;
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.origin;
}

/** The `relay.hall` of a tournament answer, checked; null when there is none or it is unusable. */
export function readHall(raw: unknown): RelayHall | null {
  const h = raw as Partial<RelayHall> | null | undefined;
  if (!h || typeof h !== "object") return null;
  if (typeof h.token !== "string" || !h.token || typeof h.tournament_id !== "number" || typeof h.expires_at !== "string") return null;
  const urls = (Array.isArray(h.urls) ? h.urls : []).map(usableHallUrl).filter((u): u is string => u !== null);
  if (!urls.length) return null;
  return { urls, tournament_id: h.tournament_id, seen_at: typeof h.seen_at === "string" ? h.seen_at : null, token: h.token, expires_at: h.expires_at };
}

// ---------------------------------------------------------------------------
// Which requests may take the hall path at all.

/** A tournament route the laptop refuses `409 cloud_only`: between phones, not the tournament's. */
const CLOUD_ONLY = /^\/tournaments\/\d+\/(team|notes|live-activity)(?:[/?]|$)/;

// Path segments that name a row, and must therefore name it by uid. Rounds
// are named by number on both copies; a live board game by its own name.
const ROW_SEGMENT = /\/(boards|players|teams|matches|incidents|history|board-links|commands)\/([^/?]+)/g;

// The reads that take the hall path: the round (what the arbiter looks at
// after every write, and what the laptop has before the cloud's copy does),
// and what is read beside it. Their rows are all named by uid in what the
// app sends next, so it does not matter which copy they came from. Every
// other read stays with the cloud, whose ids the app then uses.
const HALL_READS = /^\/tournaments\/\d+\/(rounds\/\d+(\/[^?]*)?|arrivals|incidents|players|players\/[^/?]+\/card|commands\/[^/?]+)(\?.*)?$/;

const plainId = (v: unknown) => typeof v === "number" || (typeof v === "string" && /^\d+$/.test(v));

/** Does this body still name a row by a plain id, which means something else on the laptop? */
function bodyNamesIds(path: string, body: unknown): boolean {
  const b = (body ?? {}) as Record<string, unknown>;
  if (/\/edits$/.test(path)) {
    const e = (b.edit ?? {}) as Record<string, unknown>;
    return ["a", "b", "player", "pairing"].some((k) => plainId(e[k]));
  }
  if (/\/lineups(?:\/check)?$/.test(path)) {
    const seats = [b.a, b.b, (b.out as Record<string, unknown> | undefined)?.a, (b.out as Record<string, unknown> | undefined)?.b];
    return seats.some((s) => Array.isArray(s) && s.some(plainId));
  }
  if (/\/sync$/.test(path)) {
    const entries = Array.isArray(b.entries) ? (b.entries as Record<string, unknown>[]) : [];
    return entries.some((e) => plainId(e.pairing) || plainId(e.white) || plainId(e.black));
  }
  if (/\/live-boards\/commands$/.test(path)) return true; // box and link ids are the laptop's own; the cloud passes them on as it always did
  return false;
}

/**
 * Whether a request may go to the laptop: a write to a tournament (not the
 * cloud's own routes), or one of the reads above, naming its rows by uid.
 * The tournament itself is always read from the cloud: that is where the
 * pass comes from.
 */
export function hallCapable(method: string, path: string, body?: unknown): boolean {
  if (!/^\/tournaments\/\d+\/./.test(path)) return false;
  if (CLOUD_ONLY.test(path)) return false;
  if ((method === "GET" || method === "HEAD") && !HALL_READS.test(path)) return false;
  for (const m of path.matchAll(ROW_SEGMENT)) {
    // A command is named by its cid, which is no id; everything else must be a uid.
    if (m[1] === "commands") continue;
    if (/^\d+$/.test(decodeURIComponent(m[2]))) return false;
  }
  if (/\/board-links(?:\/|$)/.test(path)) return false;
  if (method !== "GET" && method !== "HEAD" && bodyNamesIds(path, body)) return false;
  return true;
}

/** The same path on the laptop: its own id for the tournament. */
export function hallPath(path: string, hall: RelayHall): string {
  return path.replace(/^\/tournaments\/\d+/, `/tournaments/${hall.tournament_id}`);
}

// ---------------------------------------------------------------------------

interface Route {
  hall: RelayHall;
  /** The address that answered last: tried first next time. */
  preferred: number;
}

/**
 * The hall paths this phone knows, by cloud server and the cloud's id for
 * the tournament, and which way each tournament's last request went (for
 * the banner). Kept in memory: the pass is a credential, and the next read
 * of the tournament brings a fresh one anyway.
 */
export class HallRoutes {
  private routes = new Map<string, Route>();
  private used = new Map<string, HallPathName>();
  private quietUntil = new Map<string, number>();
  private refreshedAt = new Map<string, number>();
  private listeners = new Set<() => void>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  private static key(base: string, tournament: number): string {
    return `${base} ${tournament}`;
  }

  /** What the cloud said in `GET /tournaments/:id`: a path, or none (the laptop is not listening). */
  set(base: string, tournament: number, hall: RelayHall | null): void {
    const key = HallRoutes.key(base, tournament);
    if (!hall) {
      const had = this.routes.delete(key) || this.used.has(key);
      this.used.delete(key);
      if (had) this.notify();
      return;
    }
    const before = this.routes.get(key);
    const preferred = before ? hall.urls.indexOf(before.hall.urls[before.preferred]) : -1;
    this.routes.set(key, { hall, preferred: preferred >= 0 ? preferred : 0 });
    this.refreshedAt.delete(key);
  }

  /** The path to try, while its pass is good; null otherwise. */
  get(base: string, tournament: number): RelayHall | null {
    const route = this.routes.get(HallRoutes.key(base, tournament));
    if (!route) return null;
    const ends = Date.parse(route.hall.expires_at);
    if (Number.isFinite(ends) && ends - EXPIRY_MARGIN_MS <= this.now()) return null;
    return route.hall;
  }

  /** Whether there is a path at all, good pass or not (a stale pass wants a fresh read). */
  known(base: string, tournament: number): boolean {
    return this.routes.has(HallRoutes.key(base, tournament));
  }

  /** The laptop's addresses, the one that answered last first. */
  urls(base: string, tournament: number): string[] {
    const route = this.routes.get(HallRoutes.key(base, tournament));
    if (!route) return [];
    const urls = route.hall.urls;
    return [urls[route.preferred], ...urls.filter((_, i) => i !== route.preferred)];
  }

  /** The laptop answered at `url`. */
  reached(base: string, tournament: number, url: string): void {
    const key = HallRoutes.key(base, tournament);
    const route = this.routes.get(key);
    if (route) {
      const i = route.hall.urls.indexOf(url);
      if (i >= 0) route.preferred = i;
    }
    this.quietUntil.delete(key);
    this.mark(key, "hall");
  }

  /** The laptop did not answer (or not usefully): the cloud carries this one. */
  missed(base: string, tournament: number): void {
    this.quietUntil.set(HallRoutes.key(base, tournament), this.now() + HALL_QUIET_MS);
  }

  /** The laptop refused the pass: forget it until the cloud hands out a new one. */
  refused(base: string, tournament: number): void {
    const key = HallRoutes.key(base, tournament);
    const route = this.routes.get(key);
    if (route) this.routes.set(key, { ...route, hall: { ...route.hall, expires_at: new Date(0).toISOString() } });
    this.missed(base, tournament);
  }

  /** The laptop did not answer a moment ago: reads ask the cloud first for now. */
  quiet(base: string, tournament: number): boolean {
    return (this.quietUntil.get(HallRoutes.key(base, tournament)) ?? 0) > this.now();
  }

  /** The cloud answered a request for this tournament. */
  cloud(base: string, tournament: number): void {
    if (this.known(base, tournament)) this.mark(HallRoutes.key(base, tournament), "cloud");
  }

  /** Which way the last request went, or null before any (or with no path known). */
  pathOf(base: string, tournament: number): HallPathName | null {
    const key = HallRoutes.key(base, tournament);
    return this.routes.has(key) ? (this.used.get(key) ?? null) : null;
  }

  /** A pass that is gone or nearly so: ask the cloud for a new one, at most once a minute. */
  wantsRefresh(base: string, tournament: number): boolean {
    const key = HallRoutes.key(base, tournament);
    if (!this.routes.has(key) || this.get(base, tournament)) return false;
    const last = this.refreshedAt.get(key) ?? -Infinity;
    if (this.now() - last < 60_000) return false;
    this.refreshedAt.set(key, this.now());
    return true;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  forgetServer(base: string): void {
    for (const key of [...this.routes.keys()]) if (key.startsWith(`${base} `)) this.routes.delete(key);
    for (const key of [...this.used.keys()]) if (key.startsWith(`${base} `)) this.used.delete(key);
    this.notify();
  }

  private mark(key: string, path: HallPathName): void {
    if (this.used.get(key) === path) return;
    this.used.set(key, path);
    this.notify();
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }
}

/** One for the whole app, like the key memory: every screen's requests share what is known. */
export const hallRoutes = new HallRoutes();
