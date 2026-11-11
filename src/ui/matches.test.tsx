// @vitest-environment happy-dom
//
// A team event on the round screen: matches as cards in the layout the
// tournament names, a result entered on a match's board, line-ups confirmed
// from the floor, the flat list an older server still gets, only the boards
// still playing - and, on a player's sheet, "will not play the next round"
// with the server's questions and refusals. Each against a fake API.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { useState } from "preact/hooks";
import { ApiError, OfflineError, type Board, type Client, type Match, type Player, type PlayerCard, type Round, type Tournament } from "../api";
import { Outbox, type KeyValue } from "../queue";
import type { SavedServer } from "../servers";
import type { Ctx } from "./App";
import { resetBack } from "../back";
import { PlayerSheet } from "./PlayerSheet";
import { PlayersScreen } from "./PlayersScreen";
import { RoundScreen } from "./RoundScreen";

const phone = vi.hoisted(() => {
  const kv = () => {
    const data = new Map<string, string>();
    return { data, get: async (k: string) => data.get(k) ?? null, set: async (k: string, v: string) => void data.set(k, v) };
  };
  return { storage: kv(), vault: kv() };
});

vi.mock("../platform", () => ({
  native: true,
  platform: "web",
  storage: phone.storage,
  secureStorage: phone.vault,
  onResume: () => () => undefined,
  onPause: () => () => undefined,
  awayOnPurpose: () => false,
  takePhoto: vi.fn(async () => null),
  shareText: vi.fn(async () => "shared"),
  scanQr: vi.fn(async () => null),
  remindAt: vi.fn(async () => true),
  cancelReminder: vi.fn(async () => undefined),
  deviceUnlockAvailable: async () => false,
  deviceUnlock: async () => false,
}));

class Memory implements KeyValue {
  data = new Map<string, string>();
  async get(key: string) {
    return this.data.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.data.set(key, value);
  }
}

const server: SavedServer = {
  base: "https://pairings.example",
  token: "mnb_t",
  label: "pairings.example",
  user: { email: "arbiter@example.org", name: null },
  info: { name: "OpenPairings", version: "1", api: 1, desktop: false },
  deviceId: 1,
  addedAt: "2026-10-21T00:00:00Z",
};

const seat = (id: number, name: string) => ({ id, name, title: null, rating: 2000, score: 0 });
const board = (id: number, white: string, black: string, result = ""): Board => ({
  id,
  board: id,
  label: String(id),
  white: seat(id * 10 + 1, white),
  black: seat(id * 10 + 2, black),
  bye: false,
  vacant: false,
  empty: false,
  result,
  clearable: false,
  phone: null,
});

// Match 1, Alpha against Bravo, on round boards 1 and 2; match 2, Charlie
// against Delta, on 3 and 4. The first-named team has White on board 1.
const boards = (): Board[] => [
  board(1, "Alpha One", "Bravo One"),
  board(2, "Bravo Two", "Alpha Two"),
  board(3, "Charlie One", "Delta One"),
  board(4, "Delta Two", "Charlie Two"),
];
const match = (id: number, a: string, b: string, ids: number[], extra: Partial<Match> = {}): Match => ({
  id: 30 + id,
  number: id,
  team_a: { id: id * 2 - 1, name: a, short_name: null },
  team_b: { id: id * 2, name: b, short_name: null },
  bye: false,
  boards: ids.map((bid, i) => ({ id: bid, number: i + 1, a_white: i % 2 === 0 })),
  game_points: { a: 0, b: 0 },
  match_points: null,
  complete: false,
  decision: null,
  lineups: { a: true, b: true, confirmed: true },
  ...extra,
});
const teamRound = (bs: Board[] = boards(), first: Partial<Match> = {}, second: Partial<Match> = {}): Round => ({
  number: 1,
  latest: true,
  publish_level: 1,
  boards: bs,
  byes: [],
  pool: [],
  hand_edits: { open: false, pibe: null },
  results: ["1-0", "1/2-1/2", "0-1"],
  matches: [match(1, "Alpha", "Bravo", [1, 2], first), match(2, "Charlie", "Delta", [3, 4], second)],
});

