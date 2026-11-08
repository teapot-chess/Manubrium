// The app against OpenPairings' published contract for this API (vendored
// in contracts/vendor/openpairings/manubrium-v1; README, "Contracts").
// Offline: the contract is read from disk, the server is a fake fetch that
// answers with the contract's own examples.
//
// Three questions. Does every answer the server documents go through the
// app's real client and the code that reads it, meaning what the app thinks
// it means? Does every request the app builds pass the server's request
// schema? And does every route the app calls exist in the contract at all?

import { describe, expect, it } from "vitest";
import {
  ApiError,
  client,
  connect,
  needsAcknowledgement,
  type BoardLink,
  type BoardCommand,
  type BoardCommandRequest,
  type LiveBoards,
  type LiveBox,
  type LiveGame,
  type LivePairing,
  type LiveTable,
  type BoardPlayer,
  type BoardReport,
  type BoardStatus,
  type Board,
  type Bye,
  type Capability,
  type Client,
  type Device,
  type EntryAnswer,
  type FetchLike,
  type HandEdit,
  type Incident,
  type Player,
  type PushEvent,
  type PushStatus,
  PUSH_EVENTS,
  type Role,
  type Round,
  type SearchHit,
  type ServerInfo,
  type StandingRow,
  type Standings,
  type Tournament,
  type TournamentLine,
  type TournamentOptions,
  type TournamentStatus,
  type UserInfo,
  type Warning,
} from "./api";
import { boardReportLabel } from "./alnasl";
import { byeRows, byesToSend } from "./byes";
import { Outbox, type KeyValue } from "./queue";
import { hitDetails, sourceOf } from "./search";
import { pairingsText, standingsText } from "./share";
import { definition, enumOf, examples, files, index, problems, prose, schemaFor, schemas, shape, shapeMismatches } from "./contract.testkit";
import { completeFen } from "./fen";
import { alarmLabel, boxErrorText, liveErrorText, stateLabel } from "./liveBoards";
import { startForm, toFields } from "./ui/NewTournament";
import { incidentKinds } from "./ui/RoundScreen";
import { changes, initial } from "./ui/SettingsEditor";

const BASE = "https://pairings.example";
const PREFIX = "/api/manubrium/v1";

// ---------------------------------------------------------------------------
// The routes the app calls. `contract` is how the contract's own prose names
// the route; `request`/`response` the schema files for its bodies.

interface Route {
  method: string;
  path: RegExp;
  contract: string;
  request?: string;
  response?: string;
}

