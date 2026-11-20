// The hall path of a relayed tournament (contract revision 8), from the
// phone's side: where a request goes, what makes it go the other way, and
// that a write tried on both is the same write (one Idempotency-Key).

import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, client, editRefs, OfflineError, refOf, sameRow, type FetchLike, type Round, type Tournament } from "./api";
import { HALL_QUIET_MS, HALL_STORE_KEY, HALL_TIMEOUT_MS, hallCapable, hallPath, HallRoutes, laptopSilentSince, readHall, usableHallUrl, type RelayHall } from "./hall";
import { KeyMemory, RelayedWrite, type RelayCommand } from "./relay";
import { examples, problems } from "./contract.testkit";

const CLOUD = "https://pairings.example";
const LAPTOP = "http://192.168.1.20:4748";
const ex = <T>(name: string): T => structuredClone(examples[name]) as T;
/** The contract's pass was minted at 01:28 and runs out at 13:28: the clock these tests keep. */
const atTheContractsHour = () => Date.parse("2026-11-20T02:00:00Z");

/** The contract's relayed tournament with a hall path: id 1 here, 2 on the laptop. */
const relayHall = () => ex<{ tournament: Tournament & { relay: { hall: RelayHall } } }>("tournament-response.relay-hall.json");
const accepted = () => ex<{ command: RelayCommand }>("command-response.hall-path.json");

interface Seen {
  where: "cloud" | "laptop" | "other";
  method: string;
  path: string;
  auth: string | undefined;
  key: string | undefined;
  body: unknown;
}

type Reply = { status: number; body?: unknown } | "offline" | "hang";

/** Two servers behind one fetch: what each answers, and every request each was sent. */
function servers(cloud: (s: Seen) => Reply, laptop: (s: Seen) => Reply = () => "offline") {
  const seen: Seen[] = [];
  const fetchImpl: FetchLike = (url, init = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const where = url.startsWith(CLOUD) ? "cloud" : url.startsWith(LAPTOP) ? "laptop" : "other";
    const s: Seen = {
      where,
      method: init.method ?? "GET",
      path: url.replace(/^https?:\/\/[^/]+\/api\/manubrium\/v1/, ""),
      auth: headers.authorization,
      key: headers["idempotency-key"],
      body: init.body ? JSON.parse(init.body as string) : undefined,
    };
    seen.push(s);
    const reply = where === "cloud" ? cloud(s) : where === "laptop" ? laptop(s) : "offline";
    if (reply === "offline") return Promise.reject(new TypeError("Network request failed"));
    if (reply === "hang") return new Promise<Response>(() => undefined);
    return Promise.resolve(new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status }));
  };
  return { fetch: fetchImpl, seen };
}

/** The cloud as the contract shows it: the relayed tournament, and a 202 for every write. */
const cloudAnswers = (s: Seen): Reply => {
  if (s.method === "GET" && s.path === "/tournaments/1") return { status: 200, body: relayHall() };
  if (s.method === "GET" && s.path.startsWith("/tournaments/1/rounds/")) return { status: 200, body: ex("round-response.json") };
  if (s.path === "/tournaments/1/sync") return { status: 200, body: ex("sync-response.pending.json") };
  return { status: 202, body: ex("command-response.pending.json") };
};

async function setup(laptop: (s: Seen) => Reply, cloud: (s: Seen) => Reply = cloudAnswers) {
  const routes = new HallRoutes(atTheContractsHour);
  const { fetch, seen } = servers(cloud, laptop);
  const onCommand = vi.fn();
  const api = client(CLOUD, "mnb_device", fetch, { routes, keys: new KeyMemory(), onCommand });
  await api.tournament(1);
  seen.length = 0;
  return { api, seen, routes, onCommand };
}

const UID = "24efe0c24a914381919b4c5d";

afterEach(() => {
  vi.useRealTimers();
});