const tournament = (role: "owner" | "arbiter" = "owner", extra: Partial<Tournament> = {}): Tournament => ({
  id: 7,
  name: "Hall Cup",
  role,
  status: "running",
  rounds_count: 5,
  paired_rounds: 1,
  can: role === "owner" ? ["results", "incidents", "pair", "publish", "players", "standings", "settings"] : ["results", "incidents"],
  read_only: false,
  archived: false,
  handed_off: false,
  pairing_system: "swiss",
  team: true,
  rounds: [{ number: 1, publish_level: 1, missing_results: 4 }],
  next_round: null,
  settings: { points: { win: 1, draw: 0.5, loss: 0 } },
  ...extra,
});

type FakeApi = { [K in keyof Client]: Mock };

function fakeApi(r: Round, extra: Partial<FakeApi> = {}): FakeApi {
  return {
    round: vi.fn(async () => r),
    sync: vi.fn(async () => {
      throw new OfflineError();
    }),
    team: vi.fn(async () => ({ others: [], heartbeat_seconds: 30 })),
    notes: vi.fn(async () => []),
    arrivals: vi.fn(async () => []),
    incidents: vi.fn(async () => []),
    confirmLineup: vi.fn(async () => r),
    confirmLineups: vi.fn(async () => r),
    ...extra,
  } as never;
}

let outbox: Outbox;
let n = 0;

function Harness(props: { api: FakeApi; t: Tournament }) {
  const [, again] = useState(0);
  const ctx: Ctx = { server, api: props.api as unknown as Client, outbox, bump: () => again((x) => x + 1) };
  return <RoundScreen ctx={ctx} t={props.t} reloadTournament={async () => undefined} />;
}
const show = (api: FakeApi, t: Tournament = tournament()) => render(<Harness api={api} t={t} />);
const ctxWith = (api: FakeApi): Ctx => ({ server, api: api as unknown as Client, outbox, bump: () => undefined });

const el = (selector: string) =>
  waitFor(() => {
    const found = document.querySelector(selector);
    if (!found) throw new Error(`${selector} not rendered`);
    return found;
  });
const text = (selector: string) => document.querySelector(selector)?.textContent ?? "";
// The two seats of a board as drawn: [colour, name] left, then right.
const seatsOf = (id: number) =>
  [...document.querySelectorAll(`#board-${id} .seat`)].map((s) => [s.querySelector(".colour-dot")!.className.includes(" w") ? "w" : "b", s.querySelector(".seat-name")!.textContent]);

beforeEach(async () => {
  phone.storage.data.clear();
  phone.vault.data.clear();
  n = 0;
  outbox = new Outbox(new Memory(), () => `cid-${++n}`);
  await outbox.load();
});

afterEach(() => {
  cleanup();
  resetBack();
});