const ROUTES: Route[] = [
  { method: "POST", path: /^\/connect$/, contract: "POST /connect", request: "connect-request", response: "connect-response" },
  { method: "GET", path: /^\/me$/, contract: "GET /me", response: "me-response" },
  { method: "DELETE", path: /^\/me$/, contract: "DELETE /me", response: "sign-out-response" },
  { method: "GET", path: /^\/tournament-options$/, contract: "GET /tournament-options", response: "tournament-options-response" },
  { method: "GET", path: /^\/tournaments$/, contract: "GET /tournaments", response: "tournaments-response" },
  { method: "POST", path: /^\/tournaments$/, contract: "POST /tournaments", request: "tournament-create-request", response: "tournament-create-response" },
  { method: "GET", path: /^\/tournaments\/\d+$/, contract: "GET /tournaments/:id", response: "tournament-response" },
  { method: "GET", path: /^\/tournaments\/\d+\/standings$/, contract: "GET /tournaments/:id/standings", response: "standings-response" },
  { method: "GET", path: /^\/tournaments\/\d+\/incidents$/, contract: "GET /tournaments/:id/incidents", response: "incidents-response" },
  { method: "POST", path: /^\/tournaments\/\d+\/sync$/, contract: "POST /tournaments/:id/sync", request: "sync-request", response: "sync-response" },
  { method: "POST", path: /^\/tournaments\/\d+\/rounds$/, contract: "POST /tournaments/:id/rounds", request: "pair-request", response: "round-response" },
  { method: "GET", path: /^\/tournaments\/\d+\/rounds\/\d+$/, contract: "GET /tournaments/:id/rounds/:n", response: "round-response" },
  { method: "DELETE", path: /^\/tournaments\/\d+\/rounds\/\d+$/, contract: "DELETE /tournaments/:id/rounds/:n", response: "unpair-response" },
  { method: "PUT", path: /^\/tournaments\/\d+\/rounds\/\d+\/publish$/, contract: "PUT /rounds/:n/publish", request: "publish-request", response: "publish-response" },
  { method: "POST", path: /^\/tournaments\/\d+\/rounds\/\d+\/boards\/\d+\/clear$/, contract: "POST /rounds/:n/boards/:pairing/clear", request: "expected-request", response: "board-verdict-response" },
  { method: "POST", path: /^\/tournaments\/\d+\/rounds\/\d+\/boards\/\d+\/confirm$/, contract: "/confirm", request: "expected-request", response: "board-verdict-response" },
  { method: "POST", path: /^\/tournaments\/\d+\/rounds\/\d+\/boards\/\d+\/reject$/, contract: "/reject", request: "expected-request", response: "board-verdict-response" },
  { method: "POST", path: /^\/tournaments\/\d+\/rounds\/\d+\/edits$/, contract: "POST /rounds/:n/edits", request: "edit-request", response: "round-response" },
  { method: "POST", path: /^\/tournaments\/\d+\/rounds\/\d+\/edits\/finish$/, contract: "POST /rounds/:n/edits/finish", request: "finish-edits-request", response: "finish-edits-response" },
  { method: "POST", path: /^\/tournaments\/\d+\/rounds\/\d+\/edits\/discard$/, contract: "POST /rounds/:n/edits/discard", request: "discard-edits-request", response: "round-response" },
  { method: "PATCH", path: /^\/tournaments\/\d+\/settings$/, contract: "PATCH /tournaments/:id/settings", request: "settings-request", response: "settings-response" },
  { method: "POST", path: /^\/tournaments\/\d+\/incidents\/\d+\/photo$/, contract: "POST /incidents/:iid/photo", request: "photo-request", response: "incident-response" },
  { method: "PATCH", path: /^\/tournaments\/\d+\/incidents\/\d+$/, contract: "PATCH /tournaments/:id/incidents/:iid", request: "incident-update-request", response: "incident-response" },
  { method: "DELETE", path: /^\/tournaments\/\d+\/incidents\/\d+$/, contract: "DELETE /tournaments/:id/incidents/:iid", response: "incident-delete-response" },
  // The JPEG itself: named in the contract, deliberately outside its schemas.
  { method: "GET", path: /^\/tournaments\/\d+\/incidents\/\d+\/photo$/, contract: "GET /tournaments/:id/incidents/:iid/photo" },
  { method: "GET", path: /^\/tournaments\/\d+\/players$/, contract: "GET /tournaments/:id/players", response: "players-response" },
  { method: "GET", path: /^\/tournaments\/\d+\/players\/\d+\/card$/, contract: "GET /tournaments/:id/players/:pid/card", response: "player-card-response" },
  { method: "GET", path: /^\/tournaments\/\d+\/arrivals$/, contract: "GET /tournaments/:id/arrivals", response: "arrivals-response" },
  { method: "GET", path: /^\/tournaments\/\d+\/prizes$/, contract: "GET /tournaments/:id/prizes", response: "prizes-response" },
  { method: "GET", path: /^\/tournaments\/\d+\/player-search$/, contract: "GET /tournaments/:id/player-search", response: "player-search-response" },
  { method: "POST", path: /^\/tournaments\/\d+\/players$/, contract: "POST /tournaments/:id/players", request: "player-create-request", response: "player-response" },
  { method: "PATCH", path: /^\/tournaments\/\d+\/players\/\d+$/, contract: "PATCH /tournaments/:id/players/:pid", request: "player-update-request", response: "player-response" },
  { method: "PUT", path: /^\/tournaments\/\d+\/players\/\d+\/byes$/, contract: "PUT /tournaments/:id/players/:pid/byes", request: "byes-request", response: "player-response" },
  { method: "GET", path: /^\/tournaments\/\d+\/board-links$/, contract: "GET /tournaments/:id/board-links", response: "board-links-response" },
  { method: "POST", path: /^\/tournaments\/\d+\/board-links$/, contract: "POST /tournaments/:id/board-links", request: "board-link-create-request", response: "board-link-create-response" },
  { method: "DELETE", path: /^\/tournaments\/\d+\/board-links\/\d+$/, contract: "DELETE /tournaments/:id/board-links/:lid", response: "board-link-revoke-response" },
  { method: "GET", path: /^\/tournaments\/\d+\/hall$/, contract: "GET /tournaments/:id/hall", response: "hall-response" },
  { method: "POST", path: /^\/tournaments\/\d+\/hall\/print$/, contract: "POST /tournaments/:id/hall/print", request: "hall-reprint-request", response: "hall-command-response" },
  { method: "POST", path: /^\/tournaments\/\d+\/hall\/countdown$/, contract: "POST /tournaments/:id/hall/countdown", request: "hall-countdown-request", response: "hall-command-response" },
  { method: "POST", path: /^\/tournaments\/\d+\/hall\/announce$/, contract: "POST /tournaments/:id/hall/announce", request: "hall-announce-request", response: "hall-command-response" },
  { method: "GET", path: /^\/push$/, contract: "GET /push", response: "push-response" },
  { method: "PUT", path: /^\/push$/, contract: "PUT /push", request: "push-register-request", response: "push-response" },
  { method: "DELETE", path: /^\/push$/, contract: "DELETE /push", response: "push-unregister-response" },
  { method: "PUT", path: /^\/tournaments\/\d+\/live-activity$/, contract: "PUT /tournaments/:id/live-activity", request: "live-activity-request", response: "live-activity-response" },
  { method: "DELETE", path: /^\/tournaments\/\d+\/live-activity$/, contract: "DELETE /tournaments/:id/live-activity", response: "live-activity-response" },
  { method: "PUT", path: /^\/tournaments\/\d+\/default-time$/, contract: "PUT /tournaments/:id/default-time", request: "default-time-request", response: "default-time-response" },
  { method: "DELETE", path: /^\/tournaments\/\d+\/default-time$/, contract: "DELETE /tournaments/:id/default-time", response: "default-time-response" },
  // Live board control (contract revision 2).
  { method: "GET", path: /^\/tournaments\/\d+\/live-boards$/, contract: "GET /tournaments/:id/live-boards", response: "live-boards-response" },
  { method: "GET", path: /^\/tournaments\/\d+\/live-boards\/games\/[^/]+$/, contract: "GET /tournaments/:id/live-boards/games/:game", response: "live-board-game-response" },
  { method: "POST", path: /^\/tournaments\/\d+\/live-boards\/commands$/, contract: "POST /tournaments/:id/live-boards/commands", request: "live-board-command-request", response: "live-board-command-response" },
  { method: "GET", path: /^\/tournaments\/\d+\/live-boards\/commands\/\d+$/, contract: "GET /tournaments/:id/live-boards/commands/:command_id", response: "live-board-command-response" },
];

// Routes the server has and the app uses, that the contract does not (yet)
// describe. Empty, and the test below keeps it honest both ways.
const NOT_IN_CONTRACT: string[] = [];

// Schemas the app has no route for, and why. Anything else new in the
// contract fails the test until it is mapped here or above.
const UNUSED_SCHEMAS: Record<string, string> = {
  "common.schema.json": "shared definitions, not a message",
  "error.schema.json": "every refusal; checked through ApiError below",
};

function routeFor(method: string, url: string): Route {
  const path = url.slice(BASE.length + PREFIX.length).split("?")[0];
  const found = ROUTES.filter((r) => r.method === method && r.path.test(path));
  if (found.length !== 1) throw new Error(`the app calls ${method} ${path}, which ${found.length ? "matches several routes" : "no route here knows"}`);
  return found[0];
}

