import { describe, expect, it } from "vitest";
import { ApiError, client, connect, needsAcknowledgement, OfflineError, type FetchLike } from "./api";

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

// A fetch that records the request and answers with `status` and `body`.
function fake(status: number, body?: unknown, raw?: string): { fetch: FetchLike; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetchImpl: FetchLike = async (url, init = {}) => {
    seen.push({
      url,
      method: init.method ?? "GET",
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    });
    const text = raw ?? (body === undefined ? "" : JSON.stringify(body));
    return new Response(status === 204 ? null : text, { status });
  };
  return { fetch: fetchImpl, seen };
}

const BASE = "https://pairings.example";

describe("connect", () => {
  it("posts the secret and the phone's name, without a token", async () => {
    const { fetch, seen } = fake(201, { token: "mnb_x", device: { id: 1 }, user: { email: "a@b" }, server: { api: 1 } });

    const answer = await connect(`${BASE}/`, "s3cret", { name: "Pixel", platform: "android" }, fetch);

    expect(answer.token).toBe("mnb_x");
    expect(seen[0].url).toBe(`${BASE}/api/manubrium/v1/connect`);
    expect(seen[0].method).toBe("POST");
    expect(seen[0].body).toEqual({ secret: "s3cret", name: "Pixel", platform: "android" });
    expect(seen[0].headers.authorization).toBeUndefined();
  });

  it("turns a refused code into an ApiError with the server's sentence", async () => {
    const { fetch } = fake(401, { error: "invalid_code", message: "That code is not valid." });

    await expect(connect(BASE, "old", { name: "x", platform: "web" }, fetch)).rejects.toMatchObject({
      status: 401,
      code: "invalid_code",
      message: "That code is not valid.",
    });
  });
});

