// @vitest-environment happy-dom
//
// A team event on the phone: the match in full (line-ups in both editor
// modes, findings, forfeits, a score, each only where the server's `can`
// allows), the teams and what the desk does to them mid-event, the team
// standings with the board prizes, the tab that holds them - and that every
// result is held, not tapped. Each against a fake API built on the contract's
// own examples.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { useState } from "preact/hooks";
import {
  ApiError,
  OfflineError,
  type Board,
  type BoardPrizes,
  type Client,
  type EventTeam,
  type LineupFindings,
  type MatchChange,
  type MatchDetail,
  type Player,
  type Round,
  type TeamDetail,
  type TeamStandings,
  type Tournament,
  type TournamentLine,
} from "../api";
import { examples } from "../contract.testkit";
import { holdTiming } from "../hold";
import { matchView } from "../matches";
import { Outbox, type KeyValue } from "../queue";
import type { SavedServer } from "../servers";
import type { Ctx } from "./App";
import { resetBack } from "../back";
import { fastHolds, hold, slowHolds } from "./holdTestkit";
import { MatchSheet } from "./MatchSheet";
import { RoundScreen } from "./RoundScreen";
import { TeamsScreen } from "./TeamsScreen";
import { TeamStandingsScreen } from "./TeamStandings";
import { TournamentView } from "./TournamentView";

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
  addedAt: "2026-11-19T00:00:00Z",
};

const ex = <T,>(name: string): T => structuredClone(examples[name]) as T;

// ---------------------------------------------------------------------------
// Fixtures: the contract's own examples, changed where a test needs it.

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

const seat = (id: number, name: string) => ({ id, name, title: null, rating: 2000, score: 0 });
const board = (id: number, white: string, black: string): Board => ({
  id,
  board: id,
  label: String(id),
  white: seat(id * 10 + 1, white),
  black: seat(id * 10 + 2, black),
  bye: false,
  vacant: false,
  empty: false,
  result: "",
  clearable: false,
  phone: null,
});

/** Match 1 of the contract's example: Alpha against Charlie on boards 1 and 2. */
const detail = (over: Partial<MatchDetail> = {}, can: Partial<MatchDetail["can"]> = {}): MatchDetail => {
  const base = ex<{ match: MatchDetail }>("match-response.json").match;
  return { ...base, ...over, can: { ...base.can, ...can } };
};

const round = (): Round => ({
  number: 1,
  latest: true,
  publish_level: 1,
  boards: [board(1, "Alpha 1", "Charlie 1"), board(2, "Charlie 2", "Alpha 2")],
  byes: [],
  pool: [],
  hand_edits: { open: false, pibe: null },
  results: ["1-0", "1/2-1/2", "0-1"],
  matches: [
    {
      id: 1,
      number: 1,
      team_a: { id: 1, name: "Alpha", short_name: null },
      team_b: { id: 3, name: "Charlie", short_name: null },
      bye: false,
      boards: [
        { id: 1, number: 1, a_white: true },
        { id: 2, number: 2, a_white: false },
      ],
      game_points: { a: 0, b: 0 },
      match_points: null,
      complete: false,
      decision: null,
      lineups: { a: false, b: true, confirmed: false },
    },
  ],
});

const change = (d: MatchDetail = detail()): MatchChange => ({ round: round(), match: d });

type FakeApi = { [K in keyof Client]: Mock };

