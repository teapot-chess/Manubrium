# Changelog

What changed in Manubrium, newest first. The server side of each change is in
OpenPairings' own changelog.

## [Unreleased]

## 1.2.0 - 2026-11-11

- [Fix] **Removing a server in a dead spot no longer leaves the phone signed in.** If the server could not be reached, the token was thrown away and the phone stayed a valid device on the account, with nobody holding the key to revoke it. The token is now parked in the Keychain / Keystore and the app tries again on start and whenever it comes back online or to the front: push registration first, then the sign-out. It stops once the server has heard it, or has forgotten the phone, or after ninety days of silence.
- [Fix] **A lock whose code cannot be read has a way out.** When the phone's secure storage loses the key, every code you type is "wrong" for ever and the only exit was a reinstall, which takes the results still waiting to be sent with it. The lock screen now says the code cannot be read (and does not count it as a wrong try), and offers **Reset the lock**: the phone signs out of every server, you choose a new code, and the outbox is left alone. Connect the server again with a new link and what was waiting goes out.
- [Change] **A server must be at the root of its address.** An address with a path (https://host/pairings) used to be cut back to https://host, which then answered 404 and looked like "not OpenPairings". It is now refused, with a sentence saying the server must be at the root.
- [Change] **Plain http over Tailscale or a mobile carrier (100.64.x.x to 100.127.x.x) is still refused, but the message now says why and what to use instead:** an https address, such as the server's Tailscale name.
- [Fix] Android: the camera's file provider no longer exposes all of shared storage, only the app's own Pictures folder and its caches. Taking an incident photo wants a try on a real Android phone.
- [Fix] **One bad request no longer holds the whole outbox hostage.** If the server answered a batch with a client error that was about the batch itself (an incident photo a proxy found too heavy, say), every result tapped afterwards queued politely behind it for ever, and the only way out was to remove the server and lose the lot. That batch is now refused with the server's own sentence, the rest goes through, and a result still waiting can be dismissed (after asking, because nobody has read it yet). A server that no longer knows this phone now says so, and what to do about it, instead of a bare error.
- [Fix] **The app lock keeps count.** Five wrong codes, a force quit and five fresh tries: the wait that doubles was decorative. The misses and the wait they earned now survive a restart. A correct code still clears them.
- [Fix] **The lock no longer shows the round in the app switcher.** While the lock is on, the moment the app stops being in front a plain cover goes over it, before the system takes its picture; coming back lifts the cover and leaves you on the screen you were on.
- [Fix] A result or incident that could not be written to the phone's own storage now says so and keeps the sheet open, instead of leaving a board with no result and an arbiter who assumes there is one. A server that was connected but could not be saved says so too, and "Turn on notifications" no longer leaves its button disabled when it fails.

- [Feature] **Several arbiters, one round.** The desk learned last week that two arbiters on one tournament ought to be able to tell; the phone, where the second arbiter usually stands, now can too. Under the round's title: the initials of the other arbiters who have the tournament open (at a desk or in this app), and a line when one of them is entering results in the round you are looking at. If a result you enter was beaten to the board, it no longer vanishes into a sentence: a card shows both results and asks **Keep theirs** or **Use mine**, and *mine* goes in again expecting what the board holds now, so the next collision is a new question rather than a silent overwrite. **Handover notes** sit above the boards (pinned ones always; the rest behind *Handover notes*), and you can write one, pin it, make it about this round, or mark it resolved. A board's sheet has **History**: who changed its result, when and from what, with **Undo** where the desk would allow it and the desk's own reason where it would not. An older server simply doesn't show any of this. English, Dutch, French.
- [Change] **One default time, not two.** *Remind me at the default time* used to ask for minutes of its own, next to the Default time card that already knew them. It now offers the default time first: the moment the clock on that card runs out when the clocks are running, otherwise this phone's minutes for the tournament, with the fixed choices below for anyone who wants a different number.

- [Feature] **Notifications.** A round paired or published, a Lite phone's
  result the hall board contradicts, an incident somebody else logged, the
  default time you asked to be reminded of: the server now tells the phone,
  app closed or not. The app does not ambush you with a permission dialog at
  first launch; it asks once, when a round is on screen, and takes "Not now"
  for an answer. The Servers screen has a switch per event, per server. Other
  arbiters' results start switched off, because a co-arbiter's every draw is
  not news. Tapping a notification opens its tournament on the right server.
  A server without push keys says so instead of staying mysteriously quiet.
- [Feature] **The round on the lock screen.** On an iPhone (iOS 16.2 and
  later) the round in progress sits on the lock screen and in the Dynamic
  Island - *Round 5: 23 of 32 results* - and keeps counting with the app
  closed, because the server pushes the count. It leaves when the last result
  is in, which is more than can be said for most spectators.
- [Feature] **Remind me at the default time**, under the round's boards: one
  notification when the minutes are up, sent by the server, so it arrives
  even if the phone spent the round in a pocket.
- [Change] Android builds push only when built with Firebase's
  `google-services.json` (the `GOOGLE_SERVICES_JSON` secret); without it
  the build works as before and says it cannot receive notifications.

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
