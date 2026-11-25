# Changelog

What changed in Manubrium, newest first. The server side of each change is in
OpenPairings' own changelog.

## [Unreleased]

## 1.7.1 - 2026-11-25

- [Fix] **Cancelling the scanner no longer scolds.** Backing out of Scan on a round, or a phone with no camera to offer, came back as "that is not a slip", as if a code had been read and found wanting. Nothing was read; nothing is said.
- [Fix] **The app lock hears only of real returns.** The same listener that refreshes data when the network comes back also reset the lock's "left at" time, so a connection regained while the app sat in the background could forget when it had gone, and the lock would not come back after its delay. The lock now listens to the app coming to the front and to nothing else.

## 1.7.0 - 2026-11-24

- [Feature] **Android, without Google Play.** Play wanted a D-U-N-S number or twelve testers for a fortnight, and we had neither, so Manubrium for Android is now a signed apk on GitHub's releases: [manubrium.apk](https://github.com/teapot-chess/Manubrium/releases/latest/download/manubrium.apk), always the newest. Every release carries it under that name, beside a versioned copy and `SHA256SUMS`. The release key is made, kept off every repository, and pinned in the workflow, which refuses to publish an apk signed with anything else; an update signed with another key would not install over the app, and the phones would find out before we did.
- [Feature] **The Android app looks for its own updates.** On start and on coming back to the front, at most once a day, it asks GitHub for the latest release and, when there is a newer apk, offers it. *Download* hands the file to the phone's browser, and tapping it brings up Android's installer; an installer of our own would have needed a sensitive permission and a native plug-in to arrive at the same screen. The request carries nothing about the phone or its tournaments. *More, This phone* has the switch to turn it off and *Check now* for the impatient. The iPhone has the App Store and is left alone. English, Dutch, French.
- [Change] **No Firebase, no push, no drama.** The Android build still gets push only when `GOOGLE_SERVICES_JSON` is set, which it is not yet; until then it says it cannot push and does everything else. `docs/releasing.md` says what to create.

- [Change] **The privacy policy admits to push tokens and the slip scanner.** It said the app talks to nothing but your servers and carries no third-party SDK, which stopped being quite true the day notifications arrived. It now says what a push token is, what goes with it to which server, why, and how each switch, a removed server or a revoked phone deletes it; that scanning a result slip, place card or team match slip happens on the phone and keeps nothing; and that the Android build carries Google's Firebase Cloud Messaging and ML Kit for exactly those two jobs. The App Store and Play Store answers in `store/` say the same. The copy shown on pairings.cloud is OpenPairings' manual and follows there.

## 1.6.1 - 2026-11-24

- [Fix] **An open team stays the team you opened.** On a relayed tournament the teams list can be read from the laptop one time and from the cloud the next, and the two copies number their teams differently. The open team was remembered by number, so a refresh could quietly swap it for whichever team now wore that number. It is remembered by its uid now, which both copies agree on.
- [Fix] **Backing out of a withdrawal forgets the question.** Closing the withdraw sheet any way but *Keep* left the server's question behind, so the next Withdraw skipped the round picker and went straight to "go ahead anyway?". Every way out now tidies up.
- [Fix] **A line-up check answers the line-up on screen.** A check still on its way when a player was ticked used to land under the new draft, approving a line-up it had never seen. An answer about an older draft is now dropped.
- [Fix] **A slow tournament read no longer overwrites a newer one.** The relay timer, a pairing and an answered command all read the tournament again; whichever answer came last won, not whichever was asked last. Only the newest counts now.
- [Fix] **A write stranded by a lost laptop says so in the list too.** The relayed-writes list showed the generic "the desk did not accept it" for a `laptop_lost` refusal, ignoring the sentence written for exactly that case in 1.4.1. It uses it now.
- [Change] **`.gitattributes` forces LF everywhere, with CRLF only for `gradlew.bat`.** A Windows checkout used to depend on `core.autocrlf` being in a good mood. Binary types (images, archives, fonts, the Gradle wrapper jar) are listed instead of guessed. Nothing in the repository changed when the file was renormalised, which is the whole point.

## 1.6.0 - 2026-11-24