describe("a team round on the round screen", () => {
  it("is drawn as matches: the teams, the score, the match points once they exist", async () => {
    const bs = boards();
    bs[0].result = "1-0";
    bs[1].result = "1-0";
    show(fakeApi(teamRound(bs, { game_points: { a: 1, b: 1 }, match_points: { a: 1, b: 1 }, complete: true })));

    await el("#match-31");
    expect(document.querySelector("#boards")).toBeNull();
    expect(text("#match-31 .match-team.a")).toBe("Alpha");
    expect(text("#match-31 .match-team.b")).toBe("Bravo");
    expect(text("#match-score-31")).toBe("1 – 1");
    expect(text("#match-notes-31")).toBe("Match points 1 – 1");
    expect(text("#match-score-32")).toBe("0 – 0");
    expect(document.querySelector("#match-notes-32")).toBeNull();
    // The round's own count of what is missing is the flat list's, unchanged.
    expect(screen.getByText(/2 to go/)).toBeTruthy();
  });

  it("teams layout: the first-named team on the left on every board, a colour mark on every player, the score read left to right", async () => {
    const bs = boards();
    bs[0].result = "1-0";
    bs[1].result = "1-0";
    show(fakeApi(teamRound(bs)));

    await el("#board-2");
    expect(seatsOf(1)).toEqual([
      ["w", "Alpha One"],
      ["b", "Bravo One"],
    ]);
    // Board 2: Alpha has Black and still sits on the left.
    expect(seatsOf(2)).toEqual([
      ["b", "Alpha Two"],
      ["w", "Bravo Two"],
    ]);
    expect(document.querySelector("#board-1 .colour-dot")!.getAttribute("aria-label")).toBe("White");
    // White won both: 1-0 for Alpha on board 1, 0-1 on board 2 where Alpha is Black.
    expect(text("#board-1 .result")).toBe("1-0");
    expect(text("#board-2 .result")).toBe("0-1");
    // No team tags: the column is the team.
    expect(text("#board-2 .seat small")).toBe("2000");
  });

  it("white_left layout: White on the left on every board, each player tagged with the team", async () => {
    const bs = boards();
    bs[1].result = "1-0";
    show(fakeApi(teamRound(bs)), tournament("owner", { team_board_layout: "white_left" }));

    await el("#board-2");
    expect(seatsOf(2)).toEqual([
      ["w", "Bravo Two"],
      ["b", "Alpha Two"],
    ]);
    expect(text("#board-2 .result")).toBe("1-0");
    expect(text("#board-2 .seat small")).toBe("2000 · Bravo");
  });

  it("numbers a board within its match, with the round's own number beside it when they differ", async () => {
    show(fakeApi(teamRound()));
    await el("#board-3");
    expect(text("#board-1 .board-no")).toBe("1");
    expect(text("#board-3 .board-no")).toBe("13");
    expect(text("#board-3 .board-no small")).toBe("3");
  });

  it("shows a bye, a decision of the desk and a board no match claims", async () => {
    const r = teamRound([...boards(), board(5, "Stray White", "Stray Black")], { decision: "forfeit_b" });
    r.matches!.push(match(3, "Echo", "", [], { bye: true, team_b: null, game_points: { a: 1, b: 0 }, match_points: { a: 1, b: null }, complete: true }));
    show(fakeApi(r));

    await el("#match-33");
    expect(text("#match-33 .match-score")).toBe("bye");
    expect(text("#match-notes-33")).toBe("Match points 1");
    expect(text("#match-notes-31")).toBe("Forfeited by decision to Bravo");
    expect(text("#loose-boards")).toBe("Boards in no match");
    expect(document.querySelector("#boards #board-5")).not.toBeNull();
  });

  it("is the flat list it always was on a server that sends no matches", async () => {
    const r = teamRound();
    delete r.matches;
    show(fakeApi(r));

    await el("#boards #board-1");
    expect(document.querySelector("#matches")).toBeNull();
    expect(document.querySelectorAll("#boards .board")).toHaveLength(4);
  });
});

describe("a result on a match's board", () => {
  it("is entered as on any board, and counts in the match's score while it waits on the phone", async () => {
    const api = fakeApi(teamRound());
    show(api);

    fireEvent.click(await el("#board-2"));
    // The sheet names the match and the board, and says who is White.
    await screen.findByText("Match 1, board 2");
    expect(text("#result-white")).toBe("Bravo Two");
    fireEvent.click(screen.getByText("1-0"));

    // No signal: the result waits, mirrored on the row because Alpha (left) is Black...
    await waitFor(() => expect(text("#board-2 .result")).toContain("0-1"));
    expect(text("#board-2 .result")).toContain("Waiting");
    // ...and Bravo has the point, marked as not yet the server's.
    expect(text("#match-score-31")).toBe("0 – 1");
    expect(document.querySelector("#match-score-31")!.className).toContain("waiting");
    expect(text("#match-notes-31")).toBe("1 result waiting on this phone");

    const [queued] = outbox.list(server.base, 7);
    expect(queued.entry).toMatchObject({ kind: "result", pairing: 2, result: "1-0", expected: "", white: 21, black: 22 });
  });
});