const ex = <T = Record<string, unknown>>(name: string): T => {
  const e = examples[name];
  if (e === undefined) throw new Error(`no example ${name}`);
  return structuredClone(e) as T;
};

// ---------------------------------------------------------------------------
// A fetch that writes down every request and answers from a script.

interface Seen {
  method: string;
  url: string;
  route: Route;
  body: unknown;
}

// A body-less answer (204) is described in the contract as {status, body}:
// there is no JSON to describe. These are its examples, sent as they are.
interface Bare {
  status: number;
  raw: string;
}

const bareSchema = (schema: string) => !!(schemas[schema]?.properties?.status as { const?: unknown } | undefined)?.const;
const bare = (example: Record<string, unknown>): Bare => ({ status: example.status as number, raw: example.body as string });

function server(answer: (route: Route, seen: Seen) => { status: number; body?: unknown; raw?: string }): { fetch: FetchLike; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetchImpl: FetchLike = async (url, init = {}) => {
    const method = init.method ?? "GET";
    const s: Seen = { method, url, route: routeFor(method, url), body: init.body ? JSON.parse(init.body as string) : undefined };
    seen.push(s);
    const { status, body, raw } = answer(s.route, s);
    if (raw !== undefined) return new Response(status === 204 ? null : raw, { status });
    return new Response(status === 204 || body === undefined ? null : JSON.stringify(body), { status });
  };
  return { fetch: fetchImpl, seen };
}

// Each route's own example as its answer; 204 where there is no body.
const byExample = (pick: Record<string, string> = {}) =>
  server((route) => {
    if (!route.response) return { status: 204 };
    const name = pick[route.response] ?? `${route.response}.json`;
    return bareSchema(`${route.response}.schema.json`) ? bare(ex(name)) : { status: 200, body: ex(name) };
  });

class MemoryStore implements KeyValue {
  data = new Map<string, string>();
  async get(k: string) {
    return this.data.get(k) ?? null;
  }
  async set(k: string, v: string) {
    this.data.set(k, v);
  }
}

// ---------------------------------------------------------------------------

describe("the vendored contract", () => {
  it("is all there: index.json lists exactly the files vendored", () => {
    const present = Object.keys(files)
      .filter((f) => f !== "index.json")
      .sort();
    expect(present).toEqual([...index.files].sort());
    expect(index.version).toBe(1);
  });

  it("has examples that pass their own schemas", () => {
    for (const [name, data] of Object.entries(examples)) {
      expect(problems(schemaFor(name), data), name).toEqual([]);
    }
  });

  it("has nothing the app has not been told about", () => {
    const claimed = new Set(ROUTES.flatMap((r) => [r.request, r.response]).filter(Boolean).map((n) => `${n}.schema.json`));
    const unknown = Object.keys(schemas).filter((s) => !claimed.has(s) && !(s in UNUSED_SCHEMAS));
    expect(unknown, "new schemas in the contract: map them to a route above, or say why the app does not use them").toEqual([]);
  });
});

describe("the routes the app calls", () => {
  const mentioned = (route: string) => new RegExp(`${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w/:-])`).test(prose);

  it("are all in the contract, but for the ones it is known to leave out", () => {
    const missing = ROUTES.map((r) => r.contract).filter((c) => !mentioned(c));
    expect(missing.sort()).toEqual([...NOT_IN_CONTRACT].sort());
  });

  it("are all exercised below: every client function, through a route above", async () => {
    const { fetch, seen } = byExample();
    const c = client(BASE, "mnb_tok", fetch);
    await everyCall(c);
    await connect(BASE, "secret", { name: "Pixel", platform: "android" }, fetch);
    const called = new Set(seen.map((s) => s.route));
    expect(ROUTES.filter((r) => !called.has(r)).map((r) => r.contract)).toEqual([]);
    expect(Object.keys(c).sort()).toEqual(Object.keys(CALLS).sort());
  });
});

// One way to call every client function, with arguments the app's own code
// would build where it has code that builds them.
const t = () => ex<{ tournament: Tournament }>("tournament-response.json").tournament;

