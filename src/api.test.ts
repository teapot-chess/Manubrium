import { describe, expect, it } from "vitest";
import { ApiError, client, connect, OfflineError, type FetchLike } from "./api";

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