describe("client", () => {
  it("sends the bearer token and unwraps the answer", async () => {
    const { fetch, seen } = fake(200, { tournaments: [{ id: 3, name: "Open", role: "arbiter" }] });

    const list = await client(BASE, "mnb_tok", fetch).tournaments();

    expect(list).toEqual([{ id: 3, name: "Open", role: "arbiter" }]);
    expect(seen[0].headers.authorization).toBe("Bearer mnb_tok");
    expect(seen[0].headers.accept).toBe("application/json");
  });

  it("builds every route the server has", async () => {
    const { fetch, seen } = fake(200, {
      round: {},
      results: [],
      publish_level: 1,
      standings: {},
      incidents: [],
      players: [],
      player: {},
      tournament: {},
    });
    const api = client(BASE, "t", fetch);

    await api.tournament(7);
    await api.round(7, 2);
    await api.sync(7, []);
    await api.clear(7, 2, 99, "1-0");
    await api.pair(7, ["recorded_missing"]);
    await api.publish(7, 2, 1);
    await api.standings(7);
    await api.incidents(7, 2);
    await api.players(7);
    await api.createPlayer(7, { name: "Late" });
    await api.updatePlayer(7, 5, { withdrawn: true }, ["second_half_bye"]);

    expect(seen.map((s) => `${s.method} ${s.url.replace(`${BASE}/api/manubrium/v1`, "")}`)).toEqual([
      "GET /tournaments/7",
      "GET /tournaments/7/rounds/2",
      "POST /tournaments/7/sync",
      "POST /tournaments/7/rounds/2/boards/99/clear",
      "POST /tournaments/7/rounds",
      "PUT /tournaments/7/rounds/2/publish",
      "GET /tournaments/7/standings",
      "GET /tournaments/7/incidents?round=2",
      "GET /tournaments/7/players",
      "POST /tournaments/7/players",
      "PATCH /tournaments/7/players/5",
    ]);
    expect(seen[3].body).toEqual({ expected: "1-0" });
    expect(seen[4].body).toEqual({ acknowledged: ["recorded_missing"] });
    expect(seen[10].body).toEqual({ player: { withdrawn: true }, acknowledged: ["second_half_bye"] });
  });

  it("builds the hand-edit, verdict, settings and photo routes", async () => {
    const { fetch, seen } = fake(200, { round: { number: 2 }, pibe: null, settings: { time_control: "90+30" }, incident: { id: 4 } });
    const api = client(BASE, "t", fetch);

    expect(await api.edit(7, 2, { kind: "swap", a: 1, b: 2 }, ["pairing_rules"])).toEqual({ number: 2 });
    expect(await api.finishEdits(7, 2, ["mpa_pibe"])).toMatchObject({ pibe: null });
    await api.confirmResult(7, 2, 99, "1-0");
    await api.rejectResult(7, 2, 99, "0-1");
    expect(await api.updateSettings(7, { time_control: "90+30" })).toEqual({ time_control: "90+30" });
    expect(await api.attachPhoto(7, 4, "/9j/4AAQ")).toEqual({ id: 4 });

    expect(seen.map((s) => `${s.method} ${s.url.replace(`${BASE}/api/manubrium/v1`, "")}`)).toEqual([
      "POST /tournaments/7/rounds/2/edits",
      "POST /tournaments/7/rounds/2/edits/finish",
      "POST /tournaments/7/rounds/2/boards/99/confirm",
      "POST /tournaments/7/rounds/2/boards/99/reject",
      "PATCH /tournaments/7/settings",
      "POST /tournaments/7/incidents/4/photo",
    ]);
    expect(seen[0].body).toEqual({ edit: { kind: "swap", a: 1, b: 2 }, acknowledged: ["pairing_rules"] });
    expect(seen[1].body).toEqual({ acknowledged: ["mpa_pibe"] });
    expect(seen[2].body).toEqual({ expected: "1-0" });
    expect(seen[3].body).toEqual({ expected: "0-1" });
    expect(seen[4].body).toEqual({ settings: { time_control: "90+30" } });
    expect(seen[5].body).toEqual({ photo: "/9j/4AAQ" });
  });

  it("builds the new-tournament, player list, byes and board-link routes", async () => {
    const { fetch, seen } = fake(200, {
      systems: [{ id: "swiss_dutch", label: "Swiss (Dutch)" }],
      player_sources: [],
      defaults: {},
      tournament: { id: 9 },
      results: [{ name: "Carlsen, Magnus" }],
      player: { id: 5 },
      links: [{ id: 2 }],
      link: { id: 3 },
      code: "alnasl_abc",
    });
    const api = client(BASE, "t", fetch);
    const fields = {
      name: "Hall Open",
      start_date: "2026-10-21",
      end_date: null,
      city: "Gent",
      venue: null,
      system: "swiss_dutch",
      rounds_count: 7,
      time_control: "90+30",
      federation: "BEL",
      rated: true,
    };

    expect((await api.tournamentOptions()).systems).toHaveLength(1);
    expect(await api.createTournament(fields)).toEqual({ id: 9 });
    expect(await api.searchPlayers(7, "Carlsen, M", "fide")).toEqual([{ name: "Carlsen, Magnus" }]);
    expect(await api.addPlayerFrom(7, { source: "fide", fide_id: 1503014 })).toEqual({ id: 5 });
    await api.addPlayerFrom(7, { source: "bel", national_id: 12345 });
    expect(await api.setByes(7, 5, [{ round: 4, kind: "half" }])).toEqual({ id: 5 });
    expect(await api.boardLinks(7)).toEqual([{ id: 2 }]);
    expect(await api.createBoardLink(7, "Top boards")).toMatchObject({ code: "alnasl_abc" });
    await api.createBoardLink(7);
    await api.revokeBoardLink(7, 3);
    await api.updatePlayer(7, 5, { present: true });

    expect(seen.map((s) => `${s.method} ${s.url.replace(`${BASE}/api/manubrium/v1`, "")}`)).toEqual([
      "GET /tournament-options",
      "POST /tournaments",
      "GET /tournaments/7/player-search?q=Carlsen%2C+M&source=fide",
      "POST /tournaments/7/players",
      "POST /tournaments/7/players",
      "PUT /tournaments/7/players/5/byes",
      "GET /tournaments/7/board-links",
      "POST /tournaments/7/board-links",
      "POST /tournaments/7/board-links",
      "DELETE /tournaments/7/board-links/3",
      "PATCH /tournaments/7/players/5",
    ]);
    expect(seen[1].body).toEqual({ tournament: fields });
    expect(seen[3].body).toEqual({ player: { from: { source: "fide", fide_id: 1503014 } } });
    expect(seen[4].body).toEqual({ player: { from: { source: "bel", national_id: 12345 } } });
    expect(seen[5].body).toEqual({ byes: [{ round: 4, kind: "half" }] });
    expect(seen[7].body).toEqual({ link: { label: "Top boards" } });
    expect(seen[8].body).toEqual({});
    expect(seen[10].body).toEqual({ player: { present: true }, acknowledged: [] });
  });

  it("takes a byes answer without a player in it", async () => {
    const { fetch } = fake(204);
    await expect(client(BASE, "t", fetch).setByes(7, 5, [])).resolves.toBeNull();
  });

  it("hands a refused bye's sentence through as it is", async () => {
    const { fetch } = fake(422, { error: "bye_not_allowed", message: "Round 6 allows no half-point bye in this tournament." });
    await expect(client(BASE, "t", fetch).setByes(7, 5, [{ round: 6, kind: "half" }])).rejects.toMatchObject({
      status: 422,
      message: "Round 6 allows no half-point bye in this tournament.",
    });
  });

  it("fetches a photo as bytes, with the token, and 404 as an error", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const ok: FetchLike = async (url, init = {}) => {
      seen.push({ url, headers: init.headers as Record<string, string> });
      return new Response(jpeg, { status: 200, headers: { "content-type": "image/jpeg" } });
    };

    const blob = await client(BASE, "tok", ok).photo(7, 4);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(jpeg);
    expect(seen[0].url).toBe(`${BASE}/api/manubrium/v1/tournaments/7/incidents/4/photo`);
    expect(seen[0].headers.authorization).toBe("Bearer tok");

    const gone: FetchLike = async () => new Response('{"error":"not_found"}', { status: 404 });
    await expect(client(BASE, "tok", gone).photo(7, 4)).rejects.toMatchObject({ status: 404, code: "not_found" });
  });

  it("reads a question the server wants answered", () => {
    const ask = needsAcknowledgement(
      new ApiError(409, "needs_acknowledgement", "Confirm?", {
        confirm: ["pairing_rules"],
        summary: "A  ⇄  B",
        warnings: ["A and B already played each other, in round 1."],
      }),
    );
    expect(ask).toEqual({
      confirm: ["pairing_rules"],
      summary: "A  ⇄  B",
      warnings: ["A and B already played each other, in round 1."],
      checker: undefined,
    });
    expect(needsAcknowledgement(new ApiError(422, "same_player", "No."))).toBeNull();
    expect(needsAcknowledgement(new Error("x"))).toBeNull();
  });

  it("answers 204 with nothing", async () => {
    const { fetch, seen } = fake(204);
    await expect(client(BASE, "t", fetch).unpair(7, 3)).resolves.toBeUndefined();
    expect(seen[0].method).toBe("DELETE");
  });

  it("keeps a refusal's extra fields, such as what to confirm", async () => {
    const { fetch } = fake(409, { error: "needs_acknowledgement", confirm: ["second_half_bye"], message: "Confirm?" });

    const error = await client(BASE, "t", fetch)
      .updatePlayer(1, 2, { absent_rounds: [4] })
      .catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe("needs_acknowledgement");
    expect(error.body.confirm).toEqual(["second_half_bye"]);
  });

  it("says when the network is gone rather than when the server refused", async () => {
    const down: FetchLike = async () => {
      throw new TypeError("Failed to fetch");
    };
    await expect(client(BASE, "t", down).me()).rejects.toBeInstanceOf(OfflineError);
  });

  it("does not mistake a captive portal's page for the API", async () => {
    const { fetch } = fake(200, undefined, "<html>Log in to the hotel wifi</html>");
    await expect(client(BASE, "t", fetch).me()).rejects.toMatchObject({ code: "not_api" });
  });

  it("names the status when an error has no JSON body", async () => {
    const { fetch } = fake(502, undefined, "<html>Bad gateway</html>");
    await expect(client(BASE, "t", fetch).me()).rejects.toMatchObject({ status: 502, code: "not_api" });
  });
});

