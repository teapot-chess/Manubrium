// The OpenPairings Manubrium API, v1 (`/api/manubrium/v1`, documented in
// OpenPairings' docs/manubrium.md, "Full app"). Plain fetch: on a phone,
// Capacitor routes it through the native HTTP stack (CapacitorHttp in
// capacitor.config.ts); in a browser it is the browser's, which is how the
// bundle is developed against a local server.

import { normaliseServer } from "./link";

export type Role = "owner" | "editor" | "arbiter";
export type Capability = "results" | "incidents" | "pair" | "publish" | "players" | "standings" | "settings";

export interface ServerInfo { name: string; version: string; api: number; desktop: boolean }
export interface Device { id: number; name: string; platform: string }
export interface UserInfo { email: string; name: string | null }

export interface TournamentLine {
  id: number;
  name: string;
  role: Role;
  status: string;
  start_date: string | null;
  end_date: string | null;
  city: string | null;
  rounds_count: number | null;
  paired_rounds: number;
}

export interface Warning { id: string; confirm: boolean; message: string }

export interface Tournament extends TournamentLine {
  can: Capability[];
  read_only: boolean;
  archived: boolean;
  handed_off: boolean;
  pairing_system: string;
  team: boolean;
  rounds: { number: number; publish_level: number; missing_results: number }[];
  next_round: { number: number; blocker: string | null; warnings: Warning[] } | null;
  settings: Record<string, unknown>;
}

export interface BoardPlayer { id: number; name: string; title: string | null; rating: number | null; score: number }

export interface Board {
  id: number;
  board: number;
  label: string;
  white: BoardPlayer | null;
  black: BoardPlayer | null;
  bye: boolean;
  /** One seat empty and no bye: the board waits for a player or a bye. */
  vacant?: boolean;
  /** Both seats empty: only a last board left so can be removed. */
  empty?: boolean;
  result: string;
  clearable: boolean;
  /** Entered on a Manubrium Lite phone (`/m`): waiting for the arbiter's word, or confirmed. */
  phone?: { by: string; state: "unconfirmed" | "confirmed"; at: string } | null;
}

export interface PoolEntry { player: BoardPlayer; type: string | null; absent: boolean }

export interface Round {
  number: number;
  latest: boolean;
  publish_level: number;
  boards: Board[];
  byes: { player: BoardPlayer; type: string }[];
  /** Everyone not on a board, and why: what a seat is filled from. */
  pool?: PoolEntry[];
  /** Whether hand edits are open on this round, and the MPA PIBE recorded for it. */
  hand_edits?: { open: boolean; pibe: string | null };
  results: string[];
}

/** One hand edit, as `POST /rounds/:n/edits` takes it. */
export type HandEdit =
  | { kind: "swap"; a: number; b: number }
  | { kind: "vacate"; player: number; bye_type?: string }
  | { kind: "bye"; pairing: number }
  | { kind: "fill"; pairing: number; player: number }
  | { kind: "pool_pair"; a: number; b: number; board?: number }
  | { kind: "pool_bye"; player: number }
  | { kind: "delete"; pairing: number };

/** The settings a phone may change (`PATCH /settings`), by field. */
export type SettingsChange = Partial<{
  rounds_count: number;
  tiebreaks: string[];
  time_control: string;
  chief_arbiter: string;
  deputy_arbiter: string;
  venue: string;
  city: string;
  bye_value: number;
  ask_bye_type: boolean;
  shared_places: boolean;
}>;

export interface StandingRow {
  rank: string | number | null;
  player: { id: number; name: string; title: string | null; rating: number | null } | null;
  points: number;
  tiebreaks: Record<string, number>;
}

export interface Standings { tiebreaks: { code: string; name: string }[]; rows: StandingRow[] }

export interface Player {
  id: number;
  name: string;
  title: string | null;
  sex: string | null;
  federation: string | null;
  club: string | null;
  birth_year: number | null;
  fide_id: number | null;
  fide_rating: number | null;
  national_rating: number | null;
  rating: number | null;
  pairing_number: number | null;
  start_round: number | null;
  status: "active" | "withdrawn" | "expelled";
  absent: boolean;
  absent_rounds: number[];
}

export interface Incident {
  id: number;
  round: number;
  board: number | null;
  kind: string;
  note: string;
  white: string | null;
  black: string | null;
  occurred_at: string;
  by: string | null;
  has_photo: boolean;
}