describe("the hall path's address and pass", () => {
  it("takes the contract's relay.hall as it is", () => {
    const hall = readHall(relayHall().tournament.relay.hall)!;
    expect(hall.urls).toEqual([LAPTOP]);
    expect(hall.tournament_id).toBe(2);
    expect(hall.token.startsWith("oph1.")).toBe(true);
  });

  it("sends its pass only to a private address over http, or to https", () => {
    expect(usableHallUrl("http://192.168.1.20:4748")).toBe("http://192.168.1.20:4748");
    expect(usableHallUrl("http://10.0.0.5:4748/")).toBe("http://10.0.0.5:4748");
    expect(usableHallUrl("http://laptop.local:4748")).toBe("http://laptop.local:4748");
    expect(usableHallUrl("http://203.0.113.9:4748")).toBeNull();
    expect(usableHallUrl("http://100.64.1.2:4748")).toBeNull();
    expect(usableHallUrl("http://192.168.1.20:4748/somewhere")).toBeNull();
    expect(usableHallUrl("ftp://192.168.1.20")).toBeNull();
    expect(usableHallUrl("not a url")).toBeNull();
    expect(usableHallUrl("https://hall.example")).toBe("https://hall.example");
  });

  it("is no path at all without a usable address or a pass", () => {
    const hall = relayHall().tournament.relay.hall;
    expect(readHall(null)).toBeNull();
    expect(readHall(undefined)).toBeNull();
    expect(readHall({ ...hall, urls: ["http://8.8.8.8:4748"] })).toBeNull();
    expect(readHall({ ...hall, token: "" })).toBeNull();
  });

  it("names the tournament by the laptop's id on the laptop", () => {
    const hall = readHall(relayHall().tournament.relay.hall)!;
    expect(hallPath("/tournaments/1/rounds/2", hall)).toBe("/tournaments/2/rounds/2");
    expect(hallPath("/tournaments/1", hall)).toBe("/tournaments/2");
  });

  it("forgets a pass about to run out, and asks the cloud for a new one at most once a minute", () => {
    let now = Date.parse("2026-11-20T12:00:00Z");
    const routes = new HallRoutes(() => now);
    const hall = { ...readHall(relayHall().tournament.relay.hall)!, expires_at: "2026-11-20T13:00:00Z" };
    routes.set(CLOUD, 1, hall);
    expect(routes.get(CLOUD, 1)).not.toBeNull();
    expect(routes.wantsRefresh(CLOUD, 1)).toBe(false);
    now = Date.parse("2026-11-20T12:59:30Z");
    expect(routes.get(CLOUD, 1)).toBeNull();
    expect(routes.wantsRefresh(CLOUD, 1)).toBe(true);
    expect(routes.wantsRefresh(CLOUD, 1)).toBe(false);
    now += 61_000;
    expect(routes.wantsRefresh(CLOUD, 1)).toBe(true);
  });
});

