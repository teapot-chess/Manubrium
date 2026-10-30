import { describe, expect, it, vi } from "vitest";
import type { Board, BoardReport, Round, Standings } from "./api";
import { boardReportLabel } from "./alnasl";
import { copyText, pairingsText, standingsText, webShare } from "./share";

const p = (id: number, name: string, title: string | null = null) => ({ id, name, title, rating: 2000, score: 0 });

function board(n: number, extra: Partial<Board> = {}): Board {
  return {
    id: n,
    board: n,
    label: String(n),
    white: p(n * 10 + 1, `White ${n}`),
    black: p(n * 10 + 2, `Black ${n}`),
    bye: false,
    result: "",
    clearable: false,
    ...extra,
  };
}

function round(boards: Board[], extra: Partial<Round> = {}): Round {
  return { number: 3, latest: true, publish_level: 1, boards, byes: [], results: [], ...extra };
}

describe("the pairings as text", () => {
  it("lists board, white, result, black in columns, with the link when there is one", () => {
    const text = pairingsText(
      { name: "Hall Open", openresults_url: "https://openresults.cloud/t/hall-open" },
      round(
        [
          board(1, { white: p(11, "Carlsen, Magnus", "GM"), result: "1/2-1/2" }),
          board(2, { result: "1-0" }),
          board(3),
          board(4, { black: null, bye: true, result: "1-0" }),
        ],
        { byes: [{ player: p(9, "Late, Larry"), type: "requested-half" }] },
      ),
    );

    expect(text).toBe(
      [
        "Hall Open",
        "Round 3",
        "",
        "Bd  White               Res  Black",
        " 1  GM Carlsen, Magnus  ½-½  Black 1",
        " 2  White 2             1-0  Black 2",
        " 3  White 3             –    Black 3",
        " 4  White 4             bye",
        "",
        "Not playing: Late, Larry (Half-point bye)",
        "",
        "https://openresults.cloud/t/hall-open",
      ].join("\n"),
    );
  });

  it("leaves the link out when the tournament is not on OpenResults", () => {
    const text = pairingsText({ name: "Club night", openresults_url: null }, round([board(1)]));
    expect(text).not.toContain("http");
    expect(text.split("\n").at(-1)).toBe(" 1  White 1  –    Black 1");
  });

  it("says so when the round has no boards", () => {
    expect(pairingsText({ name: "X" }, round([]))).toContain("No boards in this round.");
  });
});

describe("the standings as text", () => {
  const s: Standings = {
    tiebreaks: [
      { code: "BH-C1", name: "Buchholz Cut 1" },
      { code: "SB", name: "Sonneborn-Berger" },
    ],
    rows: [
      { rank: 1, player: { id: 1, name: "Carlsen, Magnus", title: "GM", rating: 2830 }, points: 4.5, tiebreaks: { "BH-C1": 12.5, SB: 11.25 } },
      { rank: "2-3", player: { id: 2, name: "Short, Nigel", title: null, rating: 2600 }, points: 4, tiebreaks: { "BH-C1": 10, SB: 9 } },
      { rank: null, player: { id: 3, name: "Doe, J", title: null, rating: null }, points: 4, tiebreaks: {} },
    ],
  };

  it("lines up place, name, points and the tie-breaks, then names the tie-breaks", () => {
    expect(standingsText({ name: "Hall Open", openresults_url: "https://openresults.cloud/t/1" }, s)).toBe(
      [
        "Hall Open",
        "Standings",
        "",
        "  #  Name                Pts  BH-C1     SB",
        "  1  GM Carlsen, Magnus  4.5   12.5  11.25",
        "2-3  Short, Nigel          4     10      9",
        "     Doe, J                4",
        "",
        "BH-C1: Buchholz Cut 1; SB: Sonneborn-Berger",
        "",
        "https://openresults.cloud/t/1",
      ].join("\n"),
    );
  });

  it("says so when nobody is in it yet", () => {
    expect(standingsText({ name: "X" }, { tiebreaks: [], rows: [] })).toBe("X\nStandings\n\nNo players yet.");
  });
});

describe("sharing in a browser", () => {
  it("uses the Web Share API where there is one", async () => {
    const share = vi.fn(async () => undefined);
    expect(await webShare("T", "text", { share, clipboard: undefined as never })).toBe("shared");
    expect(share).toHaveBeenCalledWith({ title: "T", text: "text" });
  });

  it("calls a closed share sheet cancelled, not a failure", async () => {
    const share = vi.fn(async () => {
      throw Object.assign(new Error("closed"), { name: "AbortError" });
    });
    expect(await webShare("T", "text", { share, clipboard: undefined as never })).toBe("cancelled");
  });

  it("falls back to the clipboard, and says when even that will not do", async () => {
    const writeText = vi.fn(async () => undefined);
    expect(await webShare("T", "text", { share: undefined as never, clipboard: { writeText } as never })).toBe("copied");
    expect(writeText).toHaveBeenCalledWith("text");

    const refused = vi.fn(async () => {
      throw new Error("not allowed");
    });
    expect(await copyText("x", { clipboard: { writeText: refused } as never })).toBe("failed");
    expect(await copyText("x", undefined)).toBe("failed");
  });
});

describe("a hall board's report", () => {
  const r: BoardReport = { status: "live", result: null, mismatch: false, moves_count: 23, updated_at: "2026-11-07T14:32:05Z" };

  it("says the board's result, or how far the game is", () => {
    expect(boardReportLabel({ ...r, status: "finished", result: "1/2-1/2" })).toBe("board ½-½");
    expect(boardReportLabel(r)).toBe("playing · 23 moves");
    expect(boardReportLabel({ ...r, moves_count: 1 })).toBe("playing · 1 move");
    expect(boardReportLabel({ ...r, status: "waiting", moves_count: 0 })).toBe("board waiting");
    expect(boardReportLabel({ ...r, status: "finished" })).toBe("board finished");
  });

  it("says nothing without a report", () => {
    expect(boardReportLabel(null)).toBeNull();
    expect(boardReportLabel(undefined)).toBeNull();
  });
});
