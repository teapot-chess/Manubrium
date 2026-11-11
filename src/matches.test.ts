import { describe, expect, it } from "vitest";
import type { Board, Capability, Match, Round } from "./api";
import { canSitOut, nextRound } from "./byes";
import { boardPoints, layoutOf, lineup, matchScore, matchView, mirrorResult, points, pointValues, resultBetween, seats, unconfirmed } from "./matches";
import { pairingsText } from "./share";

const player = (id: number, name: string) => ({ id, name, title: null, rating: 2000, score: 0 });

const board = (id: number, white: string, black: string, result = ""): Board => ({
  id,
  board: id,
  label: String(id),
  white: player(id * 10 + 1, white),
  black: player(id * 10 + 2, black),
  bye: false,
  result,
  clearable: false,
});

const match = (id: number, boards: number[], extra: Partial<Match> = {}): Match => ({
  id,
  number: id,
  team_a: { id: id * 2 - 1, name: `Home ${id}`, short_name: null },
  team_b: { id: id * 2, name: `Away ${id}`, short_name: null },
  bye: false,
  boards: boards.map((b, i) => ({ id: b, number: i + 1, a_white: i % 2 === 0 })),
  game_points: { a: 0, b: 0 },
  match_points: null,
  complete: false,
  decision: null,
  lineups: { a: true, b: true, confirmed: true },
  ...extra,
});

const round = (boards: Board[], matches?: Match[]): Round => ({
  number: 1,
  latest: true,
  publish_level: 1,
  boards,
  byes: [],
  results: ["1-0", "1/2-1/2", "0-1"],
  ...(matches ? { matches } : {}),
});

// Board 1: Home has White. Board 2: Home has Black.
const boards = [board(1, "Home A", "Away A"), board(2, "Away B", "Home B"), board(3, "Stray W", "Stray B")];
const standard = { win: 1, draw: 0.5, loss: 0 };

describe("a round as matches", () => {
  it("is not one without matches: an individual event, or a server from before it knew", () => {
    expect(matchView(round(boards))).toBeNull();
    expect(matchView(round(boards, []))).toBeNull();
  });

  it("groups the boards by match, leaves a board no match names loose, and skips one the round does not have", () => {
    const view = matchView(round(boards, [match(1, [1, 2, 99])]))!;
    expect(view.cards[0].rows.map((r) => [r.board.id, r.number, r.aWhite])).toEqual([
      [1, 1, true],
      [2, 2, false],
    ]);
    expect(view.loose.map((b) => b.id)).toEqual([3]);
  });

  it("gives a board to the first match that names it, never to two", () => {
    const view = matchView(round(boards, [match(1, [1, 2]), match(2, [2, 3])]))!;
    expect(view.cards[1].rows.map((r) => r.board.id)).toEqual([3]);
  });

  it("lists the matches whose line-ups still wait, a bye never among them", () => {
    const view = matchView(
      round(boards, [
        match(1, [1], { lineups: { a: true, b: false, confirmed: false } }),
        match(2, [2]),
        match(3, [], { bye: true, team_b: null, lineups: { a: false, b: false, confirmed: false } }),
      ]),
    )!;
    expect(unconfirmed(view).map((c) => c.match.id)).toEqual([1]);
  });
});