export interface ResultEntry {
  cid: string;
  kind: "result";
  round: number;
  pairing: number;
  board: number;
  white: number | null;
  black: number | null;
  result: string;
  expected: string;
}

export interface IncidentEntry {
  cid: string;
  kind: "incident";
  round: number;
  pairing?: number;
  board?: number;
  type: string;
  note: string;
  at?: string;
  /** A JPEG, base64, without the `data:` prefix. */
  photo?: string;
}

export type Entry = ResultEntry | IncidentEntry;

export interface EntryAnswer { cid: string; status: "saved" | "refused" | "retry"; reason: string | null; message: string }

export interface Connected { token: string; device: Device; user: UserInfo; server: ServerInfo }

/** The server said no, with a code and a sentence for the person holding the phone. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** The request never got an answer: no network, or the server is not there. */
export class OfflineError extends Error {
  constructor(message = "No connection to the server.") {
    super(message);
  }
}

/**
 * The server wants a question answered first (`409 needs_acknowledgement`):
 * the ids to send back in `acknowledged`, and what the desk's dialog would
 * show. Null for any other error.
 */
export function needsAcknowledgement(error: unknown): {
  confirm: string[];
  summary?: string;
  warnings: string[];
  checker?: { checked: boolean; line: string; missing: string[]; added: string[]; warnings: string[] };
} | null {
  if (!(error instanceof ApiError) || error.code !== "needs_acknowledgement") return null;
  const b = error.body;
  return {
    confirm: Array.isArray(b.confirm) ? (b.confirm as string[]) : [],
    summary: typeof b.summary === "string" ? b.summary : undefined,
    warnings: Array.isArray(b.warnings) ? (b.warnings as string[]) : [],
    checker: (b.checker as never) ?? undefined,
  };
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const PREFIX = "/api/manubrium/v1";

async function call<T>(
  fetchImpl: FetchLike,
  base: string,
  token: string | null,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";

  let response: Response;
  try {
    response = await fetchImpl(base + PREFIX + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new OfflineError(error instanceof Error && error.message ? `No connection to the server (${error.message}).` : undefined);
  }

  if (response.status === 204) return undefined as T;

  let data: Record<string, unknown> = {};
  const text = await response.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // A proxy's HTML error page, a captive portal: not the API answering.
      if (!response.ok) throw new ApiError(response.status, "not_api", `The server answered ${response.status}, and not as OpenPairings would.`);
      throw new ApiError(response.status, "not_api", "The server's answer was not JSON. Is this an OpenPairings server?");
    }
  }

  if (!response.ok) {
    const code = typeof data.error === "string" ? data.error : `http_${response.status}`;
    const message = typeof data.message === "string" ? data.message : `The server answered ${response.status}.`;
    throw new ApiError(response.status, code, message, data);
  }

  return data as T;
}

/** Trades a connect code for this phone's token. */
export function connect(
  server: string,
  secret: string,
  device: { name: string; platform: string },
  fetchImpl: FetchLike = fetch,
): Promise<Connected> {
  const base = normaliseServer(server);
  return call<Connected>(fetchImpl, base, null, "POST", "/connect", { secret, ...device });
}

export interface Client {
  me(): Promise<{ device: Device; user: UserInfo; server: ServerInfo }>;
  signOut(): Promise<void>;
  tournaments(): Promise<TournamentLine[]>;
  tournament(id: number): Promise<Tournament>;
  round(id: number, n: number): Promise<Round>;
  sync(id: number, entries: Entry[]): Promise<EntryAnswer[]>;
  clear(id: number, n: number, pairing: number, expected: string): Promise<void>;
  pair(id: number, acknowledged?: string[]): Promise<Round>;
  unpair(id: number, n: number): Promise<void>;
  publish(id: number, n: number, level: 0 | 1 | 2 | 3): Promise<number>;
  standings(id: number): Promise<Standings>;
  incidents(id: number, round?: number): Promise<Incident[]>;
  players(id: number): Promise<Player[]>;
  createPlayer(id: number, player: Partial<Player> & { name: string }): Promise<Player>;
  updatePlayer(id: number, playerId: number, changes: Record<string, unknown>, acknowledged?: string[]): Promise<Player>;
  edit(id: number, n: number, edit: HandEdit, acknowledged?: string[]): Promise<Round>;
  finishEdits(id: number, n: number, acknowledged?: string[]): Promise<{ pibe: string | null; round: Round }>;
  confirmResult(id: number, n: number, pairing: number, expected: string): Promise<void>;
  rejectResult(id: number, n: number, pairing: number, expected: string): Promise<void>;
  updateSettings(id: number, settings: SettingsChange): Promise<Record<string, unknown>>;
  attachPhoto(id: number, incident: number, jpegBase64: string): Promise<Incident>;
  photo(id: number, incident: number): Promise<Blob>;
}