describe("which requests may take the hall path", () => {
  it("takes the tournament's writes, named by uid", () => {
    expect(hallCapable("PATCH", `/tournaments/1/players/${UID}`, { player: { present: true } })).toBe(true);
    expect(hallCapable("POST", "/tournaments/1/rounds", { acknowledged: [] })).toBe(true);
    expect(hallCapable("POST", `/tournaments/1/rounds/2/boards/${UID}/clear`, { expected: "1-0" })).toBe(true);
    expect(hallCapable("POST", `/tournaments/1/rounds/2/boards/${UID}/history/row-17/undo`)).toBe(true);
    expect(hallCapable("POST", "/tournaments/1/hall/print", { what: "pairings" })).toBe(true);
  });

  it("leaves a request that names a row by a plain id to the cloud, which knows its own ids", () => {
    expect(hallCapable("PATCH", "/tournaments/1/players/6", { player: { present: true } })).toBe(false);
    expect(hallCapable("POST", "/tournaments/1/rounds/2/boards/99/clear", { expected: "1-0" })).toBe(false);
    expect(hallCapable("POST", `/tournaments/1/rounds/2/boards/${UID}/history/17/undo`)).toBe(false);
    expect(hallCapable("POST", "/tournaments/1/rounds/2/edits", { edit: { kind: "swap", a: 1, b: UID } })).toBe(false);
    expect(hallCapable("PUT", `/tournaments/1/rounds/2/matches/${UID}/lineups`, { a: [UID, 3], b: [] })).toBe(false);
    expect(hallCapable("POST", "/tournaments/1/sync", { entries: [{ cid: "c", kind: "result", round: 1, pairing: 101 }] })).toBe(false);
    expect(hallCapable("POST", "/tournaments/1/sync", { entries: [{ cid: "c", kind: "result", round: 1, pairing: UID, white: UID, black: null }] })).toBe(true);
    expect(hallCapable("DELETE", "/tournaments/1/board-links/4")).toBe(false);
    expect(hallCapable("POST", "/tournaments/1/live-boards/commands", { kind: "flip", link_id: 1, board: 1, args: {} })).toBe(false);
  });

  it("keeps the cloud's own routes on the cloud: presence, notes, live activity, the account", () => {
    expect(hallCapable("PUT", "/tournaments/1/team", { presence: { round: 1 } })).toBe(false);
    expect(hallCapable("POST", "/tournaments/1/notes", { note: { body: "x" } })).toBe(false);
    expect(hallCapable("PATCH", "/tournaments/1/notes/3", { note: { pinned: true } })).toBe(false);
    expect(hallCapable("PUT", "/tournaments/1/live-activity", { activity: {} })).toBe(false);
    expect(hallCapable("PUT", "/tournaments/1/team-standings")).toBe(true);
    expect(hallCapable("GET", "/me")).toBe(false);
    expect(hallCapable("PUT", "/push", {})).toBe(false);
    expect(hallCapable("POST", "/tournaments", {})).toBe(false);
  });

  it("reads from the laptop the round, what is read beside it and the desk's tables; the tournament itself never", () => {
    expect(hallCapable("GET", "/tournaments/1")).toBe(false);
    expect(hallCapable("GET", "/tournaments/1/rounds/2")).toBe(true);
    expect(hallCapable("GET", `/tournaments/1/rounds/2/matches/${UID}`)).toBe(true);
    expect(hallCapable("GET", `/tournaments/1/rounds/2/boards/${UID}/history`)).toBe(true);
    expect(hallCapable("GET", "/tournaments/1/arrivals")).toBe(true);
    expect(hallCapable("GET", "/tournaments/1/incidents?round=2")).toBe(true);
    expect(hallCapable("GET", "/tournaments/1/players")).toBe(true);
    expect(hallCapable("GET", `/tournaments/1/players/${UID}/card`)).toBe(true);
    expect(hallCapable("GET", "/tournaments/1/players/6/card")).toBe(false);
    expect(hallCapable("GET", "/tournaments/1/commands/38cebf5f-fe01-40de-b795-a60689ed9d16")).toBe(true);
    expect(hallCapable("GET", `/tournaments/1/standings`)).toBe(true);
    expect(hallCapable("GET", `/tournaments/1/team-standings`)).toBe(true);
    expect(hallCapable("GET", `/tournaments/1/teams`)).toBe(true);
    expect(hallCapable("GET", `/tournaments/1/teams/${UID}`)).toBe(true);
    expect(hallCapable("GET", `/tournaments/1/board-prizes`)).toBe(true);
    expect(hallCapable("GET", `/tournaments/1/board-prizes?min_games=3`)).toBe(true);
    expect(hallCapable("GET", "/tournaments/1/teams/6")).toBe(false);
    expect(hallCapable("GET", "/tournaments/1/prizes")).toBe(false);
    expect(hallCapable("GET", "/tournaments/1/hall")).toBe(false);
    expect(hallCapable("GET", "/tournaments/1/player-search?q=x&source=fide")).toBe(false);
    expect(hallCapable("GET", "/tournaments/1/board-links")).toBe(false);
    expect(hallCapable("GET", "/tournaments/1/live-boards")).toBe(false);
    expect(hallCapable("GET", "/tournaments/1/notes")).toBe(false);
  });
});

