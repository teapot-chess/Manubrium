// The round the app opens on. The server decides which round is current
// (OpenPairings' `PairingsEngine.CurrentRound`: of the rounds paired last
// together, the first with a game still to play) and marks it `latest` on
// the round it sends. It is never past the last paired round, so the walk
// starts there and goes down. A Swiss round, or a server from before the
// rule (which marked the last paired round), answers on the first request.
// A round robin paired in one go costs a request per round, once.

/**
 * The current round of a tournament with `paired` rounds paired, asking
 * `fetchRound` for each round from `paired` down until one says `latest`.
 * `paired` when none does, or when a request fails (offline): the last
 * paired round is what the app opened before the server had a say.
 */
export async function currentRound(
  fetchRound: (number: number) => Promise<{ latest: boolean }>,
  paired: number,
): Promise<number> {
  for (let n = paired; n >= 1; n--) {
    try {
      if ((await fetchRound(n)).latest) return n;
    } catch {
      return paired;
    }
  }
  return paired;
}
