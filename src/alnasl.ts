// What a hall board (Alnasl) says about its game. It is shown beside the
// pairing for the arbiter to compare, and that is all: a board never enters
// a result, and nothing here is ever sent anywhere.

import type { BoardReport } from "./api";
import { shareResult } from "./share";

/**
 * The small line beside a pairing: the board's result, or how far the game
 * is. Null when there is nothing to say. `moves_count` arrives in full moves
 * (the server has already done the halving), so it is shown as it comes.
 */
export function boardReportLabel(report: BoardReport | null | undefined): string | null {
  if (!report) return null;
  if (report.result) return `board ${shareResult(report.result)}`;
  switch (report.status) {
    case "waiting":
      return report.moves_count ? playing(report.moves_count) : "board waiting";
    case "live":
      return playing(report.moves_count ?? 0);
    case "finished":
      // Over, with no result the board could read: a flag, a resignation by
      // handshake. The arbiter's sheet will know.
      return "board finished";
    default:
      return null;
  }
}

function playing(n: number): string {
  return `playing · ${n} ${n === 1 ? "move" : "moves"}`;
}