describe("the hall commands", () => {
  it("send the shapes the contract takes, to the routes it names", async () => {
    const { fetch, seen } = fake(200, { sent_to: 2, round: 3 });
    const api = client(BASE, "tok", fetch);

    expect(await api.hallPrint(7, "slips")).toEqual({ sent_to: 2, round: 3 });
    await api.hallCountdown(7, 10);
    await api.hallCancelCountdown(7);
    await api.hallAnnounce(7, { canned: "phones" });
    await api.hallAnnounce(7, { text: "Boards 1 to 10, please come over." });
    await api.hall(7);

    expect(seen.map((s) => `${s.method} ${s.url.replace(`${BASE}/api/manubrium/v1`, "")}`)).toEqual([
      "POST /tournaments/7/hall/print",
      "POST /tournaments/7/hall/countdown",
      "POST /tournaments/7/hall/countdown",
      "POST /tournaments/7/hall/announce",
      "POST /tournaments/7/hall/announce",
      "GET /tournaments/7/hall",
    ]);
    expect(seen.map((s) => s.body)).toEqual([
      { what: "slips" },
      { minutes: 10 },
      { cancel: true },
      { canned: "phones" },
      { text: "Boards 1 to 10, please come over." },
      undefined,
    ]);
  });

  it("hands the hall's refusals through with their codes", async () => {
    for (const [status, code] of [
      [409, "hall_off"],
      [409, "hall_no_round"],
      [409, "hall_failed"],
      [400, "bad_request"],
    ] as const) {
      const { fetch } = fake(status, { error: code, message: "No." });
      await expect(client(BASE, "t", fetch).hallPrint(7, "both")).rejects.toMatchObject({ status, code });
    }
  });
});
