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
import { startForm, toFields } from "./ui/NewTournament";
import { INCIDENT_KINDS } from "./ui/RoundScreen";
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
  { method: "PATCH", path: /^\/tournaments\/\d+\/settings$/, contract: "PATCH /tournaments/:id/settings", request: "settings-request", response: "settings-response" },
  { method: "POST", path: /^\/tournaments\/\d+\/incidents\/\d+\/photo$/, contract: "POST /incidents/:iid/photo", request: "photo-request", response: "incident-response" },
  // The JPEG itself: named in the contract, deliberately outside its schemas.
  { method: "GET", path: /^\/tournaments\/\d+\/incidents\/\d+\/photo$/, contract: "GET /tournaments/:id/incidents/:iid/photo" },
  { method: "GET", path: /^\/tournaments\/\d+\/players$/, contract: "GET /tournaments/:id/players", response: "players-response" },
  { method: "GET", path: /^\/tournaments\/\d+\/player-search$/, contract: "GET /tournaments/:id/player-search", response: "player-search-response" },
  { method: "POST", path: /^\/tournaments\/\d+\/players$/, contract: "POST /tournaments/:id/players", request: "player-create-request", response: "player-response" },
  { method: "PATCH", path: /^\/tournaments\/\d+\/players\/\d+$/, contract: "PATCH /tournaments/:id/players/:pid", request: "player-update-request", response: "player-response" },
  { method: "PUT", path: /^\/tournaments\/\d+\/players\/\d+\/byes$/, contract: "PUT /tournaments/:id/players/:pid/byes", request: "byes-request", response: "player-response" },
  { method: "GET", path: /^\/tournaments\/\d+\/board-links$/, contract: "GET /tournaments/:id/board-links", response: "board-links-response" },
  { method: "POST", path: /^\/tournaments\/\d+\/board-links$/, contract: "POST /tournaments/:id/board-links", request: "board-link-create-request", response: "board-link-create-response" },
  { method: "DELETE", path: /^\/tournaments\/\d+\/board-links\/\d+$/, contract: "DELETE /tournaments/:id/board-links/:lid", response: "board-link-revoke-response" },
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
  confirmResult: (c) => c.confirmResult(2, 1, 101, "1-0"),
  rejectResult: (c) => c.rejectResult(2, 1, 101, "1-0"),
  updateSettings: (c) => c.updateSettings(2, { venue: "Hall B" }),
  attachPhoto: (c) => c.attachPhoto(2, 4, "/9j/AAAA"),
  photo: (c) => c.photo(2, 4).catch(() => null),
  tournamentOptions: (c) => c.tournamentOptions(),
  createTournament: (c) => c.createTournament(toFields({ ...startForm(null), name: "Hall Open" })),
  searchPlayers: (c) => c.searchPlayers(2, "Zylv", "fide"),
  addPlayerFrom: (c) => c.addPlayerFrom(2, { source: "fide", fide_id: 4000001 }),
  setByes: (c) => c.setByes(2, 6, [{ round: 3, kind: "absent" }]),
  boardLinks: (c) => c.boardLinks(2),
  createBoardLink: (c) => c.createBoardLink(2, "Hall A"),
  revokeBoardLink: (c) => c.revokeBoardLink(2, 1),
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
    ["player-search-response", (c) => c.searchPlayers(2, "Zylv", "fide"), (e) => e.results],
    ["player-response", (c) => c.setByes(2, 6, []), (e) => e.player],
    ["board-links-response", (c) => c.boardLinks(2), (e) => e.links],
    ["board-link-create-response", (c) => c.createBoardLink(2), (e) => e],
    ["board-verdict-response", (c) => c.clear(2, 1, 101, ""), () => undefined],
    ["connect-response", (c) => c.me(), (e) => e],
    // 204, no body: the client must not try to read JSON out of nothing.
    ["sign-out-response", (c) => c.signOut(), () => undefined],
    ["unpair-response", (c) => c.unpair(2, 2), () => undefined],
    ["board-link-revoke-response", (c) => c.revokeBoardLink(2, 1), () => undefined],
  ];

  it("covers every response schema in the contract", () => {
    const responses = Object.keys(schemas).filter((s) => s.endsWith("-response.schema.json"));
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
    for (const [kind] of INCIDENT_KINDS) expect(kinds, kind).toContain(kind);
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
      { unconfirmed: true, confirmed: true } satisfies Record<NonNullable<Board["phone"]>["state"], true>,
      enumOf(definition("phone").properties!.state),
    );
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
    ["TournamentOptions", shape<TournamentOptions>()({ systems: "required", player_sources: "required", defaults: "required" }), "tournament-options-response.schema.json#"],
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

  it("publishes at every level", async () => {
    for (const level of [0, 1, 2, 3] as const) valid(await captured((c) => c.publish(2, 1, level)));
  });
});
