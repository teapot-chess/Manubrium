// The round and the standings as plain text, for a chat group or a mail.
// Plain text because that is what survives every app it gets pasted into;
// padded columns because some of them use a monospaced font, and the rest
// are no worse off for it.

import type { Board, Round, Standings, Tournament } from "./api";
import { t as tr } from "./i18n";
import { byeLabel } from "./byes";

/** "1/2-1/2" is how the server spells it; a message can afford the glyph. */
export function shareResult(code: string): string {
  return code.replace(/1\/2/g, "½");
}

/** Points and tie-breaks: whole numbers as they are, the rest to two places at most. */
export function formatNumber(v: unknown): string {
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, "");
  return v == null ? "" : String(v);
}

const named = (p: { name: string; title: string | null } | null) => (p ? (p.title ? `${p.title} ${p.name}` : p.name) : "–");

function pad(s: string, width: number, right = false): string {
  const gap = " ".repeat(Math.max(0, width - [...s].length));
  return right ? gap + s : s + gap;
}

function footer(t: Pick<Tournament, "openresults_url">): string[] {
  return t.openresults_url ? ["", t.openresults_url] : [];
}

function boardResult(b: Board): string {
  if (b.bye) return tr("round.bye");
  return b.result ? shareResult(b.result) : "–";
}

/** The round's pairings: board, white, result, black; then who is not playing. */
export function pairingsText(t: Pick<Tournament, "name" | "openresults_url">, round: Round): string {
  const rows = round.boards.map((b) => ({
    no: b.label || String(b.board),
    white: named(b.white),
    result: boardResult(b),
    black: b.bye ? "" : named(b.black),
  }));
  const noW = Math.max(2, ...rows.map((r) => r.no.length));
  const whiteW = Math.max(5, ...rows.map((r) => [...r.white].length));
  const resW = Math.max(3, ...rows.map((r) => [...r.result].length));

  const lines = [`${t.name}`, tr("more.round", { round: round.number }), ""];
  if (rows.length === 0) lines.push(tr("round.no_boards"));
  else {
    lines.push(`${pad(tr("share.bd"), noW, true)}  ${pad(tr("share.white"), whiteW)}  ${pad(tr("share.res"), resW)}  ${tr("share.black")}`);
    for (const r of rows) lines.push(`${pad(r.no, noW, true)}  ${pad(r.white, whiteW)}  ${pad(r.result, resW)}  ${r.black}`.trimEnd());
  }
  if (round.byes.length > 0) {
    lines.push("", tr("round.not_playing", { list: round.byes.map((b) => `${b.player.name} (${byeLabel(b.type)})`).join(", ") }));
  }
  return [...lines, ...footer(t)].join("\n");
}

/** The standings: place, name, points and every tie-break, in the server's order. */
export function standingsText(t: Pick<Tournament, "name" | "openresults_url">, s: Standings): string {
  const rows = s.rows.map((r) => [
    r.rank == null ? "" : String(r.rank),
    named(r.player),
    formatNumber(r.points),
    ...s.tiebreaks.map((tb) => formatNumber(r.tiebreaks[tb.code])),
  ]);
  const head = ["#", tr("share.name"), tr("standings.pts"), ...s.tiebreaks.map((tb) => tb.code)];
  const widths = head.map((h, i) => Math.max([...h].length, ...rows.map((r) => [...r[i]].length)));
  // Place and the numbers line up on the right, the name on the left.
  const line = (cells: string[]) => cells.map((c, i) => pad(c, widths[i], i !== 1)).join("  ").trimEnd();

  const lines = [`${t.name}`, tr("tabs.standings"), ""];
  if (rows.length === 0) lines.push(tr("standings.none"));
  else lines.push(line(head), ...rows.map(line));
  if (s.tiebreaks.length > 0) lines.push("", s.tiebreaks.map((tb) => `${tb.code}: ${tb.name}`).join("; "));
  return [...lines, ...footer(t)].join("\n");
}

export type ShareOutcome = "shared" | "copied" | "cancelled" | "failed";

/** The browser half of `shareText`, separate so it can be tested without Capacitor. */
export async function webShare(
  title: string,
  text: string,
  nav: Pick<Navigator, "share" | "clipboard"> | undefined = typeof navigator === "undefined" ? undefined : navigator,
): Promise<ShareOutcome> {
  if (nav?.share) {
    try {
      await nav.share({ title, text });
      return "shared";
    } catch (e) {
      if ((e as { name?: string } | null)?.name === "AbortError") return "cancelled";
      // Not allowed here (no user gesture, an insecure page): fall through to the clipboard.
    }
  }
  return copyText(text, nav);
}

/** Puts text on the clipboard: "copied", or "failed" when the browser will not. */
export async function copyText(
  text: string,
  nav: Pick<Navigator, "clipboard"> | undefined = typeof navigator === "undefined" ? undefined : navigator,
): Promise<"copied" | "failed"> {
  try {
    if (!nav?.clipboard) return "failed";
    await nav.clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}