function fakeApi(extra: Partial<FakeApi> = {}): FakeApi {
  const r = round();
  return {
    match: vi.fn(async () => detail()),
    setLineups: vi.fn(async () => change()),
    checkLineups: vi.fn(async () => null),
    resetLineups: vi.fn(async () => change()),
    unconfirmLineup: vi.fn(async () => change()),
    swapHome: vi.fn(async () => change()),
    decideMatch: vi.fn(async () => change()),
    withdrawDecision: vi.fn(async () => change()),
    setMatchScore: vi.fn(async () => change()),
    clearMatchScore: vi.fn(async () => change()),
    confirmLineup: vi.fn(async () => r),
    confirmLineups: vi.fn(async () => r),
    round: vi.fn(async () => r),
    sync: vi.fn(async () => {
      throw new OfflineError();
    }),
    team: vi.fn(async () => ({ others: [], heartbeat_seconds: 30 })),
    notes: vi.fn(async () => []),
    arrivals: vi.fn(async () => []),
    incidents: vi.fn(async () => []),
    teams: vi.fn(async () => ex<{ teams: EventTeam[] }>("teams-response.json").teams),
    teamDetail: vi.fn(async () => ex<TeamDetail>("team-detail-response.json")),
    withdrawTeam: vi.fn(async () => withdrawn()),
    reinstateTeam: vi.fn(async () => ex<TeamDetail>("team-detail-response.json")),
    setTeamRound: vi.fn(async () => ex<TeamDetail>("team-detail-response.json")),
    addTeamPlayer: vi.fn(async () => ex<TeamDetail>("team-detail-response.json")),
    removeTeamPlayer: vi.fn(async () => ex<TeamDetail>("team-detail-response.json")),
    players: vi.fn(async () => [player(12, "Echo 2"), player(20, "Reserve Rita"), player(21, "Spare Sam")]),
    teamStandings: vi.fn(async () => ex<{ standings: TeamStandings }>("team-standings-response.json").standings),
    boardPrizes: vi.fn(async () => ex<{ board_prizes: BoardPrizes }>("board-prizes-response.json").board_prizes),
    ...extra,
  } as never;
}

const player = (id: number, name: string): Player =>
  ({ id, name, title: null, rating: 1800, club: "Club", status: "active", absent: false, absent_rounds: [] }) as unknown as Player;

const withdrawn = (): TeamDetail => {
  const d = ex<TeamDetail>("team-detail-response.json");
  d.team.withdrawn_from_round = 2;
  return d;
};

let outbox: Outbox;
let counter = 0;

const ctxWith = (api: FakeApi): Ctx => ({ server, api: api as unknown as Client, outbox, bump: () => undefined });
const el = (selector: string) =>
  waitFor(() => {
    const found = document.querySelector(selector);
    if (!found) throw new Error(`${selector} not rendered`);
    return found;
  });
const click = async (selector: string) => fireEvent.click(await el(selector));
const text = (selector: string) => document.querySelector(selector)?.textContent ?? "";
const present = (selector: string) => document.querySelector(selector) !== null;
const change$ = async (selector: string, value: string) => {
  const input = (await el(selector)) as HTMLSelectElement | HTMLInputElement;
  input.value = value;
  fireEvent.change(input);
  fireEvent.input(input);
};

beforeEach(async () => {
  phone.storage.data.clear();
  phone.vault.data.clear();
  counter = 0;
  outbox = new Outbox(new Memory(), () => `cid-${++counter}`);
  await outbox.load();
  fastHolds();
});

afterEach(() => {
  cleanup();
  resetBack();
  slowHolds();
});

// ---------------------------------------------------------------------------

function Sheet(props: { api: FakeApi; t?: Tournament; canConfirm?: boolean; onRound?: (r: Round) => void }) {
  const r = round();
  const view = matchView(r)!;
  return (
    <MatchSheet
      ctx={ctxWith(props.api)}
      t={props.t ?? tournament()}
      round={r}
      card={view.cards[0]}
      layout="teams"
      canConfirm={props.canConfirm ?? true}
      onClose={() => undefined}
      onRound={props.onRound ?? (() => undefined)}
    />
  );
}