describe("a write on a relayed tournament with a hall path", () => {
  it("goes to the laptop first, with the pass, the laptop's tournament id and its key, and is answered at once", async () => {
    const { api, seen, routes, onCommand } = await setup(() => ({ status: 200, body: accepted() }));

    const error = await api.updatePlayer(1, UID, { present: true }).catch((e) => e);

    expect(error).toBeInstanceOf(RelayedWrite);
    expect((error as RelayedWrite).command.state).toBe("accepted");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ where: "laptop", method: "PATCH", path: `/tournaments/2/players/${UID}` });
    expect(seen[0].auth).toBe(`Bearer ${relayHall().tournament.relay.hall.token}`);
    expect(seen[0].key).toMatch(/^[0-9a-f-]{36}$/);
    // Kept under the cloud's id, as every relayed write is.
    expect(onCommand).toHaveBeenCalledWith(1, expect.objectContaining({ state: "accepted" }), expect.objectContaining({ path: `/tournaments/1/players/${UID}` }));
    expect(routes.pathOf(CLOUD, 1)).toBe("hall");
  });

  it("goes through the cloud with the SAME key when the laptop cannot be reached", async () => {
    const { api, seen, routes } = await setup(() => "offline");

    const error = await api.updatePlayer(1, UID, { present: true }).catch((e) => e);

    expect(error).toBeInstanceOf(RelayedWrite);
    expect((error as RelayedWrite).command.state).toBe("pending");
    expect(seen.map((s) => s.where)).toEqual(["laptop", "cloud"]);
    expect(seen[1].path).toBe(`/tournaments/1/players/${UID}`);
    expect(seen[1].auth).toBe("Bearer mnb_device");
    expect(seen[1].key).toBe(seen[0].key);
    expect(seen[1].body).toEqual(seen[0].body);
    expect(routes.pathOf(CLOUD, 1)).toBe("cloud");
  });

  it("waits only a short while for the laptop, then the cloud carries it, same key", async () => {
    vi.useFakeTimers();
    const { api, seen } = await setup(() => "hang");

    const pending = api.updatePlayer(1, UID, { present: true }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(HALL_TIMEOUT_MS + 10);
    const error = await pending;

    expect(error).toBeInstanceOf(RelayedWrite);
    expect(seen.map((s) => s.where)).toEqual(["laptop", "cloud"]);
    expect(seen[1].key).toBe(seen[0].key);
  });

  it("goes through the cloud when the laptop refuses the pass, and asks the cloud for a new one", async () => {
    const { api, seen, routes } = await setup(() => ({ status: 401, body: { error: "unauthorized", message: "No." } }));

    await api.updatePlayer(1, UID, { present: true }).catch(() => undefined);
    expect(seen.map((s) => `${s.where} ${s.method} ${s.path}`)).toEqual([`laptop PATCH /tournaments/2/players/${UID}`, `cloud PATCH /tournaments/1/players/${UID}`]);
    expect(routes.get(CLOUD, 1)).toBeNull();

    // The next write does not try the refused pass; the tournament is read again for a new one.
    seen.length = 0;
    await api.updatePlayer(1, UID, { present: false }).catch(() => undefined);
    await vi.waitFor(() => expect(seen.some((s) => s.where === "cloud" && s.method === "GET" && s.path === "/tournaments/1")).toBe(true));
    expect(seen.filter((s) => s.where === "laptop")).toEqual([]);
    expect(routes.get(CLOUD, 1)).not.toBeNull();
  });

  it("goes through the cloud when the laptop says the route is the cloud's, or fails itself", async () => {
    for (const reply of [{ status: 409, body: { error: "cloud_only", message: "Ask the cloud." } }, { status: 500, body: { error: "oops", message: "x" } }, { status: 502 }]) {
      const { api, seen } = await setup(() => reply);
      await api.hallPrint(1, "pairings").catch(() => undefined);
      expect(seen.map((s) => s.where)).toEqual(["laptop", "cloud"]);
      expect(seen[1].key).toBe(seen[0].key);
    }
  });

  it("takes the laptop's refusal as the desk's answer: no second try through the cloud", async () => {
    const refused = { command: { ...accepted().command, state: "refused", status: 422, error: "invalid", message: "No such round." } };
    const { api, seen } = await setup(() => ({ status: 200, body: refused }));

    const error = await api.updatePlayer(1, UID, { present: true }).catch((e) => e);

    expect(error).toBeInstanceOf(RelayedWrite);
    expect((error as RelayedWrite).command.message).toBe("No such round.");
    expect(seen.map((s) => s.where)).toEqual(["laptop"]);
  });

  it("names the tournament's rows by plain id only to the cloud", async () => {
    const { api, seen } = await setup(() => ({ status: 200, body: accepted() }));
    await api.updatePlayer(1, 6, { present: true }).catch(() => undefined);
    expect(seen.map((s) => `${s.where} ${s.path}`)).toEqual(["cloud /tournaments/1/players/6"]);
  });

  it("never sends presence, notes, live activity or the account's routes to the laptop", async () => {
    const { api, seen } = await setup(() => ({ status: 200, body: {} }), () => ({ status: 200, body: { team: { others: [], heartbeat_seconds: 30 }, note: {}, notes: [], device: {}, push: {} } }));
    await api.team(1, 2);
    await api.createNote(1, { body: "Board 4 clock" });
    await api.putLiveActivity(1, { round: 2, token: "x" });
    await api.me();
    expect(seen.map((s) => s.where)).toEqual(["cloud", "cloud", "cloud", "cloud"]);
  });

  it("sends the outbox's entries to the laptop when they name their boards by uid; the laptop answers saved", async () => {
    const { api, seen } = await setup(() => ({ status: 200, body: ex("sync-response.json") }));
    const entries = [{ cid: "6f1c2a7e-0b9d-4e55-9a3c-2d8f1e0a4b11", kind: "result" as const, round: 1, pairing: UID, board: 1, white: "a1b2c3d4e5f6", black: "f6e5d4c3b2a1", result: "1-0", expected: "" }];

    const answers = await api.sync(1, entries);

    expect(answers.map((a) => a.status)).toEqual(["saved", "saved"]);
    expect(seen.map((s) => `${s.where} ${s.path}`)).toEqual(["laptop /tournaments/2/sync"]);
    expect(problems("sync-request.schema.json", seen[0].body)).toEqual([]);
  });

  it("sends an old outbox entry, named by the cloud's id, to the cloud", async () => {
    const { api, seen } = await setup(() => ({ status: 200, body: ex("sync-response.json") }));
    await api.sync(1, [{ cid: "c1", kind: "result", round: 1, pairing: 101, board: 1, white: 11, black: 12, result: "1-0", expected: "" }]);
    expect(seen.map((s) => s.where)).toEqual(["cloud"]);
  });

  it("tries the laptop's other addresses within the same short wait, and the one that answered first next time", async () => {
    const other = "http://10.0.0.20:4748";
    const routes = new HallRoutes(atTheContractsHour);
    const hall = readHall({ ...relayHall().tournament.relay.hall, urls: [LAPTOP, other] })!;
    routes.set(CLOUD, 1, hall);
    const seen: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      seen.push(url.slice(0, url.indexOf("/api")));
      if (url.startsWith(LAPTOP)) throw new TypeError("unreachable");
      return new Response(JSON.stringify(accepted()), { status: 200 });
    };
    const api = client(CLOUD, "mnb_device", fetchImpl, { routes, keys: new KeyMemory() });
    await api.updatePlayer(1, UID, { present: true }).catch(() => undefined);
    await api.updatePlayer(1, UID, { present: false }).catch(() => undefined);
    expect(seen).toEqual([LAPTOP, other, other]);
  });
});