- [Feature] **Scan reads team match slips.** The code on a team match slip or match sheet is a link (OpenPairings' "Scan team match slips"), and the app's Scan used to call it "not a slip", which was accurate and no help at all. It now reads the link - `/t/…/scan/<round>/<match>`, and the match page's own address - goes to the round, brings the match into view, marks it, and opens its first board still without a result. A match with every result in is only brought into view, with a line saying so. On a relayed tournament the link must carry the match's uid (OpenPairings prints it from 0.158.0); an older print there says so instead of opening a match by a number that belongs to the other copy. English, Dutch, French.
- [Fix] **Entering or confirming a result no longer bounces.** A hold locks while the finger is still down, and closing the sheet left the finger over the round list. The click its lift sent then landed on the board underneath, whose sheet opened again: away and straight back, which looked very much like the server changing its mind. It was the glass. For a moment after a hold locks, a click anywhere else is ignored. Closing a sheet also no longer scrolls the list to the board it came from.
- [Fix] **A saved result stays put while the round is read again.** In the half-second between the server saying "saved" and the round being fetched again, the board showed the round as it was before - no result - and anything that redrew the screen in that window (the "still playing" filter, a second scan) put the board back in the list. The app now keeps showing what the server saved until a round asked for after the save has arrived.
- [Fix] **Live boards keep all eight ranks.** The board was a grid with eight columns and however many rows its contents asked for, so an empty rank shrank to a sliver next to ranks with pieces on them. Rows are eighths now, and squares stay square, on the small boards and the large one.

## 1.5.0 - 2026-11-21

- [Change] **Built with Xcode 27.** App Store Connect had started warning that it stops taking iOS 26 builds in April 2027. It said so politely, on every upload, which is how one knows it means it.
- [Fix] **One lock-screen activity per tournament, kept for the whole event.** It used to be one per round: the last result ended it, and the next round appeared only once somebody opened the app, which nobody does at the moment the desk is busy pairing. So the lock screen said "Round 2, 1/1 results" well into round 3. The round number now lives in the activity's state instead of being carved into it at birth, so the server moves it on: a complete round says *All results in*, the next pairing says *Round 3: 0 of 16*. It ends when the tournament is finished, archived or deleted, or when the switch goes off. Opening the app keeps the one that is running instead of replacing it. It dims after four hours without news. Still nothing where the server cannot push. Needs OpenPairings with contract revision 10; an older server ends it with the round, as before.
- [Feature] **The server can start it again after iOS takes it away.** iOS allows a Live Activity eight hours. On iOS 17.2 and later the app gives every server that can push a push-to-start token, with its strings in the app's language, and the server starts a fresh activity at the next result or pairing. That one counts along once the app has been opened, which is when iOS tells the app about it. Switching the lock screen off takes the token back. The vendored OpenPairings contract is at revision 10. English, Dutch, French.

## 1.4.2 - 2026-11-21

- [Fix] **The round stays off the lock screen where nobody can move it.** A server without push keys let the app put the round on the lock screen anyway, where it stayed at round 1, 0 of 1, through results, pairings and the next round, looking very sure of itself. The app updates it only while it is open; after that only the server can, by push. It now asks the server first, and a server that cannot push gets no Live Activity. One already showing is ended.

## 1.4.1 - 2026-11-20

- [Change] **Requests stranded by a lost laptop say so.** When the laptop running a relayed tournament is taken back on the website without it, what was still waiting for it comes back refused as `laptop_lost`, and the server, having nothing useful to add, adds nothing. The app now says it in its own words: not done, the arbiter has it on a list, look again later. The vendored OpenPairings contract is at revision 9. English, Dutch, French.

- [Feature] **Uid slips.** On a relayed tournament OpenPairings prints `OP2` slips and place cards, which name the board or player by uid, the one name both copies of the tournament agree on, and the tournament by either copy's id. They open the right board whichever copy the round on screen came from. An `OP1` slip on a relayed tournament now opens nothing: its numbers belong to one of two databases and the app cannot tell which, so it says the slip is from an older print and suggests reprinting or picking the board by hand. Opening somebody else's game with confidence was the alternative. A uid that is not in the round says the board is gone, as before.
- [Feature] **The desk's tables on the hall path.** Standings, team standings, the teams and the board prizes are now read from the laptop first, like the round, and through the cloud when the laptop does not answer. A hall that lost its internet still has its standings. A player opened from one of those tables is opened by uid, because the table may be the laptop's and the laptop's ids are not the cloud's. The prize list stays on the cloud: its players come without a uid, and guessing is not a feature.
- [Feature] **The hall pass survives a restart.** The pass, the laptop's addresses and its id for the tournament, and the tournament as the cloud last showed it, are kept in the Keychain or the Keystore beside the device tokens. An app started in a hall whose internet is already down lists those tournaments, opens them, says it is showing the tournament as last seen, and talks to the laptop. The pass is dropped when it runs out, when the cloud stops handing one out, when the laptop refuses it, when the cloud no longer knows the phone, and when the server is removed.
- [Feature] **A quiet laptop is called quiet.** When nothing has been heard from the laptop for ten minutes, by the cloud or by this phone in the hall, the banner says "The laptop hasn't answered since 14:02. Results wait in the outbox." and that the tournament can be taken back on the website without it; the owner is told where. A relayed tournament is read again every two minutes while it is open, so the banner does not mistake its own old news for silence.
- [Change] **A refusal for a reason this app has never heard of** shows the server's own sentence, which was already the case and now has a test saying so. English, Dutch, French.

## 1.4.0 - 2026-11-20

- [Feature] **The hall path.** A tournament run from the laptop used to reach the laptop only by way of the cloud, which is a long way round for a laptop twenty metres off. When the cloud says where the laptop answers on the hall's network, the phone now goes there first: every change, the outbox's results and incidents, and the round it reads afterwards. The laptop answers at once, so "waiting for the desk" mostly does not happen any more. When the laptop does not answer within two and a half seconds, refuses the phone's pass, or says the request is the cloud's business, the same request goes through the cloud with the same Idempotency-Key, and the laptop, which keeps the answer it gave under that key, does not do it twice. The banner says which road is in use: "Connected to the laptop in the hall." or "Through the cloud.". Presence, handover notes, Live Activities and the account stay on the cloud. The pass is the cloud's, not the phone's own token, lives twelve hours, is kept in memory only and is renewed with every read of the tournament. It is only ever sent to a private address over plain http (or to https), which the local-network rules already in place for a laptop in the hall cover on both platforms.
- [Change] **Rows are named by uid.** Boards, players, teams, matches, incidents and board-history rows go out by the uid the server sends beside the id, which is the same on the laptop and in the cloud, where the ids are not. A server that sends no uid gets the id, as before. A request that still names a row by an id (a result queued by an older version, a board code) goes to the cloud, which knows what its own ids mean. The vendored OpenPairings contract is at revision 8. English, Dutch, French.
- [Feature] **A tournament run from the laptop, through the cloud.** When the arbiter's laptop runs the event and pairings.cloud only carries the phones, the tournament says so at the top: "Run from the laptop. Results go through the cloud.", with when the laptop was last heard from. Everything the phone can do still works, because the cloud no longer pretends to decide: pairing, publishing, hand edits, players, check-in, byes, line-ups, every team action, settings, incidents, board codes and the hall commands all go to the laptop, which runs them with the desk's own rules and answers. Until it has, the phone says "Sent to the laptop, waiting for the desk" instead of something more reassuring and less true; then it says done, or the desk's refusal in the desk's own words. When the desk would ask a question first, the question arrives on the phone, and *Go ahead* sends the change again with the answer. A board code made this way is shown once it is made, since that is the only time anybody sees it.
- [Feature] **Results and incidents on a relayed tournament** stay in the outbox as "Sent, waiting for the desk" until the laptop has accepted or refused them, and are asked about again soon, then less often, and at once when the app comes back to the front. A refusal because the laptop stopped relaying is shown like any refusal, so nobody waits for an answer that is not coming.
- [Change] **Every write carries an Idempotency-Key**, a UUID kept with it. If the answer gets lost and the same thing is tapped again within ten minutes, it goes with the same key, and the server treats it as the same write rather than a second one. The vendored OpenPairings contract is at revision 7. English, Dutch, French.

## 1.3.0 - 2026-11-19

- [Feature] **Hold to enter.** A result is now entered by holding its button for a second. A tap does nothing except say "Hold for a second to lock the result", which is the point: the phone lives in a pocket, a hall is full of elbows, and nobody has ever wished a draw on board 14 had been entered faster. A fill runs across the button while it is held; lift the finger, slide off or scroll and it stops, with nothing entered. A keyboard does it by holding Enter or Space, a screen reader is told about it, and with *reduce motion* on the sweep becomes an outline and the second stays a second. It applies to every result button there is: the three results and the rest of the list, the confirm of a Lite phone's result, the forfeit at the default time, accepting a hall board's result, finishing a game on a box, and *Use mine* after a collision. The phone taps back while you hold: lightly when the press starts, so the thumb knows it counts, and firmer when the result locks.
- [Feature] **Haptics on the iPhone.** The hold now goes through the phone's own haptics (`@capacitor/haptics`, the Taptic Engine on an iPhone, the vibrator on Android) instead of the browser's vibrate, which iOS never had. A browser still buzzes where it can and stays quiet where it cannot.
- [Feature] **Team events, from the phone.** What the desk does with a team match is now there, behind a *Details* button on every match card, and shows only what the server says applies. Both line-ups with their confirmation; the editor in whichever form the tournament uses (tick who sits out, or pick a player for each board, with who is available shown); the *Check* button for what a plug-in's regulations make of them, violations first; saving, resetting to what the rosters would seat, taking a confirmation back, swapping the home team. A forfeit to either team, a double forfeit and a match decided by its score are held, like any result, and when the server wants a question answered first (a board already sent in a rating report) it is shown as its own question. An arbiter sees the match and none of the buttons. This, the Teams tab and the team standings need OpenPairings 0.150 or later.
- [Feature] **Teams.** A tab for team events: every team, its captain, its roster in board order, who has left. The organiser and editors can withdraw a team from a round (its paired matches forfeited to the opponents, after asking and a hold), bring it back, sit it out of a round to come or give it a half-point bye, put a late reserve from the tournament's players on its roster and take a player off it. Arbiters read the same lists, because who plays for whom is the first thing a hall asks.
- [Feature] **Team standings and board prizes.** Standings in a team event are the teams as the desk ranks them (match points or game points first, then the event's own tie-breaks), the ranking of the individual players, and the board prizes per board with a minimum number of games that starts at the desk's default and goes up or down. Postponed games still to be played count as draws, and the table says so.
- [Feature] **Share the team standings.** The same *Share* button the individual standings have: the team table as plain text, places, match and game points and the tie-breaks with what they stand for, a note when places are provisional, and the OpenResults link. The individual ranking and the board prizes stay on the phone; the chat group wants to know who won the league, not who scored 71% on board 3.
- [Change] **A team Swiss is paired from the phone** like any Swiss. The app never stood in the way; it now has a server that does not either. A team round robin is paired at the desk, all its rounds at once, and the app says that instead of "paired at the desk" and leaving you to guess why.
- [Change] **What stays at the desk, for team events:** setting the teams up (creating, renaming, seeding, the roster's board order, imports), pairing a team round robin, hand edits that rewrite a match, the cross table and the printed match sheets. The previous list, which included changing a line-up, a forfeit and a match score, was true until this release.
- [Change] The vendored OpenPairings contract is at revision 5. English, Dutch, French.

- [Feature] **Team events, as matches.** A team round used to arrive as one flat list of boards, which is accurate in the way a phone book is accurate. It is now a card per match: the two teams, the game points so far, the match points once every board is in, and the match's boards under it, numbered within the match. The boards follow the tournament's own layout, the one the desk and the printouts use: by default each team keeps its side, the first-named team on the left on every board, with a white or black dot beside every player; a tournament can ask for White on the left on every board instead. The result between two players reads left to right, the left player's score first, so nobody has to remember who had Black on board 4. Entering a result is what it was: tap the board, and the sheet now also marks who is White. Results still waiting on the phone count in the match's score at once, dashed, until the server has them and says the same thing. A forfeit by decision, a double forfeit and a match entered as a score say so on the card. Needs an OpenPairings that sends matches; an older one gets the flat list, as before. English, Dutch, French.
- [Feature] **Line-ups from the floor.** A match whose line-ups are not confirmed says so, per team. Tap a team for who it has on which board and with which colour; the organiser and editors can confirm it there, as it stands, or confirm the whole round at once after being asked whether they mean it, since a confirmed match goes public board by board. An arbiter sees what waits and who to nag. Changing a line-up, and taking a confirmation back, stay at the desk. Needs a connection, and says so without one.
- [Feature] **"I won't be playing the next round."** Every arbiter hears it between rounds, usually on the stairs. A player's sheet now has *Will not play round N* for the organiser and editors: two taps, the second being the kind of bye the tournament offers, and *Plays round N after all* to take it back. The server decides what is allowed and what it is worth; when it wants a question answered first (a second half-point bye, a round already sent for rating) the app asks it, and when it refuses the app shows its sentence. The byes the player already had for other rounds are read again just before the change, so the desk's work in the meantime survives it.
- [Feature] **Still playing.** A chip above the boards hides everything that has a result, and in a team event every match that is finished. In the last half hour of a round, the forty boards that are done are not what anybody is looking for.
- [Fix] **The byes editor can answer the question it asks.** Saving a second half-point bye got the server's "Confirm to give it anyway" as a red error, with nothing to confirm it with. It is now a question with a Confirm button, like the same question everywhere else in the app.
- [Fix] The black dot beside a game played with Black had a black ring on a dark theme, which made it a dot in theory only. It keeps a visible ring now.

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
