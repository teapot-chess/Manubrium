// Finding a player on the FIDE or a national list: when a query is worth
// sending, what a hit becomes when tapped, and what the row says about it.

import type { PlayerSource, SearchHit } from "./api";

/** Fewer letters than this finds half the country; the server would refuse it anyway. */
export const MIN_QUERY = 3;
/** How long the thumbs get to stop typing before the server is asked. */
export const DEBOUNCE_MS = 300;

/** The query to send, or null when it is too short to bother. */
export function searchQuery(text: string): string | null {
  const q = text.trim().replace(/\s+/g, " ");
  return [...q].length >= MIN_QUERY ? q : null;
}

/** What `POST /players` gets for a tapped hit: the list and the id on it. Null when the hit has no id to go by. */
export function sourceOf(hit: SearchHit): PlayerSource | null {
  if (hit.source === "fide") return hit.fide_id ? { source: "fide", fide_id: hit.fide_id } : null;
  return hit.national_id != null && hit.national_id !== "" ? { source: hit.source, national_id: hit.national_id } : null;
}

/** The line under a hit's name: ratings, federation, club, birth year. */
export function hitDetails(hit: SearchHit): string {
  return [
    hit.fide_rating ? `FIDE ${hit.fide_rating}` : null,
    hit.national_rating ? `national ${hit.national_rating}` : null,
    hit.federation,
    hit.club,
    hit.birth_year ? String(hit.birth_year) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