describe("line-ups from the floor", () => {
  const waiting = { lineups: { a: false, b: true, confirmed: false } };

  it("says which matches wait, and confirms one side after showing who is in it", async () => {
    const confirmed = teamRound();
    const api = fakeApi(teamRound(boards(), waiting), { confirmLineup: vi.fn(async () => confirmed) });
    show(api);

    await el("#lineups-provisional-31");
    expect(text("#lineups-bar")).toContain("1 match waits for its line-ups.");
    expect(text("#lineups-confirmed-32")).toBe("line-ups confirmed");
    expect(text("#lineup-31-a")).toBe("Confirm Alpha");
    expect(text("#lineup-31-b")).toBe("Bravo: confirmed");

    fireEvent.click(document.querySelector("#lineup-31-a")!);
    await screen.findByText("Line-up: Alpha");
    expect([...document.querySelectorAll("#lineup-list .row-title")].map((e) => e.textContent)).toEqual(["Alpha One", "Alpha Two"]);
    expect([...document.querySelectorAll("#lineup-list .colour-dot")].map((e) => e.className)).toEqual(["colour-dot w", "colour-dot b"]);

    fireEvent.click(document.querySelector("#lineup-confirm")!);
    await waitFor(() => expect(api.confirmLineup).toHaveBeenCalledWith(7, 1, 31, "a"));
    // The round the server answered with is drawn: nothing waits any more.
    await el("#lineups-confirmed-31");
    expect(document.querySelector("#lineups-bar")).toBeNull();
    expect(screen.getByText("Line-up of Alpha in match 1 confirmed.")).toBeTruthy();
  });

  it("shows a confirmed line-up too, with nothing to press", async () => {
    show(fakeApi(teamRound(boards(), waiting)));
    fireEvent.click(await el("#lineup-31-b"));
    await screen.findByText("Line-up: Bravo");
    expect([...document.querySelectorAll("#lineup-list .row-title")].map((e) => e.textContent)).toEqual(["Bravo One", "Bravo Two"]);
    expect(document.querySelector("#lineup-confirm")).toBeNull();
  });

  it("lets an arbiter see what waits, and leaves the confirming to the organiser", async () => {
    show(fakeApi(teamRound(boards(), waiting)), tournament("arbiter"));
    await el("#lineup-31-a");
    expect(text("#lineup-31-a")).toBe("Alpha: not confirmed");
    expect(document.querySelector("#confirm-all-lineups")).toBeNull();

    fireEvent.click(document.querySelector("#lineup-31-a")!);
    await screen.findByText("Line-up: Alpha");
    expect(document.querySelector("#lineup-confirm")).toBeNull();
    expect(text("#lineup-state")).toContain("The organiser or an editor confirms line-ups.");
  });

  it("confirms the whole round only after asking", async () => {
    const api = fakeApi(teamRound(boards(), waiting, { lineups: { a: false, b: false, confirmed: false } }), { confirmLineups: vi.fn(async () => teamRound()) });
    show(api);

    await el("#lineups-bar");
    expect(text("#lineups-bar")).toContain("2 matches wait for their line-ups.");
    fireEvent.click(document.querySelector("#confirm-all-lineups")!);
    await screen.findByText("Confirm all line-ups for round 1?");
    expect(api.confirmLineups).not.toHaveBeenCalled();

    fireEvent.click(document.querySelector("#confirm-all-yes")!);
    await waitFor(() => expect(api.confirmLineups).toHaveBeenCalledWith(7, 1));
    await waitFor(() => expect(document.querySelector("#lineups-bar")).toBeNull());
    expect(screen.getByText("Every line-up of round 1 confirmed.")).toBeTruthy();
  });

  it("without a signal says so, and keeps the sheet and the line-up as they were", async () => {
    const api = fakeApi(teamRound(boards(), waiting), {
      confirmLineup: vi.fn(async () => {
        throw new OfflineError();
      }),
    });
    show(api);

    fireEvent.click(await el("#lineup-31-a"));
    fireEvent.click(await el("#lineup-confirm"));
    await screen.findByText(/No connection\. This needs the server/);
    expect(document.querySelector("#lineup-confirm")).not.toBeNull();
    expect(document.querySelector("#lineups-provisional-31")).not.toBeNull();
  });

  it("shows the server's own sentence when it refuses", async () => {
    const api = fakeApi(teamRound(boards(), waiting), {
      confirmLineup: vi.fn(async () => {
        throw new ApiError(409, "archived", "This tournament is archived - unarchive it first.");
      }),
    });
    show(api);

    fireEvent.click(await el("#lineup-31-a"));
    fireEvent.click(await el("#lineup-confirm"));
    await screen.findByText("This tournament is archived - unarchive it first.");
  });
});

