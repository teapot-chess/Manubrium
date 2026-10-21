// What a hall board (Alnasl) says about its game. It is shown beside the
// pairing for the arbiter to compare, and that is all: a board never enters
// a result, and nothing here is ever sent anywhere.

import type { BoardReport } from "./api";
import { shareResult } from "./share";

/** The small line beside a pairing: the board's result, or how far the game is. Null when there is nothing to say. */
export function boardReportLabel(report: BoardReport | null | undefined): string | null {
  if (!report) return null;
  if (report.result) return `board ${shareResult(report.result)}`;
  if (report.status === "playing" || report.moves_count) {
    const n = report.moves_count ?? 0;
    return `playing · ${n} ${n === 1 ? "move" : "moves"}`;
  }
  return report.status ? report.status.replace(/_/g, " ") : null;
}