const CALLS: Record<keyof Client, (c: Client) => Promise<unknown>> = {
  me: (c) => c.me(),
  signOut: (c) => c.signOut(),
  tournaments: (c) => c.tournaments(),
  tournament: (c) => c.tournament(2),
  round: (c) => c.round(2, 1),
  sync: (c) => c.sync(2, []),
  clear: (c) => c.clear(2, 1, 101, "1-0"),
  pair: (c) => c.pair(2, ["postponed_1"]),
  unpair: (c) => c.unpair(2, 2),
  publish: (c) => c.publish(2, 1, 3),
  standings: (c) => c.standings(2),
  incidents: (c) => c.incidents(2, 1),
  players: (c) => c.players(2),
  createPlayer: (c) => c.createPlayer(2, { name: "Doe, Jane", fide_id: "", fide_rating: "", federation: "BEL", club: "" } as Record<string, unknown> as { name: string }),
  updatePlayer: (c) => c.updatePlayer(2, 6, { present: false }),
  edit: (c) => c.edit(2, 1, { kind: "swap", a: 11, b: 12 }),
  finishEdits: (c) => c.finishEdits(2, 1, ["mpa_pibe"]),
  discardEdits: (c) => c.discardEdits(2, 1),
  confirmResult: (c) => c.confirmResult(2, 1, 101, "1-0"),
  rejectResult: (c) => c.rejectResult(2, 1, 101, "1-0"),
  updateSettings: (c) => c.updateSettings(2, { venue: "Hall B" }),
  attachPhoto: (c) => c.attachPhoto(2, 4, "/9j/AAAA"),
  updateIncident: (c) => c.updateIncident(2, 4, { kind: "time_added", note: "Two minutes to Black" }),
  deleteIncident: (c) => c.deleteIncident(2, 4),
  photo: (c) => c.photo(2, 4).catch(() => null),
  tournamentOptions: (c) => c.tournamentOptions(),
  createTournament: (c) => c.createTournament(toFields({ ...startForm(null), name: "Hall Open" })),
  searchPlayers: (c) => c.searchPlayers(2, "Zylv", "fide"),
  addPlayerFrom: (c) => c.addPlayerFrom(2, { source: "fide", fide_id: 4000001 }),
  setByes: (c) => c.setByes(2, 6, [{ round: 3, kind: "absent" }]),
  boardLinks: (c) => c.boardLinks(2),
  createBoardLink: (c) => c.createBoardLink(2, "Hall A"),
  revokeBoardLink: (c) => c.revokeBoardLink(2, 1),
  hall: (c) => c.hall(2),
  hallPrint: (c) => c.hallPrint(2, "standings"),
  hallCountdown: (c) => c.hallCountdown(2, 5),
  hallCancelCountdown: (c) => c.hallCancelCountdown(2),
  hallAnnounce: (c) => c.hallAnnounce(2, { canned: "silence" }),
  playerCard: (c) => c.playerCard(2, 1),
  arrivals: (c) => c.arrivals(2),
  prizes: (c) => c.prizes(2),
  pushStatus: (c) => c.pushStatus(),
  registerPush: (c) => c.registerPush({ platform: "apns", token: "a1b2c3d4e5f60718", environment: "sandbox", events: ["round_paired", "incident"], tag: BASE }),
  unregisterPush: (c) => c.unregisterPush(),
  putLiveActivity: (c) => c.putLiveActivity(2, { round: 1, token: "80f1a2b3c4d5e6f7", environment: "production" }),
  deleteLiveActivity: (c) => c.deleteLiveActivity(2),
  setDefaultTime: (c) => c.setDefaultTime(2, 1, "2026-11-08T14:30:00Z"),
  cancelDefaultTime: (c) => c.cancelDefaultTime(2, 1),
  liveBoards: (c) => c.liveBoards(2),
  liveGame: (c) => c.liveGame(2, "9b1d6c0e4f7a4a1e8d2c5b6a7f809112"),
  sendBoardCommand: (c) => c.sendBoardCommand(2, { kind: "flip", link_id: 4, board: 12, game: "9b1d6c0e4f7a4a1e8d2c5b6a7f809112", args: { flipped: true } }),
  boardCommand: (c) => c.boardCommand(2, 41),
};

async function everyCall(c: Client) {
  for (const call of Object.values(CALLS)) await call(c);
}

// ---------------------------------------------------------------------------

describe("every answer in the contract, through the app's client", () => {
  // Each response example, as the client function for its route hands it on.
  const cases: [string, (c: Client) => Promise<unknown>, (e: Record<string, unknown>) => unknown][] = [
    ["me-response", (c) => c.me(), (e) => e],
    ["tournament-options-response", (c) => c.tournamentOptions(), (e) => e],
    ["tournaments-response", (c) => c.tournaments(), (e) => e.tournaments],
    ["tournament-create-response", CALLS.createTournament, (e) => e.tournament],
    ["tournament-response", (c) => c.tournament(2), (e) => e.tournament],
    ["standings-response", (c) => c.standings(2), (e) => e.standings],
    ["incidents-response", (c) => c.incidents(2), (e) => e.incidents],
    ["sync-response", (c) => c.sync(2, []), (e) => e.results],
    ["round-response", (c) => c.round(2, 1), (e) => e.round],
    ["publish-response", (c) => c.publish(2, 1, 2), (e) => e.publish_level],
    ["finish-edits-response", (c) => c.finishEdits(2, 1), (e) => e],
    ["settings-response", (c) => c.updateSettings(2, {}), (e) => e.settings],
    ["incident-response", (c) => c.attachPhoto(2, 4, "/9j/AAAA"), (e) => e.incident],
    ["players-response", (c) => c.players(2), (e) => e.players],
    ["player-card-response", (c) => c.playerCard(2, 1), (e) => e.card],
    ["arrivals-response", (c) => c.arrivals(2), (e) => e.arrivals],
    ["prizes-response", (c) => c.prizes(2), (e) => e.prizes],
    ["player-search-response", (c) => c.searchPlayers(2, "Zylv", "fide"), (e) => e.results],
    ["player-response", (c) => c.setByes(2, 6, []), (e) => e.player],
    ["board-links-response", (c) => c.boardLinks(2), (e) => e.links],
    ["board-link-create-response", (c) => c.createBoardLink(2), (e) => e],
    ["hall-response", (c) => c.hall(2), (e) => e],
    ["hall-command-response", (c) => c.hallPrint(2, "both"), (e) => e],
    ["board-verdict-response", (c) => c.clear(2, 1, 101, ""), () => undefined],
    ["connect-response", (c) => c.me(), (e) => e],
    // 204, no body: the client must not try to read JSON out of nothing.
    ["sign-out-response", (c) => c.signOut(), () => undefined],
    ["unpair-response", (c) => c.unpair(2, 2), () => undefined],
    ["board-link-revoke-response", (c) => c.revokeBoardLink(2, 1), () => undefined],
    ["live-boards-response", (c) => c.liveBoards(2), (e) => e],
    ["live-board-game-response", (c) => c.liveGame(2, "9b1d6c0e4f7a4a1e8d2c5b6a7f809112"), (e) => e],
    ["live-board-command-response", (c) => c.boardCommand(2, 41), (e) => e.command],
    ["incident-delete-response", (c) => c.deleteIncident(2, 4), () => undefined],
    ["push-response", (c) => c.pushStatus(), (e) => e.push],
    ["push-unregister-response", (c) => c.unregisterPush(), () => undefined],
    ["live-activity-response", (c) => c.deleteLiveActivity(2), () => undefined],
    ["default-time-response", (c) => c.cancelDefaultTime(2, 1), () => undefined],
  ];

  it("covers every response schema in the contract", () => {
    const responses = Object.keys(schemas).filter((s) => s.endsWith("-response.schema.json") && !(s in UNUSED_SCHEMAS));
    expect(cases.map(([s]) => `${s}.schema.json`).sort()).toEqual(responses.sort());
  });

  for (const [schema, call, unwrap] of cases) {
    const variants = Object.keys(examples).filter((n) => schemaFor(n) === `${schema}.schema.json`);
    for (const name of variants) {
      it(`${name} comes out of the client as the app expects`, async () => {
        const body = ex(name);
        const c = client(BASE, "mnb_tok", server(() => (bareSchema(`${schema}.schema.json`) ? bare(body) : { status: 200, body })).fetch);
        const got = schema === "connect-response" ? await connect(BASE, "s", { name: "x", platform: "y" }, server(() => ({ status: 201, body })).fetch) : await call(c);
        expect(got).toEqual(unwrap(body));
      });
    }
  }

  it("hears a refused unpair or revoke as the server words it", async () => {
    const refusals: [string, number, (c: Client) => Promise<unknown>][] = [
      ["error.refused.json", 422, (c) => c.unpair(2, 1)],
      ["error.link-not-found.json", 404, (c) => c.revokeBoardLink(2, 99)],
    ];
    for (const [name, status, call] of refusals) {
      const body = ex(name);
      const error = await call(client(BASE, "mnb_tok", server(() => ({ status, body })).fetch)).catch((e) => e);
      expect(error, name).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status, code: body.error, message: body.message });
    }
  });

  it("turns every error example into an ApiError the app reads", async () => {
    for (const name of Object.keys(examples).filter((n) => schemaFor(n) === "error.schema.json")) {
      const body = ex(name);
      const c = client(BASE, "mnb_tok", server(() => ({ status: 409, body })).fetch);
      const error = await c.pair(2).catch((e) => e);
      expect(error, name).toBeInstanceOf(ApiError);
      expect(error.code).toBe(body.error);
      expect(error.message).toBe(body.message);
      const ask = needsAcknowledgement(error);
      if (body.error === "needs_acknowledgement") {
        expect(ask!.confirm).toEqual(body.confirm);
        if (body.checker) expect(ask!.checker).toEqual(body.checker);
      } else {
        expect(ask).toBeNull();
      }
    }
  });
});