describe("a match in full", () => {
  it("shows the teams, the score, the boards and both line-ups with their confirmation", async () => {
    const api = fakeApi();
    render(<Sheet api={api} />);
    await el("#tm-score");
    expect(api.match).toHaveBeenCalledWith(7, 1, 1);
    expect(text("#tm-score")).toBe("0 – 0");
    expect(document.querySelectorAll("#tm-boards .row")).toHaveLength(2);
    expect(text("#tm-state-a")).toBe("provisional");
    expect(text("#tm-state-b")).toBe("confirmed");
    // Alpha's third player sits out: two seats, in board order.
    expect([...document.querySelectorAll("#tm-lineup-a .row-title")].map((n) => n.textContent)).toEqual(["Alpha 1", "Alpha 2"]);
  });

  it("offers only what the server's `can` allows", async () => {
    render(<Sheet api={fakeApi()} />);
    await el("#tm-actions");
    for (const id of ["tm-edit", "tm-reset", "tm-forfeit-a", "tm-forfeit-b", "tm-double"]) expect(present(`#${id}`), id).toBe(true);
    for (const id of ["tm-swap", "tm-withdraw", "tm-score-set", "tm-score-clear", "tm-unconfirm-b"]) expect(present(`#${id}`), id).toBe(false);
    // Alpha is not confirmed, so there is nothing to take back, whatever the server would allow.
    expect(present("#tm-unconfirm-a")).toBe(false);
  });

  it("shows an arbiter the match and none of the buttons", async () => {
    const none = { lineups: false, unconfirm_a: false, unconfirm_b: false, swap_home: false, decide: false, double_forfeit: false, withdraw_decision: false, score: false, clear_score: false };
    const api = fakeApi({ match: vi.fn(async () => detail({}, none)) });
    render(<Sheet api={api} t={tournament("arbiter")} canConfirm={false} />);
    await el("#tm-readonly");
    expect(present("#tm-actions")).toBe(false);
    expect(present("#tm-confirm-a")).toBe(false);
  });

  it("says what is wrong when the match cannot be read, and tries again", async () => {
    const api = fakeApi({ match: vi.fn().mockRejectedValueOnce(new OfflineError()).mockResolvedValue(detail()) });
    render(<Sheet api={api} />);
    await screen.findByText(/No connection/);
    await click("#tm-retry");
    await el("#tm-score");
  });

  it("confirms a side, and reads the match again", async () => {
    const api = fakeApi();
    render(<Sheet api={api} />);
    await click("#tm-confirm-a");
    await waitFor(() => expect(api.confirmLineup).toHaveBeenCalledWith(7, 1, 1, "a"));
    await waitFor(() => expect(api.match).toHaveBeenCalledTimes(2));
  });

  it("takes a confirmation back after asking", async () => {
    const api = fakeApi({ match: vi.fn(async () => detail({}, { unconfirm_b: true })) });
    render(<Sheet api={api} />);
    await click("#tm-unconfirm-b");
    expect(api.unconfirmLineup).not.toHaveBeenCalled();
    await click("#tm-ask-yes");
    await waitFor(() => expect(api.unconfirmLineup).toHaveBeenCalledWith(7, 1, 1, "b"));
  });

  it("resets the line-ups and swaps the home team, each after asking", async () => {
    const home = detail({ home: "a" }, { swap_home: true });
    const api = fakeApi({ match: vi.fn(async () => home), resetLineups: vi.fn(async () => change(home)) });
    render(<Sheet api={api} />);
    await click("#tm-reset");
    await click("#tm-ask-yes");
    await waitFor(() => expect(api.resetLineups).toHaveBeenCalledWith(7, 1, 1));
    await click("#tm-swap");
    await click("#tm-ask-yes");
    await waitFor(() => expect(api.swapHome).toHaveBeenCalledWith(7, 1, 1));
  });

  it("draws the round the server answers a change with, behind the sheet", async () => {
    const api = fakeApi();
    const onRound = vi.fn();
    render(<Sheet api={api} onRound={onRound} />);
    await click("#tm-reset");
    await click("#tm-ask-yes");
    await waitFor(() => expect(onRound).toHaveBeenCalledWith(expect.objectContaining({ number: 1 })));
  });

  it("says so when a change needs a signal and there is none, and leaves the question open", async () => {
    const api = fakeApi({ resetLineups: vi.fn().mockRejectedValue(new OfflineError()) });
    render(<Sheet api={api} />);
    await click("#tm-reset");
    await click("#tm-ask-yes");
    await screen.findByText(/No connection/);
    expect(present("#tm-ask")).toBe(true);
  });
});