describe("a read on a relayed tournament with a hall path", () => {
  it("reads the round from the laptop, with its own tournament id", async () => {
    const { api, seen } = await setup(() => ({ status: 200, body: ex("round-response.json") }));
    const round = await api.round(1, 1);
    expect(round.boards.length).toBeGreaterThan(0);
    expect(seen.map((s) => `${s.where} ${s.path}`)).toEqual(["laptop /tournaments/2/rounds/1"]);
  });

  it("asks the cloud first for a while after the laptop did not answer, and the laptop if the cloud cannot be reached", async () => {
    let now = Date.parse("2026-11-20T02:00:00Z");
    vi.spyOn(Date, "now").mockImplementation(() => now);
    let laptopUp = false;
    let cloudUp = true;
    const routes = new HallRoutes(() => now);
    const { fetch, seen } = servers(
      (s) => (cloudUp ? cloudAnswers(s) : "offline"),
      () => (laptopUp ? { status: 200, body: ex("round-response.json") } : "offline"),
    );
    const api = client(CLOUD, "mnb_device", fetch, { routes, keys: new KeyMemory() });
    await api.tournament(1);
    seen.length = 0;

    await api.round(1, 1);
    expect(seen.map((s) => s.where)).toEqual(["laptop", "cloud"]);

    seen.length = 0;
    await api.round(1, 1);
    expect(seen.map((s) => s.where)).toEqual(["cloud"]);

    seen.length = 0;
    cloudUp = false;
    laptopUp = true;
    await api.round(1, 1);
    expect(seen.map((s) => s.where)).toEqual(["cloud", "laptop"]);
    expect(routes.pathOf(CLOUD, 1)).toBe("hall");

    // Back to the laptop first once it answers again.
    seen.length = 0;
    await api.round(1, 1);
    expect(seen.map((s) => s.where)).toEqual(["laptop"]);

    // Neither: no connection, as before.
    now += HALL_QUIET_MS + 1;
    laptopUp = false;
    seen.length = 0;
    await api.round(1, 1).catch(() => undefined);
    seen.length = 0;
    await expect(api.round(1, 1)).rejects.toBeInstanceOf(OfflineError);
    vi.restoreAllMocks();
  });

  it("asks the cloud about a command the laptop has not seen", async () => {
    const { api, seen } = await setup(() => ({ status: 404, body: { error: "not_found", message: "No." } }), (s) => (s.path.includes("/commands/") ? { status: 202, body: ex("command-response.pending.json") } : cloudAnswers(s)));
    const command = await api.relayCommand(1, "38cebf5f-fe01-40de-b795-a60689ed9d16");
    expect(command.state).toBe("pending");
    expect(seen.map((s) => s.where)).toEqual(["laptop", "cloud"]);
  });

  it("keeps an error the laptop answers (a 404 for a board it does not have) as the answer", async () => {
    const { api, seen } = await setup(() => ({ status: 404, body: { error: "not_found", message: "No such board." } }));
    await expect(api.boardHistory(1, 1, UID)).rejects.toBeInstanceOf(ApiError);
    expect(seen.map((s) => s.where)).toEqual(["laptop"]);
  });
});