describe("what the answers mean to the app", () => {
  const rounds = Object.keys(examples)
    .filter((n) => schemaFor(n) === "round-response.schema.json")
    .map((n) => ex<{ round: Round }>(n).round);
  const boards = rounds.flatMap((r) => r.boards);

  it("labels every board status the contract has, and nothing it does not", () => {
    const statuses = enumOf(definition("board_report").properties!.status);
    const known: Record<BoardStatus, true> = { waiting: true, live: true, finished: true };
    expect(Object.keys(known).sort()).toEqual([...(statuses as string[])].sort());
    for (const status of statuses as BoardStatus[]) {
      const report: BoardReport = { status, result: null, mismatch: false, moves_count: 0, updated_at: "2026-11-07T14:32:05Z" };
      expect(boardReportLabel(report), status).toBeTruthy();
    }
  });

  it("shows moves_count as full moves, as the server counts it", () => {
    const reports = boards.map((b) => b.board_report).filter((r): r is BoardReport => !!r);
    expect(reports.length).toBeGreaterThan(0);
    for (const r of reports) {
      const label = boardReportLabel(r)!;
      if (r.result) expect(label).toMatch(/^board /);
      else if (r.status === "live") expect(label).toBe(`playing · ${r.moves_count} ${r.moves_count === 1 ? "move" : "moves"}`);
    }
    // 1.e4 e5 2.Nf3 is three plies and move 2: the app must not halve it again.
    expect(boardReportLabel({ status: "live", result: null, mismatch: false, moves_count: 2, updated_at: "2026-11-07T14:32:05Z" })).toBe("playing · 2 moves");
  });

  it("prints every round example as pairings", () => {
    for (const round of rounds) {
      const text = pairingsText(t(), round);
      for (const b of round.boards) expect(text).toContain(b.label);
    }
  });

  it("prints every standings example, Keizer's integer ranks included", () => {
    for (const name of Object.keys(examples).filter((n) => schemaFor(n) === "standings-response.schema.json")) {
      const s = ex<{ standings: Standings }>(name).standings;
      const text = standingsText(t(), s);
      for (const row of s.rows) if (row.player) expect(text).toContain(row.player.name);
    }
  });

  it("files every sync answer the way the outbox should", async () => {
    const answers = ex<{ results: EntryAnswer[] }>("sync-response.json").results;
    const cids = answers.map((a) => a.cid!);
    const box = new Outbox(new MemoryStore(), () => cids.shift()!);
    await box.addResult(BASE, 2, { round: 1, pairing: 101, board: 1, white: 11, black: 12, result: "1-0", expected: "" });
    await box.addIncident(BASE, 2, { round: 1, pairing: 101, board: 1, type: "clock", note: "" });
    const outcome = await box.flush(BASE, 2, async () => answers);
    expect(outcome).toMatchObject({ saved: answers.filter((a) => a.status === "saved").length, offline: false });
  });

  it("adds every search hit from the list it came from", () => {
    for (const hit of ex<{ results: SearchHit[] }>("player-search-response.json").results) {
      expect(sourceOf(hit)).not.toBeNull();
      expect(typeof hitDetails(hit)).toBe("string");
    }
  });

  it("reads a player's byes round by round", () => {
    const p = ex<{ player: Player }>("player-response.byes.json").player;
    const rows = byeRows(3, 1, p.byes!);
    expect(rows.find((r) => r.round === p.byes![0].round)?.kind).toBe(p.byes![0].kind);
  });

  it("offers only incident kinds the server knows", () => {
    const kinds = enumOf(definition("incident").properties!.kind);
    for (const [kind] of incidentKinds()) expect(kinds, kind).toContain(kind);
  });

  it("knows every value of the contract's closed sets", () => {
    const same = (mine: Record<string, true>, theirs: unknown[]) => expect(Object.keys(mine).sort()).toEqual([...(theirs as string[])].sort());
    same({ owner: true, editor: true, arbiter: true } satisfies Record<Role, true>, enumOf(definition("role")));
    same(
      { results: true, incidents: true, pair: true, publish: true, players: true, standings: true, settings: true } satisfies Record<Capability, true>,
      enumOf(definition("capability")),
    );
    same({ setup: true, running: true, finished: true } satisfies Record<TournamentStatus, true>, enumOf(definition("tournament_status")));
    same({ active: true, withdrawn: true, expelled: true } satisfies Record<Player["status"], true>, enumOf(definition("player").properties!.status));
    same(
      { saved: true, refused: true, retry: true } satisfies Record<EntryAnswer["status"], true>,
      enumOf(definition("sync-response.schema.json#/properties/results/items").properties!.status),
    );
    same(
      Object.fromEntries(PUSH_EVENTS.map((e) => [e, true])) as Record<PushEvent, true>,
      enumOf(definition("push-response.schema.json#/definitions/event")),
    );
    same(
      { unconfirmed: true, confirmed: true } satisfies Record<NonNullable<Board["phone"]>["state"], true>,
      enumOf(definition("phone").properties!.state),
    );
  });
});