export function client(base: string, token: string, fetchImpl: FetchLike = fetch): Client {
  const req = <T>(method: string, path: string, body?: unknown) => call<T>(fetchImpl, base, token, method, path, body);
  const t = (id: number) => `/tournaments/${id}`;

  return {
    me: () => req("GET", "/me"),
    signOut: () => req("DELETE", "/me"),
    tournaments: async () => (await req<{ tournaments: TournamentLine[] }>("GET", "/tournaments")).tournaments,
    tournament: async (id) => (await req<{ tournament: Tournament }>("GET", t(id))).tournament,
    round: async (id, n) => (await req<{ round: Round }>("GET", `${t(id)}/rounds/${n}`)).round,
    sync: async (id, entries) => (await req<{ results: EntryAnswer[] }>("POST", `${t(id)}/sync`, { entries })).results,
    clear: async (id, n, pairing, expected) => {
      await req("POST", `${t(id)}/rounds/${n}/boards/${pairing}/clear`, { expected });
    },
    pair: async (id, acknowledged = []) => (await req<{ round: Round }>("POST", `${t(id)}/rounds`, { acknowledged })).round,
    unpair: (id, n) => req("DELETE", `${t(id)}/rounds/${n}`),
    publish: async (id, n, level) =>
      (await req<{ publish_level: number }>("PUT", `${t(id)}/rounds/${n}/publish`, { level })).publish_level,
    standings: async (id) => (await req<{ standings: Standings }>("GET", `${t(id)}/standings`)).standings,
    incidents: async (id, round) =>
      (await req<{ incidents: Incident[] }>("GET", `${t(id)}/incidents${round ? `?round=${round}` : ""}`)).incidents,
    players: async (id) => (await req<{ players: Player[] }>("GET", `${t(id)}/players`)).players,
    createPlayer: async (id, player) => (await req<{ player: Player }>("POST", `${t(id)}/players`, { player })).player,
    updatePlayer: async (id, playerId, changes, acknowledged = []) =>
      (await req<{ player: Player }>("PATCH", `${t(id)}/players/${playerId}`, { player: changes, acknowledged })).player,
    edit: async (id, n, edit, acknowledged = []) =>
      (await req<{ round: Round }>("POST", `${t(id)}/rounds/${n}/edits`, { edit, acknowledged })).round,
    finishEdits: (id, n, acknowledged = []) => req("POST", `${t(id)}/rounds/${n}/edits/finish`, { acknowledged }),
    confirmResult: async (id, n, pairing, expected) => {
      await req("POST", `${t(id)}/rounds/${n}/boards/${pairing}/confirm`, { expected });
    },
    rejectResult: async (id, n, pairing, expected) => {
      await req("POST", `${t(id)}/rounds/${n}/boards/${pairing}/reject`, { expected });
    },
    updateSettings: async (id, settings) =>
      (await req<{ settings: Record<string, unknown> }>("PATCH", `${t(id)}/settings`, { settings })).settings,
    attachPhoto: async (id, incident, jpegBase64) =>
      (await req<{ incident: Incident }>("POST", `${t(id)}/incidents/${incident}/photo`, { photo: jpegBase64 })).incident,
    photo: async (id, incident) => {
      // Not JSON: the JPEG itself, so not through `call`.
      let response: Response;
      try {
        response = await fetchImpl(`${base}${PREFIX}${t(id)}/incidents/${incident}/photo`, {
          method: "GET",
          headers: { authorization: `Bearer ${token}`, accept: "image/jpeg" },
        });
      } catch {
        throw new OfflineError();
      }
      if (!response.ok) throw new ApiError(response.status, response.status === 404 ? "not_found" : `http_${response.status}`, "No photo to show.");
      return response.blob();
    },
  };
}