describe("the line-up editor", () => {
  it("in ticks mode, ticks who sits out and sends it as such, previewing the boards", async () => {
    const api = fakeApi();
    render(<Sheet api={api} />);
    await click("#tm-edit");
    // Alpha 3 is already out; ticking Alpha 1 as well leaves Alpha 2 on board 1, and nobody for board 2.
    expect((document.querySelector("#out-a-3") as HTMLInputElement).checked).toBe(true);
    expect((document.querySelector("#tm-save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(await el("#out-a-1"));
    expect(text("#tm-edit-a")).toContain("board 1");
    await waitFor(() => expect((document.querySelector("#tm-save") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(document.querySelector("#tm-save")!);
    await waitFor(() => expect(api.setLineups).toHaveBeenCalled());
    const [, , , body] = api.setLineups.mock.calls[0] as [number, number, number, { out: { a: number[]; b: number[] } }];
    expect([...body.out.a].sort()).toEqual([1, 3]);
    expect(body.out.b).toEqual([]);
    await screen.findByText("Line-ups saved and confirmed.");
  });

  it("does not let an unavailable player be ticked", async () => {
    const d = detail();
    d.lineup!.roster_a[2].available = false;
    render(<Sheet api={fakeApi({ match: vi.fn(async () => d) })} />);
    await click("#tm-edit");
    expect((document.querySelector("#out-a-3") as HTMLInputElement).disabled).toBe(true);
    expect(text("#tm-edit-a")).toContain("not available");
  });

  it("in selects mode, picks a player per board and sends the seats", async () => {
    const d = detail();
    d.lineup!.mode = "selects";
    const api = fakeApi({ match: vi.fn(async () => d) });
    render(<Sheet api={api} />);
    await click("#tm-edit");
    // A player can sit on one board only: Alpha 2 is taken on board 2, so board 1 cannot choose it.
    const taken = document.querySelector('#seat-a-1 option[value="2"]') as HTMLOptionElement;
    expect(taken.disabled).toBe(true);
    await change$("#seat-a-1", "3");
    fireEvent.click(await el("#tm-save"));
    await waitFor(() => expect(api.setLineups).toHaveBeenCalledWith(7, 1, 1, { a: [3, 2], b: [7, 8] }));
  });

  it("can empty a seat in selects mode", async () => {
    const d = detail();
    d.lineup!.mode = "selects";
    const api = fakeApi({ match: vi.fn(async () => d) });
    render(<Sheet api={api} />);
    await click("#tm-edit");
    await change$("#seat-b-2", "");
    fireEvent.click(await el("#tm-save"));
    await waitFor(() => expect(api.setLineups).toHaveBeenCalledWith(7, 1, 1, { a: [1, 2], b: [7, null] }));
  });

  it("checks the line-ups against the regulations without saving, violations first", async () => {
    const findings: LineupFindings = [
      { severity: "warning", team: "b", board: 2, rule: "w", message: "Charlie 2 is rated above Charlie 1.", penalty: null },
      { severity: "violation", team: "a", board: 1, rule: "v", message: "Alpha 1 has played for another club.", penalty: "forfeit on board 1" },
    ];
    const api = fakeApi({ checkLineups: vi.fn(async () => findings) });
    render(<Sheet api={api} />);
    await click("#tm-edit");
    fireEvent.click(await el("#out-a-1"));
    await click("#tm-check");
    await el("#tm-findings");
    expect(api.checkLineups).toHaveBeenCalledWith(7, 1, 1, expect.objectContaining({ out: expect.anything() }));
    expect(api.setLineups).not.toHaveBeenCalled();
    const rows = [...document.querySelectorAll("#tm-findings .row-title")].map((n) => n.textContent);
    expect(rows).toEqual(["Alpha 1 has played for another club.", "Charlie 2 is rated above Charlie 1."]);
    expect(text("#tm-findings")).toContain("forfeit on board 1");
  });

  it("says so when no regulations check line-ups here, and when they find nothing", async () => {
    const api = fakeApi({ checkLineups: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce([]) });
    render(<Sheet api={api} />);
    await click("#tm-edit");
    await click("#tm-check");
    await el("#tm-check-none");
    await click("#tm-check");
    await el("#tm-findings-none");
    expect(present("#tm-check-none")).toBe(false);
  });

  it("shows the server's own refusal and keeps the editor open", async () => {
    const api = fakeApi({ setLineups: vi.fn().mockRejectedValue(new ApiError(422, "board_order", "The players are not in board order.")) });
    render(<Sheet api={api} />);
    await click("#tm-edit");
    fireEvent.click(await el("#out-a-1"));
    fireEvent.click(await el("#tm-save"));
    await screen.findByText("The players are not in board order.");
    expect(present("#tm-editor")).toBe(true);
  });
});

describe("deciding a match as a whole", () => {
  it("forfeits it only when the button is held, not tapped", async () => {
    const api = fakeApi();
    render(<Sheet api={api} />);
    await click("#tm-forfeit-a");
    // A tap says how it works and changes nothing.
    fireEvent.click(await el("#tm-ask-yes"));
    await screen.findByText("Hold for a second to lock the result");
    expect(api.decideMatch).not.toHaveBeenCalled();
    await hold(await el("#tm-ask-yes"));
    await waitFor(() => expect(api.decideMatch).toHaveBeenCalledWith(7, 1, 1, "forfeit_a", []));
  });

  it("forfeits to the other team, and records a double forfeit, the same way", async () => {
    const api = fakeApi();
    render(<Sheet api={api} />);
    await click("#tm-forfeit-b");
    await hold(await el("#tm-ask-yes"));
    await waitFor(() => expect(api.decideMatch).toHaveBeenLastCalledWith(7, 1, 1, "forfeit_b", []));
    await click("#tm-double");
    await hold(await el("#tm-ask-yes"));
    await waitFor(() => expect(api.decideMatch).toHaveBeenLastCalledWith(7, 1, 1, "double_forfeit", []));
  });

  it("asks the server's question, and goes ahead with its answer after another hold", async () => {
    const asked = new ApiError(409, "needs_acknowledgement", "A board of this match was already sent in a rating report. Confirm to change it anyway.", {
      confirm: ["finalised_result_changed"],
    });
    const api = fakeApi({ decideMatch: vi.fn().mockRejectedValueOnce(asked).mockResolvedValueOnce(change()) });
    render(<Sheet api={api} />);
    await click("#tm-forfeit-a");
    await hold(await el("#tm-ask-yes"));
    await el("#tm-question");
    expect(text("#tm-question")).toContain("already sent in a rating report");
    await hold(await el("#tm-question-yes"));
    await waitFor(() => expect(api.decideMatch).toHaveBeenLastCalledWith(7, 1, 1, "forfeit_a", ["finalised_result_changed"]));
    await waitFor(() => expect(present("#tm-question")).toBe(false));
  });

  it("withdraws a decision after asking", async () => {
    const api = fakeApi({ match: vi.fn(async () => detail({ decision: "forfeit_a" }, { withdraw_decision: true, decide: false, double_forfeit: false })) });
    render(<Sheet api={api} />);
    await el("#tm-notes");
    expect(text("#tm-notes")).toContain("Forfeited by decision to Alpha");
    await click("#tm-withdraw");
    await click("#tm-ask-yes");
    await waitFor(() => expect(api.withdrawDecision).toHaveBeenCalledWith(7, 1, 1));
  });
});

describe("a match decided by its score", () => {
  const scored = () => fakeApi({ match: vi.fn(async () => detail({}, { score: true })) });

  it("takes the score in halves that add up to the boards, and enters it only on a hold", async () => {
    const api = scored();
    render(<Sheet api={api} />);
    await click("#tm-score-set");
    await change$("#tm-score-a", "1.5");
    expect(text("#tm-score-b")).toContain("½");
    fireEvent.click(await el("#tm-ask-yes"));
    expect(api.setMatchScore).not.toHaveBeenCalled();
    await hold(await el("#tm-ask-yes"));
    await waitFor(() => expect(api.setMatchScore).toHaveBeenCalledWith(7, 1, 1, { a: 1.5, b: 0.5 }));
  });

  it("withdraws a score after asking, and says it was decided by score", async () => {
    const api = fakeApi({ match: vi.fn(async () => detail({ decision: "match_score", match_score: { a: 2, b: 0 } }, { clear_score: true, decide: false, double_forfeit: false })) });
    render(<Sheet api={api} />);
    await el("#tm-notes");
    expect(text("#tm-notes")).toContain("Decided by score: 2 – 0");
    await click("#tm-score-clear");
    await click("#tm-ask-yes");
    await waitFor(() => expect(api.clearMatchScore).toHaveBeenCalledWith(7, 1, 1));
  });
});

// ---------------------------------------------------------------------------

describe("hold to enter, on the round screen", () => {
  function Harness(props: { api: FakeApi; t: Tournament }) {
    const [, again] = useState(0);
    return <RoundScreen ctx={{ ...ctxWith(props.api), bump: () => again((x) => x + 1) }} t={props.t} reloadTournament={async () => undefined} />;
  }

  it("does not enter a result on a tap, says how it works, and enters it on a hold", async () => {
    render(<Harness api={fakeApi()} t={tournament()} />);
    fireEvent.click(await el("#board-1"));
    const button = await el("#result-1_0");
    fireEvent.click(button);
    await screen.findByText("Hold for a second to lock the result");
    expect(outbox.list(server.base, 7)).toHaveLength(0);
    await hold(button);
    await waitFor(() => expect(outbox.list(server.base, 7)).toHaveLength(1));
    expect(outbox.list(server.base, 7)[0].entry).toMatchObject({ kind: "result", pairing: 1, result: "1-0" });
  });

  it("is a real second unless a test says otherwise", () => {
    slowHolds();
    expect(holdTiming.ms).toBe(1000);
  });

  it("opens a match from its card, and the board it is on stays where it was", async () => {
    const api = fakeApi();
    render(<Harness api={api} t={tournament()} />);
    await click("#match-open-1");
    await el("#tm-score");
    expect(api.match).toHaveBeenCalledWith(7, 1, 1);
  });

  it("opens a match from a team's line-up sheet", async () => {
    const api = fakeApi();
    render(<Harness api={api} t={tournament()} />);
    await click("#lineup-1-a");
    await click("#lineup-open-match");
    await el("#tm-score");
  });
});

// ---------------------------------------------------------------------------

describe("pairing a team event from the phone", () => {
  const next = (blocker: string | null) => tournament("owner", { next_round: { number: 2, blocker, warnings: [] } });

  it("pairs a team Swiss like an individual one: nothing on the phone's side blocks it", async () => {
    const pair = vi.fn(async () => ({ ...round(), number: 2 }));
    render(<RoundScreen ctx={ctxWith(fakeApi({ pair }))} t={next(null)} reloadTournament={async () => undefined} />);
    fireEvent.click(await el("#desk-actions"));
    fireEvent.click(await el("#pair-next"));
    await waitFor(() => expect(pair).toHaveBeenCalledWith(7, []));
  });

  it("says a team round robin is paired at the desk, whole, when the server says so", async () => {
    render(<RoundScreen ctx={ctxWith(fakeApi())} t={next("desk_only")} reloadTournament={async () => undefined} />);
    fireEvent.click(await el("#desk-actions"));
    await screen.findByText(/team round robin is paired at the desk/);
    expect(present("#pair-next")).toBe(false);
  });
});

describe("the teams", () => {
  const show = (api: FakeApi, t: Tournament = tournament()) => render(<TeamsScreen ctx={ctxWith(api)} t={t} />);

  it("lists every team with its captain and its roster in board order", async () => {
    show(fakeApi());
    await el("#team-1");
    expect(document.querySelectorAll(".team-card")).toHaveLength(5);
    expect(text("#team-1")).toContain("captain Ann");
    expect([...document.querySelectorAll("#team-1 .roster-name")].map((n) => n.textContent)).toEqual(["Alpha 1", "Alpha 2", "Alpha 3"]);
  });

  it("marks a team that has left, and the rounds it sits out", async () => {
    const teams = ex<{ teams: EventTeam[] }>("teams-response.json").teams;
    teams[1].withdrawn_from_round = 2;
    teams[2].rounds = [{ round: 3, status: "absent" }, { round: 4, status: "half_bye" }];
    show(fakeApi({ teams: vi.fn(async () => teams) }));
    await el("#team-out-2");
    expect(text("#team-out-2")).toBe("out from round 2");
    expect(text("#team-rounds-3")).toBe("Absent in round 3 · Half-point bye in round 4");
  });

  it("finds a team by name once there are many", async () => {
    const teams = Array.from({ length: 9 }, (_, i) => ({ ...ex<{ teams: EventTeam[] }>("teams-response.json").teams[0], id: i + 1, name: `Team ${i + 1}` }));
    show(fakeApi({ teams: vi.fn(async () => teams) }));
    await el("#teams-filter");
    fireEvent.input(document.querySelector("#teams-filter")!, { target: { value: "team 7" } });
    await waitFor(() => expect(document.querySelectorAll(".team-card")).toHaveLength(1));
  });

  it("says why when the list cannot be read, and tries again", async () => {
    const api = fakeApi({ teams: vi.fn().mockRejectedValueOnce(new ApiError(409, "not_team_event", "This tournament has no teams.")).mockResolvedValue([]) });
    show(api);
    await screen.findByText("This tournament has no teams.");
    await click("#teams-retry");
    await screen.findByText("No teams yet.");
  });

  it("shows an arbiter a team and its matches, and none of the desk's buttons", async () => {
    show(fakeApi(), tournament("arbiter"));
    await click("#team-open-1");
    await el("#team-matches");
    expect(text("#team-matches")).toContain("Charlie");
    expect(present("#team-withdraw")).toBe(false);
    expect(present("#team-add")).toBe(false);
    expect(present("#team-remove-1")).toBe(false);
    expect(present("#team-read-only")).toBe(true);
  });

  it("sits a team out of a round to come, with the half-point bye where the event is a Swiss", async () => {
    const api = fakeApi();
    show(api);
    await click("#team-open-1");
    // One round is paired, five are played: rounds 2 to 5 can be set.
    await el("#team-round-2-absent");
    expect(document.querySelectorAll("#team-rounds .round-status")).toHaveLength(4);
    await click("#team-round-3-half_bye");
    await waitFor(() => expect(api.setTeamRound).toHaveBeenCalledWith(7, 1, 3, "half_bye"));
  });

  it("offers no half-point bye in a round robin", async () => {
    show(fakeApi(), tournament("owner", { pairing_system: "round_robin" }));
    await click("#team-open-1");
    await el("#team-round-2-absent");
    expect(present("#team-round-2-half_bye")).toBe(false);
  });

  it("shows the rounds a team already sits out", async () => {
    const d = ex<TeamDetail>("team-detail-response.json");
    d.team.rounds = [{ round: 3, status: "absent" }];
    show(fakeApi({ teamDetail: vi.fn(async () => d) }));
    await click("#team-open-1");
    await el("#team-round-3-absent");
    expect(document.querySelector("#team-round-3-absent")!.className).toContain("active");
    expect(document.querySelector("#team-round-2-plays")!.className).toContain("active");
  });

  it("withdraws a team from a round, after asking, and only on a hold", async () => {
    const api = fakeApi();
    show(api);
    await click("#team-open-1");
    await click("#team-withdraw");
    await change$("#team-withdraw-round", "1");
    fireEvent.click(await el("#team-withdraw-yes"));
    await screen.findByText("Hold for a second to lock the result");
    expect(api.withdrawTeam).not.toHaveBeenCalled();
    await hold(await el("#team-withdraw-yes"));
    await waitFor(() => expect(api.withdrawTeam).toHaveBeenCalledWith(7, 1, 1, []));
    // The sheet now shows the team as out, and the list behind it as well.
    await screen.findByText("Alpha is out from round 1.");
    await waitFor(() => expect(present("#team-out-1")).toBe(true));
  });

  it("asks the server's question about a match already sent, and answers it", async () => {
    const asked = new ApiError(409, "needs_acknowledgement", "A match of this team was already sent in a rating report. Confirm to forfeit it anyway.", {
      confirm: ["finalised_result_changed"],
    });
    const api = fakeApi({ withdrawTeam: vi.fn().mockRejectedValueOnce(asked).mockResolvedValueOnce(withdrawn()) });
    show(api);
    await click("#team-open-1");
    await click("#team-withdraw");
    await hold(await el("#team-withdraw-yes"));
    await el("#team-question");
    await hold(await el("#team-question-yes"));
    await waitFor(() => expect(api.withdrawTeam).toHaveBeenLastCalledWith(7, 1, 2, ["finalised_result_changed"]));
  });

  it("brings a withdrawn team back", async () => {
    const api = fakeApi({ teamDetail: vi.fn(async () => withdrawn()) });
    show(api);
    await click("#team-open-1");
    await click("#team-reinstate");
    await click("#team-ask-yes");
    await waitFor(() => expect(api.reinstateTeam).toHaveBeenCalledWith(7, 1));
  });

  it("takes a player off the roster after asking", async () => {
    const api = fakeApi();
    show(api);
    await click("#team-open-1");
    await click("#team-remove-3");
    expect(api.removeTeamPlayer).not.toHaveBeenCalled();
    await click("#team-ask-yes");
    await waitFor(() => expect(api.removeTeamPlayer).toHaveBeenCalledWith(7, 1, 3));
  });

  it("puts a late reserve from the tournament's players on the roster, found by name", async () => {
    const api = fakeApi();
    show(api);
    await click("#team-open-1");
    await click("#team-add");
    await el("#team-reserve-20");
    expect(api.players).toHaveBeenCalledWith(7);
    fireEvent.input(document.querySelector("#team-reserve-search")!, { target: { value: "sam" } });
    await waitFor(() => expect(document.querySelectorAll("#team-reserve-list .row")).toHaveLength(1));
    await click("#team-reserve-21");
    await waitFor(() => expect(api.addTeamPlayer).toHaveBeenCalledWith(7, 1, 21));
  });

  it("does not offer a player already on the team", async () => {
    const teams = ex<{ teams: EventTeam[] }>("teams-response.json").teams;
    const api = fakeApi({ teams: vi.fn(async () => teams), teamDetail: vi.fn(async () => ({ team: teams[4], matches: [] })), players: vi.fn(async () => [player(12, "Echo 2"), player(20, "Reserve Rita")]) });
    show(api);
    await click("#team-open-5");
    await click("#team-add");
    await el("#team-reserve-20");
    expect(present("#team-reserve-12")).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("the team standings and the board prizes", () => {
  const show = (api: FakeApi) => render(<TeamStandingsScreen ctx={ctxWith(api)} t={tournament("owner", { paired_rounds: 3 })} />);

  it("ranks the teams on the primary score, with games, results and the event's tie-breaks", async () => {
    show(fakeApi());
    await el("#team-table");
    const rows = [...document.querySelectorAll("#team-table tbody tr")];
    expect(rows.map((r) => r.querySelector("td.player")!.textContent)).toEqual(["Alpha", "Delta", "Echo", "Bravo", "Charlie"]);
    const head = [...document.querySelectorAll("#team-table thead th")].map((th) => th.textContent);
    // MP and GP are columns of their own; the tie-breaks add Buchholz.
    expect(head).toEqual(["#", "Team", "MP", "GP", "P", "W", "D", "L", "BH"]);
    expect([...rows[0].querySelectorAll("td")].map((td) => td.textContent).slice(2, 8)).toEqual(["2", "2", "1", "1", "0", "0"]);
  });

  it("lists the individual ranking", async () => {
    show(fakeApi());
    await click("#tstand-players");
    await el("#team-players");
    expect(document.querySelectorAll("#team-players tbody tr")).toHaveLength(8);
    expect(text("#team-players tbody tr")).toContain("Alpha 1");
    expect(text("#team-players tbody tr")).toContain("100%");
  });

  it("says when nobody has played yet", async () => {
    const empty = { ...ex<{ standings: TeamStandings }>("team-standings-response.json").standings, rows: [], players: [] };
    show(fakeApi({ teamStandings: vi.fn(async () => empty) }));
    await screen.findByText("No team has played yet.");
    await click("#tstand-players");
    await screen.findByText("Nobody has played a game yet.");
  });

  it("shows the board prizes per board, from the desk's default minimum, and moves the minimum", async () => {
    const api = fakeApi();
    show(api);
    await click("#tstand-boards");
    await el("#board-prize-1");
    expect(api.boardPrizes).toHaveBeenCalledWith(7, undefined);
    expect(text("#min-games-value")).toBe("1");
    expect(document.querySelectorAll("#board-prize-1 .row")).toHaveLength(4);
    await click("#min-games-up");
    await waitFor(() => expect(api.boardPrizes).toHaveBeenLastCalledWith(7, 2));
    await waitFor(() => expect(present("#min-games-default")).toBe(false));
  });

  it("offers the way back to the default once the minimum is changed", async () => {
    const api = fakeApi({
      boardPrizes: vi.fn(async (_id: number, min?: number) => ({ ...ex<{ board_prizes: BoardPrizes }>("board-prizes-response.json").board_prizes, min_games: min ?? 1 })),
    });
    show(api);
    await click("#tstand-boards");
    await click("#min-games-up");
    await click("#min-games-default");
    await waitFor(() => expect(api.boardPrizes).toHaveBeenLastCalledWith(7, 1));
  });
});

// ---------------------------------------------------------------------------

describe("the tabs of a team event", () => {
  const line: TournamentLine = { id: 7, name: "Hall Cup", role: "owner", status: "running", start_date: null, end_date: null, city: null, rounds_count: 5, paired_rounds: 1 };
  const open = (t: Tournament) => {
    const api = fakeApi({ tournament: vi.fn(async () => t) });
    render(<TournamentView ctx={ctxWith(api)} line={line} onBack={() => undefined} />);
    return api;
  };

  it("has a Teams tab, and team standings behind Standings, for a team event", async () => {
    const api = open(tournament());
    await click("#tab-teams");
    await el("#teams");
    expect(api.teams).toHaveBeenCalled();
    await click("#tab-standings");
    await el("#team-standings");
    expect(api.teamStandings).toHaveBeenCalled();
  });

  it("has neither for an individual event", async () => {
    const api = open(tournament("owner", { team: false }));
    await el("#tab-round");
    expect(present("#tab-teams")).toBe(false);
    await click("#tab-standings");
    await waitFor(() => expect(present("#team-standings")).toBe(false));
    expect(api.teamStandings).not.toHaveBeenCalled();
  });

  it("gives an arbiter the Teams tab and not the standings", async () => {
    open(tournament("arbiter"));
    await el("#tab-teams");
    expect(present("#tab-standings")).toBe(false);
  });
});