describe("the layout of a match's boards", () => {
  const view = matchView(round(boards, [match(1, [1, 2])]))!;
  const [first, second] = view.cards[0].rows;

  it("is each team on its own side unless the tournament says White on the left", () => {
    expect(layoutOf({})).toBe("teams");
    expect(layoutOf({ team_board_layout: "teams" })).toBe("teams");
    expect(layoutOf({ team_board_layout: "white_left" })).toBe("white_left");
    expect(layoutOf({ team_board_layout: "sideways" as never })).toBe("teams");
  });

  it("teams: the first-named team on the left on every board, its colour alternating", () => {
    expect(seats(first, "teams")).toMatchObject({ left: { team: "a", colour: "w", player: { name: "Home A" } }, right: { team: "b", colour: "b", player: { name: "Away A" } } });
    expect(seats(second, "teams")).toMatchObject({ left: { team: "a", colour: "b", player: { name: "Home B" } }, right: { team: "b", colour: "w", player: { name: "Away B" } } });
  });

  it("white_left: White on the left on every board, the teams alternating", () => {
    expect(seats(first, "white_left")).toMatchObject({ left: { team: "a", colour: "w" }, right: { team: "b", colour: "b" } });
    expect(seats(second, "white_left")).toMatchObject({ left: { team: "b", colour: "w", player: { name: "Away B" } }, right: { team: "a", colour: "b", player: { name: "Home B" } } });
  });

  it("reads a team's line-up off its boards, board 1 first, with the colour on each", () => {
    expect(lineup(view.cards[0], "a").map((s) => [s.number, s.colour, s.player?.name])).toEqual([
      [1, "w", "Home A"],
      [2, "b", "Home B"],
    ]);
    expect(lineup(view.cards[0], "b").map((s) => [s.number, s.colour, s.player?.name])).toEqual([
      [1, "b", "Away A"],
      [2, "w", "Away B"],
    ]);
  });
});

describe("a result between two seats", () => {
  it("is mirrored when the left seat is Black, forfeits and all", () => {
    expect(mirrorResult("1-0")).toBe("0-1");
    expect(mirrorResult("0-1")).toBe("1-0");
    expect(mirrorResult("1/2-1/2")).toBe("1/2-1/2");
    expect(mirrorResult("1-0FF")).toBe("0-1FF");
    expect(mirrorResult("0-0FF")).toBe("0-0FF");
    expect(mirrorResult("1/2-0")).toBe("0-1/2");
    expect(mirrorResult("1-0U")).toBe("0-1U");
    expect(mirrorResult("+--")).toBe("--+");
  });

  it("leaves alone what is not two scores", () => {
    for (const code of ["", "*", "*W", "bye", "adjourned"]) expect(mirrorResult(code)).toBe(code);
  });

  it("reads as entered with White on the left, mirrored with Black there", () => {
    expect(resultBetween("1-0", true)).toBe("1-0");
    expect(resultBetween("1-0", false)).toBe("0-1");
  });
});

describe("the score of a match", () => {
  it("is the server's own while nothing waits on the phone", () => {
    const card = matchView(round(boards, [match(1, [1, 2], { game_points: { a: 1.5, b: 0.5 }, match_points: { a: 2, b: 0 }, complete: true })]))!.cards[0];
    expect(matchScore(card, new Map(), standard)).toEqual({ a: 1.5, b: 0.5, matchPoints: { a: 2, b: 0 }, waiting: 0 });
  });

  it("counts a waiting result for the team whose player it is, and holds the match points back", () => {
    const card = matchView(round(boards, [match(1, [1, 2])]))!.cards[0];
    // White wins on board 2, where the first-named team has Black.
    expect(matchScore(card, new Map([[2, "1-0"]]), standard)).toEqual({ a: 0, b: 1, matchPoints: null, waiting: 1 });
    expect(
      matchScore(
        card,
        new Map([
          [1, "1-0"],
          [2, "1/2-1/2"],
        ]),
        standard,
      ),
    ).toMatchObject({ a: 1.5, b: 0.5, waiting: 2 });
  });

  it("replaces what the board held, when the waiting result changes one", () => {
    const played = [board(1, "Home A", "Away A", "1-0"), board(2, "Away B", "Home B", "1-0")];
    const card = matchView(round(played, [match(1, [1, 2], { game_points: { a: 1, b: 1 }, match_points: { a: 1, b: 1 }, complete: true })]))!.cards[0];
    expect(matchScore(card, new Map([[2, "0-1"]]), standard)).toEqual({ a: 2, b: 0, matchPoints: null, waiting: 1 });
    // The same result again is no change at all.
    expect(matchScore(card, new Map([[2, "1-0"]]), standard)).toMatchObject({ a: 1, b: 1, waiting: 0, matchPoints: { a: 1, b: 1 } });
  });

  it("values a game as the tournament does, and a postponed one as the draw it stands for", () => {
    expect(pointValues({ settings: {} })).toEqual(standard);
    expect(pointValues({ settings: { points: { win: 3, draw: 1, loss: 0 } } })).toEqual({ win: 3, draw: 1, loss: 0 });
    expect(pointValues({ settings: { points: { win: null, draw: "x" } } })).toEqual(standard);
    expect(boardPoints("1-0FF", standard)).toEqual({ white: 1, black: 0 });
    expect(boardPoints("0-0FF", standard)).toEqual({ white: 0, black: 0 });
    expect(boardPoints("*W", standard)).toEqual({ white: 0.5, black: 0.5 });
    expect(boardPoints("", standard)).toEqual({ white: 0, black: 0 });
  });

  it("is written as a scoresheet writes it", () => {
    expect([0, 0.5, 1, 1.5, 2, 3.5].map(points)).toEqual(["0", "½", "1", "1½", "2", "3½"]);
  });
});