describe("without a hall path", () => {
  it("is the cloud alone: a tournament that is not relayed, or whose laptop is not listening", async () => {
    const plain = { ...relayHall(), tournament: { ...relayHall().tournament, relay: { ...relayHall().tournament.relay, hall: null } } };
    const routes = new HallRoutes(atTheContractsHour);
    const { fetch, seen } = servers((s) => (s.method === "GET" && s.path === "/tournaments/1" ? { status: 200, body: plain } : { status: 202, body: ex("command-response.pending.json") }), () => ({ status: 200, body: accepted() }));
    const api = client(CLOUD, "mnb_device", fetch, { routes, keys: new KeyMemory() });
    await api.tournament(1);
    await api.updatePlayer(1, UID, { present: true }).catch(() => undefined);
    expect(seen.map((s) => s.where)).toEqual(["cloud", "cloud"]);
    expect(routes.pathOf(CLOUD, 1)).toBeNull();
  });

  it("drops a path the tournament no longer has", async () => {
    let hall = true;
    const routes = new HallRoutes(atTheContractsHour);
    const { fetch } = servers((s) => {
      const body = relayHall();
      if (!hall) (body.tournament.relay as { hall: RelayHall | null }).hall = null;
      return s.path === "/tournaments/1" ? { status: 200, body } : { status: 202, body: ex("command-response.pending.json") };
    });
    const api = client(CLOUD, "mnb_device", fetch, { routes, keys: new KeyMemory() });
    await api.tournament(1);
    expect(routes.get(CLOUD, 1)).not.toBeNull();
    hall = false;
    await api.tournament(1);
    expect(routes.get(CLOUD, 1)).toBeNull();
  });
});

describe("rows by uid", () => {
  it("names a row by its uid when it has one, and by its id when the server sent none", () => {
    expect(refOf({ id: 4, uid: UID })).toBe(UID);
    expect(refOf({ id: 4 })).toBe(4);
    expect(sameRow(UID, { id: 4, uid: UID })).toBe(true);
    expect(sameRow(4, { id: 4, uid: UID })).toBe(true);
    expect(sameRow(5, { id: 4, uid: UID })).toBe(false);
    expect(sameRow("other", { id: 4, uid: UID })).toBe(false);
  });

  it("turns a hand edit's boards and players into uids from the round", () => {
    const round = ex<{ round: Round }>("round-response.json").round;
    const b = round.boards.find((x) => x.white && x.black)!;
    const edit = editRefs({ kind: "swap", a: b.white!.id, b: b.black!.id }, round);
    expect(edit).toEqual({ kind: "swap", a: b.white!.uid, b: b.black!.uid });
    expect(editRefs({ kind: "delete", pairing: b.id }, round)).toEqual({ kind: "delete", pairing: b.uid });
    expect(problems("edit-request.schema.json", { edit, acknowledged: [] })).toEqual([]);
  });
});