describe("what live boards mean to the app", () => {
  it("reads every live-boards example: states and alarms in words or raw, never empty", () => {
    const data = ex<LiveBoards>("live-boards-response.json");
    for (const x of data.tables) {
      expect(stateLabel(x.state)).not.toBe("");
      for (const a of x.alarms) expect(alarmLabel(a)).not.toBe("");
    }
    for (const c of data.commands) if (c.state === "failed") expect(boxErrorText(c.error, c.detail)).not.toBe("");
  });

  it("words the live-board refusals the contract records", () => {
    for (const [name, status] of [
      ["error.board-not-found.json", 404],
      ["error.result-entered.json", 409],
    ] as const) {
      const body = ex(name);
      expect(liveErrorText(new ApiError(status, body.error as string, body.message as string, body)), name).not.toBeNull();
    }
  });
});

describe("the app's types against the contract's shapes", () => {
  // The compiler holds each spec to its type (see `shape`); the test holds
  // the spec to the schema.
  const cases: [string, Record<string, string>, string][] = [
    ["ServerInfo", shape<ServerInfo>()({ name: "required", version: "required", api: "required", desktop: "required" }), "server"],
    ["Device", shape<Device>()({ id: "required", name: "required nullable", platform: "required nullable" }), "device"],
    ["UserInfo", shape<UserInfo>()({ email: "required", name: "required nullable" }), "user"],
    [
      "TournamentLine",
      shape<TournamentLine>()({
        id: "required",
        name: "required",
        role: "required",
        status: "required",
        start_date: "required nullable",
        end_date: "required nullable",
        city: "required nullable",
        rounds_count: "required nullable",
        paired_rounds: "required",
      }),
      "tournament_line",
    ],
    [
      "Tournament",
      shape<Tournament>()({
        id: "required",
        name: "required",
        role: "required",
        status: "required",
        rounds_count: "required nullable",
        paired_rounds: "required",
        can: "required",
        read_only: "required",
        archived: "required",
        handed_off: "required",
        pairing_system: "required",
        team: "required",
        rounds: "required",
        next_round: "required nullable",
        settings: "required",
        bye_kinds: "optional",
        openresults_url: "optional nullable",
      }),
      "tournament",
    ],
    ["Warning", shape<Warning>()({ id: "required", confirm: "required", message: "required" }), "warning"],
    ["BoardPlayer", shape<BoardPlayer>()({ id: "required", name: "required", title: "required nullable", rating: "required nullable", score: "required" }), "board_player"],
    [
      "Board",
      shape<Board>()({
        id: "required",
        board: "required nullable",
        label: "required",
        white: "required nullable",
        black: "required nullable",
        bye: "required",
        vacant: "optional",
        empty: "optional",
        result: "required",
        clearable: "required",
        phone: "optional nullable",
        board_report: "optional nullable",
      }),
      "board",
    ],
    [
      "BoardReport",
      shape<BoardReport>()({ status: "required", result: "required nullable", mismatch: "required", moves_count: "required", updated_at: "required" }),
      "board_report",
    ],
    [
      "Round",
      shape<Round>()({
        number: "required",
        latest: "required",
        publish_level: "required",
        boards: "required",
        byes: "required",
        pool: "optional",
        hand_edits: "optional",
        results: "required",
      }),
      "round",
    ],
    ["StandingRow", shape<StandingRow>()({ rank: "required nullable", player: "required nullable", points: "required nullable", tiebreaks: "required" }), "common.schema.json#/definitions/standings/properties/rows/items"],
    ["Standings", shape<Standings>()({ tiebreaks: "required", rows: "required", tiebreaks_through: "optional", rounds_paired: "optional" }), "standings"],
    [
      "Player",
      shape<Player>()({
        id: "required",
        name: "required",
        title: "required nullable",
        sex: "required nullable",
        federation: "required nullable",
        club: "required nullable",
        birth_year: "required nullable",
        fide_id: "required nullable",
        fide_rating: "required nullable",
        national_rating: "required nullable",
        rating: "required nullable",
        pairing_number: "required nullable",
        start_round: "required nullable",
        status: "required",
        absent: "required",
        absent_rounds: "required",
        present: "optional",
        byes: "optional",
      }),
      "player",
    ],
    ["Bye", shape<Bye>()({ round: "required", kind: "required" }), "bye"],
    [
      "SearchHit",
      shape<SearchHit>()({
        source: "required",
        fide_id: "required nullable",
        national_id: "required nullable",
        name: "required",
        federation: "required nullable",
        title: "required nullable",
        sex: "required nullable",
        birth_year: "required nullable",
        fide_rating: "required nullable",
        national_rating: "required nullable",
        club: "required nullable",
        already_in: "required",
      }),
      "player-search-response.schema.json#/properties/results/items",
    ],
    [
      "BoardLink",
      shape<BoardLink>()({ id: "required", kind: "required", label: "required nullable", reach: "required nullable", created_at: "required", last_seen_at: "required nullable" }),
      "board_link",
    ],
    [
      "Incident",
      shape<Incident>()({
        id: "required",
        round: "required",
        board: "required nullable",
        kind: "required",
        note: "required",
        white: "required nullable",
        black: "required nullable",
        occurred_at: "required",
        by: "required nullable",
        has_photo: "required",
      }),
      "incident",
    ],
    [
      "EntryAnswer",
      shape<EntryAnswer>()({ cid: "required nullable", status: "required", reason: "required nullable", message: "required nullable" }),
      "sync-response.schema.json#/properties/results/items",
    ],
    ["PushStatus", shape<PushStatus>()({ available: "required", platforms: "required", events: "required", registration: "required nullable" }), "push-response.schema.json#/properties/push"],
    ["TournamentOptions", shape<TournamentOptions>()({ systems: "required", player_sources: "required", defaults: "required" }), "tournament-options-response.schema.json#"],
    [
      "LiveBoards",
      shape<LiveBoards>()({ poll_seconds: "required", round: "required nullable", boxes: "required", tables: "required", commands: "required" }),
      "live-boards-response.schema.json#",
    ],
    [
      "LiveBox",
      shape<LiveBox>()({ link_id: "required", name: "required", version: "required nullable", last_seen_at: "required nullable", online: "required", tables_at: "required" }),
      "live-boards-response.schema.json#/properties/boxes/items",
    ],
    [
      "LiveTable",
      shape<LiveTable>()({
        link_id: "required",
        board: "required",
        name: "required",
        table: "required nullable",
        serial: "required nullable",
        connected: "required",
        last_seen: "required nullable",
        stale: "required",
        state: "required",
        flipped: "required",
        alarms: "required",
        alarm_detail: "required nullable",
        draft: "required nullable",
        guessed_plies: "required",
        fen: "required nullable",
        last_move: "required nullable",
        white_ms: "required nullable",
        black_ms: "required nullable",
        running: "required nullable",
        clock_at: "required",
        round: "required nullable",
        board_no: "required nullable",
        game: "required nullable",
        pairing: "required nullable",
        board_result: "required nullable",
        plies: "required",
      }),
      "live-boards-response.schema.json#/properties/tables/items",
    ],
    [
      "LivePairing",
      shape<LivePairing>()({ id: "required", round: "required", board: "required nullable", label: "required", white: "required nullable", black: "required nullable", result: "required nullable" }),
      "live-boards-response.schema.json#/properties/tables/items/properties/pairing",
    ],
    [
      "BoardCommand",
      shape<BoardCommand>()({
        id: "required",
        kind: "required",
        link_id: "required nullable",
        board: "required nullable",
        game: "required nullable",
        args: "required",
        state: "required",
        error: "required nullable",
        detail: "required nullable",
        created_at: "required",
        sent_at: "required nullable",
        done_at: "required nullable",
        expires_at: "required nullable",
        by: "required nullable",
      }),
      "live-board-command-response.schema.json#/properties/command",
    ],
    [
      "LiveGame",
      shape<LiveGame>()({
        game: "required",
        status: "required",
        result: "required nullable",
        moves: "required",
        move_clocks: "required",
        white_ms: "required nullable",
        black_ms: "required nullable",
        running: "required nullable",
        start_fen: "required nullable",
        reconstructed: "required",
        guessed: "required",
        reported_at: "required nullable",
      }),
      "live-board-game-response.schema.json#",
    ],
  ];

  for (const [name, spec, where] of cases) {
    it(`${name} promises nothing the contract does not`, () => {
      expect(shapeMismatches(spec, definition(where))).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------

describe("every request the app builds", () => {
  const captured = async (call: (c: Client) => Promise<unknown>): Promise<Seen> => {
    const { fetch, seen } = byExample();
    await call(client(BASE, "mnb_tok", fetch));
    expect(seen).toHaveLength(1);
    return seen[0];
  };

  const valid = (s: Seen) => {
    if (s.route.request) expect(problems(`${s.route.request}.schema.json`, s.body), `${s.method} ${s.url}`).toEqual([]);
    else expect(s.body, `${s.method} ${s.url} sends no body`).toBeUndefined();
  };

  it("passes its request schema, for every client function", async () => {
    for (const [name, call] of Object.entries(CALLS)) {
      const s = await captured(call);
      expect(s.route, name).toBeDefined();
      valid(s);
    }
  });

  it("connects with what the schema asks for", async () => {
    const { fetch, seen } = byExample();
    await connect(BASE, "s3cret", { name: "Pixel", platform: "android" }, fetch);
    valid(seen[0]);
  });

  it("syncs what the outbox queues: results, and incidents with or without a photo", async () => {
    const box = new Outbox(new MemoryStore());
    await box.addResult(BASE, 2, { round: 1, pairing: 101, board: 1, white: 11, black: 12, result: "1-0", expected: "" });
    await box.addResult(BASE, 2, { round: 1, pairing: 102, board: null, white: 13, black: null, result: "+-", expected: "" });
    await box.addIncident(BASE, 2, { round: 1, pairing: 101, board: 1, type: "clock", note: "Flag" });
    await box.addIncident(BASE, 2, { round: 1, pairing: 101, board: 1, type: "illegal_move", note: "", photo: "/9j/AAAA" });
    const { fetch, seen } = server(() => ({ status: 200, body: { results: [] } }));
    const c = client(BASE, "mnb_tok", fetch);
    await box.flush(BASE, 2, (entries) => c.sync(2, entries));
    expect(seen.length).toBeGreaterThan(0);
    seen.forEach(valid);
  });

  it("makes every kind of hand edit the schema takes", async () => {
    const edits: HandEdit[] = [
      { kind: "swap", a: 11, b: 12 },
      { kind: "vacate", player: 11 },
      { kind: "vacate", player: 11, bye_type: "requested-half" },
      { kind: "bye", pairing: 101 },
      { kind: "fill", pairing: 101, player: 13 },
      { kind: "pool_pair", a: 13, b: 14 },
      { kind: "pool_pair", a: 13, b: 14, board: 3 },
      { kind: "pool_bye", player: 13 },
      { kind: "bye_pair", pairing: 101, player: 13 },
      { kind: "delete", pairing: 101 },
    ];
    for (const edit of edits) valid(await captured((c) => c.edit(2, 1, edit, ["swap_rules"])));
  });

  it("changes every setting the server lists as editable", async () => {
    const tournament = t();
    tournament.settings.editable = ["rounds_count", "tiebreaks", "time_control", "chief_arbiter", "deputy_arbiter", "venue", "city", "bye_value", "ask_bye_type", "shared_places"];
    const draft = {
      ...initial(tournament),
      rounds_count: 9,
      tiebreaks: ["BH"],
      time_control: "90+30",
      chief_arbiter: "IA Somebody",
      deputy_arbiter: "FA Somebody Else",
      venue: "Hall B",
      city: "Bruges",
      bye_value: 0.5,
      ask_bye_type: true,
      shared_places: true,
    };
    const diff = changes(tournament, draft);
    expect(Object.keys(diff)).toHaveLength(10);
    valid(await captured((c) => c.updateSettings(2, diff)));
  });

  it("creates a tournament from the form, blank or filled", async () => {
    const options = ex<TournamentOptions>("tournament-options-response.json");
    valid(await captured((c) => c.createTournament(toFields(startForm(options)))));
    valid(await captured((c) => c.createTournament(toFields({ ...startForm(null), name: "X", rounds_count: "7", federation: "bel" }))));
  });

  it("adds players typed in or picked from either list, and changes them", async () => {
    valid(await captured((c) => c.addPlayerFrom(2, { source: "bel", national_id: "12345" })));
    valid(await captured((c) => c.addPlayerFrom(2, { source: "fide", fide_id: 4000001 })));
    valid(await captured((c) => c.createPlayer(2, { name: "Doe, Jane" })));
    const changes = [{ withdrawn: true }, { present: true }, { absent_rounds: [2, 3] }, { name: "Doe, J.", fide_id: "123", fide_rating: "2000", federation: "", club: "" }];
    for (const change of changes) valid(await captured((c) => c.updatePlayer(2, 6, change, ["second_half_bye"])));
  });

  it("sends a player's byes as the editor leaves them", async () => {
    const byes = byesToSend(
      [
        { round: 1, kind: "absent" },
        { round: 2, kind: "requested-half" },
        { round: 3, kind: "full-point" },
      ],
      1,
    );
    valid(await captured((c) => c.setByes(2, 6, byes)));
  });

  it("asks for a board code with or without a name", async () => {
    valid(await captured((c) => c.createBoardLink(2)));
    valid(await captured((c) => c.createBoardLink(2, "Hall A")));
  });

  it("sends every hall command in the shape the schema takes", async () => {
    for (const what of ["pairings", "placecards", "both", "standings", "playerlist", "slips"] as const) valid(await captured((c) => c.hallPrint(2, what)));
    for (const minutes of [1, 2, 5, 10, 15, 20, 30]) valid(await captured((c) => c.hallCountdown(2, minutes)));
    valid(await captured((c) => c.hallCancelCountdown(2)));
    for (const canned of ["silence", "phones", "seats", "results", "arbiter"] as const) valid(await captured((c) => c.hallAnnounce(2, { canned })));
    valid(await captured((c) => c.hallAnnounce(2, { text: "Round 3 starts in five minutes at board 1." })));
  });

  it("registers for push on either platform, with or without its choices", async () => {
    valid(await captured((c) => c.registerPush({ platform: "fcm", token: "fcm:APA91b-x_y.z" })));
    valid(await captured((c) => c.registerPush({ platform: "apns", token: "a1b2c3d4e5f60718", environment: "production", events: [...PUSH_EVENTS], tag: BASE })));
    valid(await captured((c) => c.registerPush({ platform: "apns", token: "a1b2c3d4e5f60718", events: [] })));
  });

  it("sends every live-board command the sheet can build in the shape the schema takes", async () => {
    const game = "9b1d6c0e4f7a4a1e8d2c5b6a7f809112";
    const box = (kind: Exclude<BoardCommandRequest["kind"], "accept_result">, args: Record<string, unknown> = {}, g: string | null = game): BoardCommandRequest => ({
      kind,
      link_id: 4,
      board: 12,
      ...(g ? { game: g } : {}),
      args,
    });
    const requests: BoardCommandRequest[] = [
      { kind: "accept_result", game },
      box("confirm_guess", { ply: 23 }),
      box("reject_guess", { ply: 23 }),
      box("accept_draft", { draft: 7 }),
      box("dismiss_draft", { draft: 7 }),
      box("set_position", { fen: completeFen("4k3/8/8/8/8/8/8/4K3") }),
      box("takeback", { plies: 1 }),
      box("takeback", { plies: 20 }),
      box("flip", { flipped: true }),
      box("link", { round: 3, board_no: 5 }, null),
      box("unlink"),
      box("restart"),
      box("resync", {}, null),
      ...["1-0", "0-1", "1/2-1/2", "*"].map((result) => box("finish", { result })),
    ];
    for (const r of requests) valid(await captured((c) => c.sendBoardCommand(2, r)));
  });

  it("publishes at every level", async () => {
    for (const level of [0, 1, 2, 3] as const) valid(await captured((c) => c.publish(2, 1, level)));
  });
});