describe("sharing a team round", () => {
  it("lists the boards match by match, under the teams and their score", () => {
    const played = [board(1, "Home A", "Away A", "1-0"), board(2, "Away B", "Home B"), board(3, "Stray W", "Stray B")];
    const text = pairingsText(
      { name: "Hall Cup", openresults_url: null },
      round(played, [match(1, [1, 2], { game_points: { a: 1, b: 0 } }), match(2, [], { bye: true, team_b: null })]),
    );
    expect(text).toContain("Match 1: Home 1 1–0 Away 1");
    expect(text).toContain("Match 2: Home 2, bye");
    expect(text).toContain("Boards in no match");
    expect(text.indexOf("Home A")).toBeGreaterThan(text.indexOf("Match 1"));
    expect(text.indexOf("Stray W")).toBeGreaterThan(text.indexOf("Boards in no match"));
  });
});

describe("the next round, and who may be left out of it", () => {
  type T = Parameters<typeof canSitOut>[0];
  const desk: Capability[] = ["results", "incidents", "pair", "publish", "players", "standings", "settings"];
  const t = (extra: Partial<T> = {}): T => ({ can: desk, read_only: false, bye_kinds: [{ id: "absent", label: "Absent" }], paired_rounds: 2, rounds_count: 5, ...extra });
  const active = { status: "active" as const, byes: [] };

  it("is the round after the last paired one, and none when every round is paired", () => {
    expect(nextRound({ paired_rounds: 2, rounds_count: 5 })).toBe(3);
    expect(nextRound({ paired_rounds: 0, rounds_count: 5 })).toBe(1);
    expect(nextRound({ paired_rounds: 5, rounds_count: 5 })).toBeNull();
    expect(nextRound({ paired_rounds: 2, rounds_count: null })).toBeNull();
  });

  it("is offered to whoever changes players, for a player still in the event, on a server that names its byes", () => {
    expect(canSitOut(t(), active)).toBe(true);
    expect(canSitOut(t({ can: ["results", "incidents"] }), active)).toBe(false);
    expect(canSitOut(t({ read_only: true }), active)).toBe(false);
    expect(canSitOut(t({ bye_kinds: [] }), active)).toBe(false);
    expect(canSitOut(t({ bye_kinds: undefined }), active)).toBe(false);
    expect(canSitOut(t(), { status: "withdrawn", byes: [] })).toBe(false);
    expect(canSitOut(t(), { status: "active" })).toBe(false);
    expect(canSitOut(t({ paired_rounds: 5 }), active)).toBe(false);
  });
});