describe("the desk's tables on the hall path", () => {
  const tables: [string, (api: ReturnType<typeof client>) => Promise<unknown>, string, string][] = [
    ["standings", (api) => api.standings(1), "/tournaments/2/standings", "standings-response.json"],
    ["team standings", (api) => api.teamStandings(1), "/tournaments/2/team-standings", "team-standings-response.json"],
    ["teams", (api) => api.teams(1), "/tournaments/2/teams", "teams-response.json"],
    ["board prizes", (api) => api.boardPrizes(1, 3), "/tournaments/2/board-prizes?min_games=3", "board-prizes-response.json"],
  ];

  for (const [name, read, path, example] of tables) {
    it(`reads the ${name} from the laptop, and from the cloud when the laptop does not answer`, async () => {
      const { api, seen } = await setup(() => ({ status: 200, body: ex(example) }));
      expect(await read(api)).toBeTruthy();
      expect(seen.map((s) => `${s.where} ${s.path}`)).toEqual([`laptop ${path}`]);
      expect(seen[0].auth).toBe(`Bearer ${relayHall().tournament.relay.hall.token}`);

      const quiet = await setup(() => "offline", (s) => (s.path === "/tournaments/1" ? cloudAnswers(s) : { status: 200, body: ex(example) }));
      expect(await read(quiet.api)).toBeTruthy();
      expect(quiet.seen.map((s) => s.where)).toEqual(["laptop", "cloud"]);
    });
  }

  it("still has them when the hall has no internet: the laptop answers, the cloud is not there", async () => {
    let internet = true;
    const { api, seen, routes } = await setup(
      () => ({ status: 200, body: ex("standings-response.json") }),
      (s) => (internet ? cloudAnswers(s) : "offline"),
    );
    internet = false;
    const standings = await api.standings(1);
    expect(standings.rows.length).toBeGreaterThan(0);
    expect(seen.map((s) => s.where)).toEqual(["laptop"]);
    expect(routes.pathOf(CLOUD, 1)).toBe("hall");
  });

  it("keeps the prize list on the cloud: its players have ids and no uid", async () => {
    const { api, seen } = await setup(
      () => ({ status: 200, body: accepted() }),
      (s) => (s.path === "/tournaments/1/prizes" ? { status: 200, body: ex("prizes-response.json") } : cloudAnswers(s)),
    );
    await api.prizes(1);
    expect(seen.map((s) => s.where)).toEqual(["cloud"]);
  });
});