describe("only the boards still playing", () => {
  it("hides the boards with a result, and a match that has none left", async () => {
    const bs = boards();
    bs[0].result = "1-0";
    bs[2].result = "1/2-1/2";
    bs[3].result = "0-1";
    show(fakeApi(teamRound(bs)));

    const chip = await el("#filter-open");
    expect(chip.textContent).toBe("Still playing (1)");
    expect(document.querySelector("#board-1")).not.toBeNull();

    fireEvent.click(chip);
    await waitFor(() => expect(document.querySelector("#board-1")).toBeNull());
    expect(document.querySelector("#board-2")).not.toBeNull();
    expect(document.querySelector("#match-32")).toBeNull();
    expect(chip.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(chip);
    await el("#match-32");
  });

  it("works on an individual round's flat list too", async () => {
    const bs = boards();
    bs[0].result = "1-0";
    const r = teamRound(bs);
    delete r.matches;
    show(fakeApi(r), tournament("owner", { team: false }));

    fireEvent.click(await el("#filter-open"));
    await waitFor(() => expect(document.querySelectorAll("#boards .board")).toHaveLength(3));
    expect(document.querySelector("#board-1")).toBeNull();
  });

  it("is not offered once every board has a result", async () => {
    show(fakeApi(teamRound(boards().map((b) => ({ ...b, result: "1-0" })))));
    await el("#match-31");
    expect(document.querySelector("#filter-open")).toBeNull();
  });
});

// ---------------------------------------------------------------------------

const person = (extra: Partial<Player> = {}): Player => ({
  id: 5,
  name: "Peeters, An",
  title: null,
  sex: null,
  federation: "BEL",
  club: "KSK",
  birth_year: null,
  fide_id: null,
  fide_rating: 2000,
  national_rating: null,
  rating: 2000,
  pairing_number: 5,
  start_round: null,
  status: "active",
  absent: false,
  absent_rounds: [],
  present: true,
  byes: [],
  ...extra,
});
const card = (extra: Partial<Player> = {}): PlayerCard => ({ player: person(extra), rank: 3, score: 1, games: [] });
const swiss = (role: "owner" | "arbiter" = "owner", kinds = [{ id: "absent", label: "Absent" }]) => tournament(role, { team: false, bye_kinds: kinds });
const typed = [
  { id: "requested-half", label: "Half-point bye" },
  { id: "requested-zero", label: "Zero-point bye" },
  { id: "full-point", label: "Full-point bye" },
];

describe("a player says they will not play the next round", () => {
  function sheet(api: FakeApi, t: Tournament) {
    return render(<PlayerSheet ctx={ctxWith(api)} t={t} playerId={5} onClose={() => undefined} />);
  }

  it("is noted in two taps, keeping the byes the player already had, and can be taken back", async () => {
    const before = card({ byes: [{ round: 4, kind: "absent" }] });
    const after = card({
      byes: [
        { round: 2, kind: "absent" },
        { round: 4, kind: "absent" },
      ],
    });
    const playerCard = vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(before).mockResolvedValueOnce(after).mockResolvedValueOnce(after).mockResolvedValue(before);
    const api = fakeApi(teamRound(), { playerCard, setByes: vi.fn(async () => null) });
    sheet(api, swiss());

    const open = await el("#sit-out-open");
    expect(open.textContent).toBe("Will not play round 2");
    fireEvent.click(open);
    expect(api.setByes).not.toHaveBeenCalled();

    fireEvent.click(await el("#sit-out-absent"));
    await waitFor(() =>
      expect(api.setByes).toHaveBeenCalledWith(7, 5, [
        { round: 2, kind: "absent" },
        { round: 4, kind: "absent" },
      ]),
    );
    expect((await el("#sit-out-state")).textContent).toBe("Not playing round 2: Absent.");
    expect(screen.getByText("Peeters, An sits out round 2 (Absent).")).toBeTruthy();

    fireEvent.click(document.querySelector("#sit-out-undo")!);
    await waitFor(() => expect(api.setByes).toHaveBeenLastCalledWith(7, 5, [{ round: 4, kind: "absent" }]));
    await el("#sit-out-open");
    expect(screen.getByText("Peeters, An plays round 2 again.")).toBeTruthy();
  });

  it("offers the kinds of bye the tournament takes, in the app's own words", async () => {
    const api = fakeApi(teamRound(), { playerCard: vi.fn(async () => card()), setByes: vi.fn(async () => null) });
    sheet(api, swiss("owner", typed));

    fireEvent.click(await el("#sit-out-open"));
    await el("#sit-out-pick");
    expect([...document.querySelectorAll("#sit-out-pick .btn:not(.ghost)")].map((b) => b.textContent)).toEqual(["Half-point bye", "Zero-point bye", "Full-point bye"]);

    // "Plays after all" backs out without asking the server anything.
    fireEvent.click(document.querySelector("#sit-out-keep")!);
    await el("#sit-out-open");
    expect(api.setByes).not.toHaveBeenCalled();
  });

  it("asks the server's question and sends the answer with it", async () => {
    const setByes = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError(409, "needs_acknowledgement", "A player gets one half-point bye per tournament (C.05). Round 2 would be another. Confirm to give it anyway.", {
          error: "needs_acknowledgement",
          confirm: ["second_half_bye"],
        }),
      )
      .mockResolvedValue(null);
    const api = fakeApi(teamRound(), { playerCard: vi.fn(async () => card()), setByes });
    sheet(api, swiss("owner", typed));

    fireEvent.click(await el("#sit-out-open"));
    fireEvent.click(await el("#sit-out-requested-half"));
    await screen.findByText(/Round 2 would be another/);

    fireEvent.click(document.querySelector("#sit-out-confirm")!);
    await waitFor(() => expect(setByes).toHaveBeenLastCalledWith(7, 5, [{ round: 2, kind: "requested-half" }], ["second_half_bye"]));
  });

  it("shows the server's sentence when it refuses, and changes nothing", async () => {
    const api = fakeApi(teamRound(), {
      playerCard: vi.fn(async () => card()),
      setByes: vi.fn(async () => {
        throw new ApiError(422, "round_paired", "That round is already paired. A paired round's byes are changed on the round itself.");
      }),
    });
    sheet(api, swiss());

    fireEvent.click(await el("#sit-out-open"));
    fireEvent.click(await el("#sit-out-absent"));
    await screen.findByText("That round is already paired. A paired round's byes are changed on the round itself.");
    expect(document.querySelector("#sit-out-state")).toBeNull();
  });

  it("without a signal says so and leaves the player as they were", async () => {
    const playerCard = vi.fn().mockResolvedValueOnce(card()).mockRejectedValue(new OfflineError());
    const api = fakeApi(teamRound(), { playerCard, setByes: vi.fn(async () => null) });
    sheet(api, swiss());

    fireEvent.click(await el("#sit-out-open"));
    fireEvent.click(await el("#sit-out-absent"));
    await screen.findByText(/No connection\. This needs the server/);
    expect(api.setByes).not.toHaveBeenCalled();
  });

  it("is not offered to an arbiter, for a withdrawn player, or when every round is paired", async () => {
    const api = fakeApi(teamRound(), { playerCard: vi.fn(async () => card()) });
    const first = sheet(api, swiss("arbiter"));
    await el("#player-card");
    expect(document.querySelector("#sit-out")).toBeNull();
    first.unmount();

    const gone = fakeApi(teamRound(), { playerCard: vi.fn(async () => card({ status: "withdrawn" })) });
    const second = sheet(gone, swiss());
    await el("#player-card");
    expect(document.querySelector("#sit-out")).toBeNull();
    second.unmount();

    sheet(api, { ...swiss(), paired_rounds: 5 });
    await el("#player-card");
    expect(document.querySelector("#sit-out")).toBeNull();
  });
});

describe("the byes editor and the server's question", () => {
  it("asks it, and saves with the answer, instead of showing a question nobody can answer", async () => {
    const setByes = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(409, "needs_acknowledgement", "Round 3 would be a second half-point bye. Confirm to give it anyway.", { error: "needs_acknowledgement", confirm: ["second_half_bye"] }))
      .mockResolvedValue(null);
    const api = fakeApi(teamRound(), { players: vi.fn(async () => [person({ id: 1, name: "Ann" })]), setByes });
    render(<PlayersScreen ctx={ctxWith(api)} t={swiss("owner", typed)} />);

    fireEvent.click(await el("#player-1"));
    fireEvent.change(await el("#bye-3"), { target: { value: "requested-half" } });
    fireEvent.click(document.querySelector("#save-byes")!);

    await screen.findByText(/Confirm to give it anyway/);
    expect(document.querySelector("#save-byes")).toBeNull();
    fireEvent.click(document.querySelector("#byes-confirm")!);

    await waitFor(() => expect(setByes).toHaveBeenLastCalledWith(7, 1, [{ round: 3, kind: "requested-half" }], ["second_half_bye"]));
    await screen.findByText("Byes saved.");
  });
});
