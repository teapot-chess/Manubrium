# Changelog

What changed in Manubrium, newest first. Earlier releases are in the GitHub
release notes; this file starts where somebody finally asked for one.

## 1.2.0

- **Default time.** The round screen keeps the round's clock: tap "Clocks
  started", or give the time they did, and it counts down to the default
  time. Beside it, the boards where somebody has not shown up - not checked
  in, or a hall board still sitting in its starting position. When the time
  is up, each board offers the forfeit that fits the empty chair, and asks
  before entering it, because the player in the corridor on the phone to
  their mother is still technically present. OpenPairings knows the rate of
  play but not the default time, so the arbiter types it in once; the phone
  remembers it per tournament and suggests 30 minutes until told otherwise.
  An optional local notification goes off when the time is up, for arbiters
  who were sure they would remember.
- **Scan a slip.** OpenPairings now prints a small code on every result slip
  and place card. Scan a slip and its board's result entry opens; scan a
  place card and you get the player's board in the round on screen. A slip
  from another tournament, or a loyalty card from the supermarket, is
  refused by name instead of guessed at.
- **Tap a player.** From the result sheet, the default-time list or the
  standings: games so far with colours and results, the colour history at a
  glance, score and rank, rating, club, requested byes, and a plain note
  when they have not checked in. Arbiters see it too; the server grew a
  small read-only route for them rather than handing over the whole list.
- **Prizes.** When the tournament has prize money, the standings end with
  who gets what, table by table, marked provisional until the last result
  is in. The organiser can now disappoint people from anywhere in the hall.
  Read-only: the amounts are still set on the computer, where a typo costs
  a walk rather than a payout.
- **Themes.** More, "This phone": OpenPairings' palettes, each with a dark
  half that follows the phone. The default is now Slate. The green of 1.0
  and 1.1 is still there as Classic, for anyone who misses it, which
  statistically is someone.
- **App lock.** Off unless you turn it on. Face ID, Touch ID, a fingerprint
  or the phone's passcode when the app opens and after the time away you
  choose, with your own 4-8 digit code for when the sensor disagrees with
  your gloves. The code is kept as a salted hash in the Keychain/Keystore;
  five wrong guesses buy a wait that doubles. Opening the camera or the
  share sheet does not count as leaving, so scanning a slip does not lock
  you out of the slip you just scanned.