describe("the hall pass across restarts", () => {
  class Vault {
    data = new Map<string, string>();
    async get(k: string) {
      return this.data.get(k) ?? null;
    }
    async set(k: string, v: string) {
      this.data.set(k, v);
    }
  }
  const kept = (vault: Vault) =>
    JSON.parse(vault.data.get(HALL_STORE_KEY) ?? "[]") as { base: string; tournament: number; hall: RelayHall; snapshot?: { id: number } }[];

  /** A phone that read the tournament from the cloud once, with the vault attached. */
  async function first(vault = new Vault()) {
    const routes = new HallRoutes(atTheContractsHour);
    await routes.attach(vault);
    const { fetch } = servers(cloudAnswers);
    await client(CLOUD, "mnb_device", fetch, { routes, keys: new KeyMemory() }).tournament(1);
    await routes.saved();
    return { routes, vault };
  }

  it("keeps the pass, the laptop's addresses and id, and the tournament, per server and tournament", async () => {
    const { vault } = await first();
    const [k] = kept(vault);
    expect(k).toMatchObject({ base: CLOUD, tournament: 1, hall: { tournament_id: 2, urls: [LAPTOP], token: relayHall().tournament.relay.hall.token } });
    expect(k.snapshot?.id).toBe(1);
  });

  it("starts in a hall with no internet and still reaches the laptop: rounds and standings, with the kept tournament to open", async () => {
    const { vault } = await first();
    // A new run of the app: nothing in memory, the vault as it was, the cloud unreachable.
    const routes = new HallRoutes(atTheContractsHour);
    await routes.attach(vault);
    const { fetch, seen } = servers(
      () => "offline",
      (s) => ({ status: 200, body: ex(s.path.includes("standings") ? "standings-response.json" : "round-response.json") }),
    );
    const api = client(CLOUD, "mnb_device", fetch, { routes, keys: new KeyMemory() });
    await expect(api.tournament(1)).rejects.toBeInstanceOf(OfflineError);
    expect((routes.snapshot(CLOUD, 1) as Tournament).name).toBe(relayHall().tournament.name);
    expect(routes.keptTournaments(CLOUD)).toHaveLength(1);
    expect((await api.round(1, 1)).boards.length).toBeGreaterThan(0);
    expect((await api.standings(1)).rows.length).toBeGreaterThan(0);
    expect(seen.filter((s) => s.where === "laptop").map((s) => s.path)).toEqual(["/tournaments/2/rounds/1", "/tournaments/2/standings"]);
  });

  it("drops a pass that has run out by the next start", async () => {
    const { vault } = await first();
    const routes = new HallRoutes(() => Date.parse("2026-11-20T13:30:00Z"));
    await routes.attach(vault);
    expect(routes.get(CLOUD, 1)).toBeNull();
    expect(routes.snapshot(CLOUD, 1)).toBeNull();
    await routes.saved();
    expect(kept(vault)).toEqual([]);
  });

  it("drops it when the cloud says the tournament has no hall path any more, or is not relayed", async () => {
    for (const relay of [null, { ...relayHall().tournament.relay, hall: null }]) {
      const { routes, vault } = await first();
      const body = relayHall();
      (body.tournament as { relay: unknown }).relay = relay;
      const { fetch } = servers(() => ({ status: 200, body }));
      await client(CLOUD, "mnb_device", fetch, { routes, keys: new KeyMemory() }).tournament(1);
      await routes.saved();
      expect(kept(vault)).toEqual([]);
    }
  });

  it("drops it when the laptop refuses it (401)", async () => {
    const { routes, vault } = await first();
    const { fetch } = servers(cloudAnswers, () => ({ status: 401, body: { error: "unauthorized", message: "no" } }));
    await client(CLOUD, "mnb_device", fetch, { routes, keys: new KeyMemory() }).round(1, 1);
    await routes.saved();
    expect(kept(vault)).toEqual([]);
    expect(routes.get(CLOUD, 1)).toBeNull();
  });

  it("drops every pass of a server that no longer knows this phone, or that is removed from the app", async () => {
    const { routes, vault } = await first();
    const { fetch } = servers(() => ({ status: 401, body: { error: "unauthorized", message: "Sign in again." } }));
    await expect(client(CLOUD, "mnb_device", fetch, { routes, keys: new KeyMemory() }).tournaments()).rejects.toBeInstanceOf(ApiError);
    await routes.saved();
    expect(kept(vault)).toEqual([]);
    expect(routes.known(CLOUD, 1)).toBe(false);

    const again = await first();
    again.routes.forgetServer(CLOUD);
    await again.routes.saved();
    expect(kept(again.vault)).toEqual([]);
  });

  it("does not let an old kept path overwrite one learnt since, and survives a vault that holds rubbish", async () => {
    const vault = new Vault();
    vault.data.set(HALL_STORE_KEY, "{not json");
    const routes = new HallRoutes(atTheContractsHour);
    await routes.attach(vault);
    expect(routes.known(CLOUD, 1)).toBe(false);
    vault.data.set(HALL_STORE_KEY, JSON.stringify([{ base: CLOUD, tournament: 1, hall: { ...relayHall().tournament.relay.hall, token: "oph1.old" } }]));
    const fresh = new HallRoutes(atTheContractsHour);
    fresh.set(CLOUD, 1, readHall(relayHall().tournament.relay.hall));
    await fresh.attach(vault);
    expect(fresh.get(CLOUD, 1)!.token).toBe(relayHall().tournament.relay.hall.token);
  });
});

describe("the laptop gone quiet", () => {
  const at = (iso: string) => Date.parse(iso);
  it("is quiet after ten minutes without a word by any road, and not before", () => {
    const relay = { last_seen_at: "2026-11-20T10:00:00Z", hall: { seen_at: "2026-11-20T10:02:00Z" } };
    expect(laptopSilentSince(relay, null, at("2026-11-20T10:11:59Z"))).toBeNull();
    expect(laptopSilentSince(relay, null, at("2026-11-20T10:12:00Z"))?.toISOString()).toBe("2026-11-20T10:02:00.000Z");
    expect(laptopSilentSince(relay, at("2026-11-20T10:05:00Z"), at("2026-11-20T10:12:00Z"))).toBeNull();
    expect(laptopSilentSince({ last_seen_at: null }, null, at("2026-11-20T10:12:00Z"))).toBeNull();
  });
});
