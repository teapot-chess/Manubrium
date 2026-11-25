# Manubrium

Run a chess tournament from the playing hall. Manubrium is a phone app
(iOS and Android, built with [Capacitor](https://capacitorjs.com)) that talks
to one or more [OpenPairings](https://pairings.cloud) servers: the current
round is its home screen, results can be entered without a signal, and the
organiser and editors can pair, change the pairings by hand, publish, read
the standings, change players and the mid-event settings from it. Arbiters
enter results, log incidents with a photo, and confirm or reject the results
Manubrium Lite phones entered.

Since the second batch it also:

- makes a **new tournament** from the Tournaments list - the short form
  (name, dates, place, system, rounds, time control, federation, rated);
  the long one stays at the desk;
- **adds players from the FIDE or Belgian list** by searching and tapping,
  with typing them in by hand kept for whoever is on neither;
- runs the **check-in** at the door: tick who is here, "n of m present",
  and a filter for the ones still on the train;
- edits a player's **requested byes** round by round; paired rounds are
  history and only shown;
- **shares** the round's pairings or the standings as plain text - a team
  event's standings as its team table - with the OpenResults link when
  there is one;
- shows what the **hall boards (Alnasl)** report beside each pairing - the
  board's result or how far the game is, in red when it disagrees - and
  makes and revokes the boards' codes under More. A board never enters a
  result; the arbiter does.
- gives the **hall apps** their orders from More: whether Polis (print)
  and Nunki (announcer) stations are online, print the round again
  (pairings, place cards, standings, player list, result slips), start or
  cancel the countdown, and say a canned or free-text announcement. Like
  everything that is not a result, it needs the server; a command that
  reaches nobody says so instead of looking pleased with itself.

Since 1.2 it also:

- keeps the **default time** for the round: start the clock when the
  clocks start, and the round screen counts down and lists the boards where
  somebody has not turned up (not checked in, or a hall board still set up
  with nothing moved). When the time is up each board offers its forfeit,
  after asking. The minutes are the arbiter's to enter - OpenPairings knows
  the rate of play, not the default time - and the phone remembers them per
  tournament. A local notification at the default time is optional, and
  *Remind me* (the server's push) starts from the same default time;
- works with **other arbiters** on the same tournament: who else is here and
  whether they are entering results in this round, handover notes (read,
  write, pin, resolve), "keep theirs / use mine" when a result was beaten to
  the board, and a board's history with Undo, under the desk's rules;
- **scans the code** OpenPairings now prints on result slips, place cards
  and team match slips: a slip opens its board's result entry, a place card
  the player's board in the round on screen, a team match slip its match and
  the match's first board without a result;
- opens a **player** from the result sheet, the default-time list or the
  standings: games so far with colours and results, the colour history,
  score and rank, rating, club, requested byes, and a line when they are not
  checked in;
- ends the standings with the **prize list** when the tournament has prize
  money: who gets what per table, provisional until the last result is in.
  Read-only; the money is set on the computer;
- has a **theme** picker under More, "This phone" - OpenPairings' palettes,
  each with a dark half that follows the phone. Slate is the default; the
  old green is still there as Classic;
- has an **app lock**, off until switched on: Face ID, Touch ID, a
  fingerprint or the phone's passcode when the app opens and after a chosen
  time away, with the arbiter's own code as the way in when biometrics will
  not cooperate.

Not yet released, it also:

- shows a **team event's round as matches**: a card per match with the
  teams, the running game points, the match points once it is over and its
  boards under it, in the layout the tournament names
  (`team_board_layout`: each team on its own side with a colour dot per
  player, or White on the left on every board). An OpenPairings that sends
  no matches gets the flat list;
- shows whether each team's **line-up** is confirmed and, for the organiser
  and editors, confirms one as it stands or a whole round's;
- opens a **match in full** from its card: the boards, both line-ups with
  their confirmation, what a plug-in's regulations make of them (the
  *Check* button), and, where the server's `can` allows, changing the
  line-ups (tick who sits out, or pick a player per board, whichever the
  tournament's editor is), resetting them, taking a confirmation back,
  swapping the home team, a forfeit to either team, a double forfeit, a
  match score, and withdrawing a decision or a score. An arbiter reads and
  sees none of the buttons;
- has a **Teams** tab in a team event: every team with its captain and its
  roster in board order, who has left, and for the organiser and editors
  what the Teams page does in mid-event - a team withdraws from a round or
  comes back, sits a round out or takes a half-point bye, a late reserve
  goes on the roster, a player comes off it;
- shows a team event's **standings** as the Standings page ranks them (match
  or game points, then the event's tie-breaks), the individual ranking, and
  the **board prizes** per board with the minimum number of games to count,
  and shares the team table like the individual standings;
- pairs a **team Swiss** like an individual one (a team round robin is paired
  at the desk, all rounds at once);
- enters every result by **holding its button for a second**: a tap shows
  "Hold for a second to lock the result" and enters nothing. A fill sweeps
  across the button while held (an outline instead under *reduce motion*),
  lifting or sliding off cancels, Enter or Space held does it from a
  keyboard. In the app the phone taps back through `@capacitor/haptics`
  (the Taptic Engine on an iPhone, the vibrator on Android): lightly when
  the press starts, firmer when it locks; in a browser `navigator.vibrate`
  does it where there is one (`src/haptics.ts`). The same hold
  guards a forfeit, a match score, a withdrawal and "use mine" after a
  collision. The logic is `src/hold.ts`, the button `src/ui/HoldButton.tsx`;
- notes that a player **will not play the next round** from the player's
  sheet, with the kind of bye the tournament offers, and takes it back;
- hides the boards that have a result (**Still playing**).

The server side - the API, device tokens, roles - lives in OpenPairings
(`docs/manubrium.md`, section "Full app"). This repository is only the app.
Manubrium Lite, the no-install browser page at `/m`, is OpenPairings' own and
has nothing to do with this code.

## Install

- **iPhone:** the App Store (TestFlight until the listing is public).
- **Android:** not on Google Play. On the phone, download
  [manubrium.apk](https://github.com/teapot-chess/Manubrium/releases/latest/download/manubrium.apk)
  (always the newest release) and open it. The first time, Android asks to
  allow the browser to install apps; allow it, install, and switch it back
  off if you like. After that the app looks for a new version once a day
  and offers it (*More, This phone, Check for updates*, which can be
  switched off). `SHA256SUMS` on each release has the checksums; the
  signing certificate's fingerprint is in `docs/releasing.md`. Android 8.0
  or later. Notifications need Google Play services on the phone.

**Verify an Android download.** Each release file carries signed build
provenance from GitHub. With the [GitHub CLI](https://cli.github.com/):
`gh attestation verify manubrium.apk --repo teapot-chess/Manubrium`

## Licence

Source published for reference under the Microsoft Reference Source License (Ms-RSL), copyright 2026 Jorian Burssens. The builds we publish (downloads, app stores, the Alnasl Pi image) may be used free of charge to run chess events; that permission covers our builds, not builds you make yourself. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

## How it is built, and why

- **Capacitor 8** wraps a web bundle in a native shell and gives it native
  HTTP, the camera and preferences. One codebase, two stores, no Swift or
  Kotlin to keep in step.
- **Preact + TypeScript + Vite.** The UI is a handful of screens with forms
  and lists. Preact gives components and hooks in about 4 kB - the same model
  as React, without shipping React. No UI kit: the look is OpenPairings' own
  palettes (`src/themes.ts`, set as CSS variables on `<html>`) and one
  stylesheet (`src/styles.css`), light and dark following the phone. No router either; five screens are a variable.
- **CapacitorHttp** (`capacitor.config.ts`) routes every `fetch` on a phone
  through the platform's own HTTP stack: no browser origin, so no CORS, and
  plain http to a desktop copy in the hall is governed by the native rules
  below. In a browser `fetch` stays the browser's, which is how the bundle is
  developed.

```
src/
  link.ts        the connect link, and the "http only inside the building" rule
  back.ts        the back button / Escape: sheets first, then screens
  i18n/          English, Dutch and French dictionaries, and t()
  api.ts         the API client (one function per route)
  queue.ts       the outbox: offline results and incidents, idempotent client ids
  relay.ts       a tournament run from a laptop: commands, their Idempotency-Key, asking again
  hall.ts        the hall path: the laptop first on the hall network, the cloud as the way round
  share.ts       the round, the standings and a team table as text, and the browser's share
  byes.ts        a player's byes: which rounds may still change, the next round
  matches.ts     a team round as matches: seats, colours, the layout, the score
  teamEvents.ts  the line-up editor's preview (who sits out), rounds a team can still change
  hold.ts        hold to enter: the rules (a second, tap, slide off), no DOM
  haptics.ts     the buzz a hold makes: native haptics, or navigator.vibrate
  search.ts      when a list search is worth sending, what a hit adds
  alnasl.ts      the line a hall board's report gets beside its pairing
  defaultTime.ts the default-time list, the round's clock, the forfeit to offer
  scan.ts        the codes on result slips, place cards and team match slips
  themes.ts      the palettes, light and dark, and applying one
  lock.ts        the app lock: when it locks, the code (salted hash only)
  phoneSettings.ts  what this phone keeps for itself (the reminder switch)
  servers.ts     the servers on this phone, one token each
  secure.ts      where the tokens live: Keychain / Keystore, Preferences in a browser
  platform.ts    phone-or-browser differences: storage, camera, deep links,
                 notifications, Face ID / fingerprint
  contract.testkit.ts  test helper: the vendored contract schemas
  ui/            the screens (HallPanel.tsx: the hall apps under More;
                 DefaultTime.tsx, PlayerSheet.tsx, PrizeList.tsx, PhoneSettings.tsx, AppLock.tsx;
                 Matches.tsx: a team round's match cards and the line-ups;
                 MatchSheet.tsx: a match in full; TeamsScreen.tsx: the teams;
                 TeamStandings.tsx: team standings and board prizes;
                 HoldButton.tsx: the button every result is entered with;
                 RelayCommands.tsx: the relay banner and the writes sent to the laptop)
```

## Offline

Results and incidents go into an outbox on the phone (`src/queue.ts`) and are
sent in order when there is a connection. Every entry carries a client id
made when it was tapped, so a resend after a lost answer is saved once, and
the result the board showed when it was tapped, so the server refuses it if
somebody changed that board in the meantime. A refusal stays on screen, with
the server's sentence, until it is dismissed. Nothing is dropped quietly.

An incident's photo rides in the outbox with its incident, shrunk to 1600
pixels by the camera, and is sent in a request of its own.

Everything else - clearing a result, confirming a Lite phone's result,
pairing and hand edits, publishing, players, check-in, byes, confirming
line-ups, a team match's changes, the teams' mid-event changes, settings, a new tournament, the hall boards' codes, the hall apps'
commands - needs the server's answer and is online only. The app says so
when it is not. A team match's score is the one sum the phone does itself:
results waiting in the outbox are counted into it, marked as waiting, until
the server's own figure replaces them. Where the desk would ask a question
before a change (a rule the boards break, a round already sent), the server
asks it and the app shows it; nothing is answered on the arbiter's behalf.

## A tournament run from the laptop (the cloud relay)

OpenPairings can run an event on the arbiter's laptop while pairings.cloud
keeps a locked mirror and an inbox for the phones (OpenPairings'
`docs/design-cloud-relay.md`; contract revisions 6 to 8). The tournament's
`relay` is then not null, and the app:

- says so at the top: "Run from the laptop (its name).", then which road it
  uses: "Connected to the laptop in the hall." or "Through the cloud.", with
  when the laptop last asked for results. When nothing has been heard from
  the laptop for ten minutes by any road (its last poll, its last word about
  its hall address, this phone's last answer from it), the banner says so
  and that results wait in the outbox, and adds that the tournament can be
  taken back on the website without the laptop (to the owner: on this
  server, from the tournament's banner). The tournament is read again every
  two minutes while it is open, so "last heard" stays honest;
- keeps every button the role allows. The hosted copy calls itself read-only
  and blocks pairing as `read_only`, but every write goes to the laptop,
  which runs it through its own copy of the API with this phone's role, so
  the desk's rules decide (`writableWhenRelayed`, `src/relay.ts`);
- sends an `Idempotency-Key` (a UUID) with every write, relayed or not. A
  write whose answer was lost keeps its key for ten minutes, so tapping it
  again is the same command, not a second one;
- reads `202 {"command": {...}}` as "sent to the laptop, waiting for the
  desk": the client throws `RelayedWrite` instead of the usual answer (which
  the hosted copy does not have), keeps the command on the phone
  (`CommandBook`, across restarts) and asks `GET commands/:cid` after 2, 3,
  5, 8, 13, 20, 30 and then every 60 seconds, and at once when the app comes
  back to the front. Done reloads the tournament; a refusal stays with the
  desk's sentence until dismissed; `needs_acknowledgement` is the desk's
  question, and *Go ahead* sends the write again with `acknowledged` under a
  new key. A board code made this way is shown from the command's answer;
- keeps results and incidents answered `pending` in the outbox as "sent,
  waiting for the desk" and sends them again with the same cid until they
  are saved or refused (`relay_stopped` included).

The server's own refusals before anything reaches the laptop (404
`not_found`, 409 `desk_only`, 400 `bad_request`) are ordinary errors.

### The hall path (contract revision 8, `src/hall.ts`)

When the laptop listens on the hall's network, `GET /tournaments/:id`
carries `relay.hall`: its addresses, its own id for the tournament, and a
pass (`oph1.`...) the cloud signed for this phone, good for twelve hours.
The client (`src/api.ts`, `call`) then:

- sends every write of the tournament to the laptop first
  (`urls[0]/api/manubrium/v1/tournaments/<tournament_id>/...`, `Authorization:
  Bearer <pass>`, the same `Idempotency-Key`), all addresses within 2.5
  seconds; the laptop answers `200 {"command": ...}` accepted or refused at
  once, which goes through the same `RelayedWrite` as the cloud's answer;
- sends the outbox's sync there too, whose results come back saved or
  refused, never pending;
- reads the round, the players, check-in, incidents, a card, a match, a
  board's history, the standings, the team standings, the teams and the
  board prizes there first, and the cloud first for 30 seconds after the
  laptop did not answer (the laptop again if the cloud cannot be reached).
  A player opened from a table is opened by uid, since the table may be the
  laptop's;
- goes through the cloud, with the same key and body, when the laptop does
  not answer in time, answers 401 (the pass is dropped and the tournament
  read again for a new one), `409 cloud_only`, a 5xx or something that is
  not the API. Any other answer, refusals included, is the desk's;
- never sends presence, handover notes, Live Activities or the account's
  routes there, nor a request that names a row by a plain id: rows go out by
  `uid` (`refOf`, `editRefs`, `lineupRefs`), which both copies share;
- sends the pass only to a private address over http (`isLocalHost`, as for
  a server added by hand) or to https, which the existing local-network
  rules cover: `NSAllowsLocalNetworking` and the local-network prompt on
  iOS, the app-enforced cleartext rule on Android;
- keeps the pass, the laptop's addresses and id, and the tournament as the
  cloud last showed it in the vault (`manubrium.hall.v1`, the Keychain or
  the Keystore, like the device tokens), per server and tournament. An app
  started in a hall with no internet lists and opens those tournaments
  from there and reaches the laptop. The pass goes when it runs out, when
  the cloud's tournament has no `relay.hall` any more, when the laptop
  answers 401 to it, when the cloud answers 401 to the device, and with
  the server.

Slips: on a relayed tournament OpenPairings prints `OP2:B:<tournament>:<round>:<pairing uid>`
and `OP2:P:<tournament>:<player uid>`, the tournament being the cloud's id or
the laptop's. They open by uid. An `OP1` slip (ids) opens nothing on a
relayed tournament, since the ids could be either copy's: the app asks for a
reprint or the board by hand.

Team match slips carry a link, `<base>/t/<tournament>/scan/<round>/<match id>?m=<match uid>`
(`PairingsEngineWeb.MatchLink`); only the path counts. Not relayed, the match
id opens it; relayed, only the uid does, and a link without one is an older
print.

## Develop in a browser

Needs Node 24 and npm 11.

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (API client, outbox, links, share text, byes, screens)
npm run build      # type-check and build into dist/
```

Point it at an OpenPairings dev server (`mix phx.server`, port 4000). That
server's `config/dev.exs` lets `http://localhost:5173` call its API
(`:manubrium_dev_origins`); no other environment does, and the installed app
does not need it. Sign in on `http://localhost:4000`, open **Account**,
**Manubrium app**, **Connect a phone**, copy the link under the QR code and
paste it into the app's **Add a server**.

## Live boards (live board control)

Under More, the hall boards' section opens **Live boards** once a code
exists: every physical board the tournament's boxes (Alnasl) report, as the
box last saw it. Owner and editors only, as on the server.

- **The list**: per table the connection (connected, lost, or "no news from
  the box" when the box's last report is over 90 s old), when the board was
  last seen, whether its box is online, the state (guessed moves in red,
  reconstructed ones in orange; a state this version does not know is shown
  as the box sent it), the alarms (unknown ones raw), a waiting memory
  draft, the pairing, the arbiter's result beside what the board saw, and a
  small board.
- **A board's sheet**: the position from the FEN (64 squares and Unicode
  glyphs, no chess library), the last move marked, turned round when the box
  has the board flipped; both clocks, the running one counted down on the
  phone from the report's `clock_at` and labelled approximate; the moves,
  fetched when the sheet opens and again when the board has more.
- **Commands**: accept the board's result (only when the board saw one and
  the arbiter has none; it is the arbiter's own tap, entered by OpenPairings,
  never by the box), keep or take back a guessed run, accept or discard a
  memory draft, set a position (checked before it goes), take back 1 to 20
  plies, flip, link to a board of the current round or unlink, restart the
  driver, re-read, and mark the game finished on the box only. Everything
  that throws something away asks first. Each command shows where it stands:
  waiting for the box, the box has it, done, failed (the box's error in a
  sentence), or expired after two minutes unfetched.
- **Polling**: `GET live-boards` every `poll_seconds` (the server says 5)
  while the screen or a sheet is open and the app is in the foreground
  (Capacitor's app state on a phone, page visibility in a browser). Leaving
  the screen stops it; coming back to the app asks at once.

The phone never talks to a box: commands wait on OpenPairings until the box
calls in (`docs/manubrium.md` there, and the `live-boards` schemas in the
contract). Code: `src/ui/LiveBoards.tsx` (screen and sheet),
`src/liveBoards.ts` (health, clocks, guessed runs, the sentences),
`src/fen.ts` (the board and the position check), `src/poll.ts` (polling
while looked at).

## Contracts

OpenPairings publishes the API this app talks to as JSON Schemas with
examples (`priv/contracts/manubrium-v1/` in that repository). A byte-for-byte
copy lives in `contracts/vendor/openpairings/manubrium-v1/`; the list of
vendored contracts is `contracts/vendor/contracts.json`. The second one,
`hall-link-v1`, is the pairing flow every hall app shares: the app reads
its own connect link from it, and recognises the join links of Nunki and
Polis (which run on PCs without a camera), says whom they are for and
offers to copy or share them on, never spending their code
(`src/hall-link.test.ts` runs every pairing-link example through it).
`npm run contracts:sync` fetches the current one from OpenPairings' main
branch (`CONTRACTS_REF=<branch>` for another) and rewrites the copy, deleting
files the provider dropped; `npm run contracts:check` does the same fetch and
exits non-zero with a diff if the copy is stale. CI runs the check on every
push and pull request and daily, so a server-side change shows up here even
in a quiet week. `npm test` (offline, `src/contracts.test.ts`) then holds the
app to the copy: every example answer goes through the real client and the
code that reads it, every request the app builds passes the server's request
schema, every route it calls is in the contract, and the app's types promise
nothing the schemas do not. After a sync, whatever fails there is what the
app has to catch up with.

## Phones: what is configured, and why

The `android/` and `ios/` projects are generated by `npx cap add` and
committed, with these changes:

**Android** (`android/app/src/main/`)
- `res/xml/network_security_config.xml`: cleartext allowed. A desktop copy in
  the hall answers plain http on a private address, and Android's config
  cannot say "private ranges only" - it matches domain names, not address
  ranges. The app enforces the range itself: `src/link.ts` accepts http only
  for loopback, 10/8, 172.16/12, 192.168/16, link-local, IPv6 unique-local
  and `.local` names; everything else must be https.
- `AndroidManifest.xml`: `allowBackup="false"` (the outbox and, in the
  fallback case, the token must not reach Google backup), the network
  security config, the camera permission
  (QR scanning, incident photos; declared not required) and an intent
  filter for `manubrium://connect`, so a scanned or tapped connect link
  opens the app.
- Android has no per-permission explanation strings. The notification
  (`POST_NOTIFICATIONS`) and biometric (`USE_BIOMETRIC`) permissions come
  in with their plug-ins' manifests; Android 13 asks for notifications the
  first time the default-time reminder is switched on and used.
- `android/variables.gradle`: `minSdkVersion = 26`, Android 8.0. The QR
  scanner plug-in will not build for less, and said so only when v1.0.0 was
  tagged.
- `build.gradle`: the version from CI (`-PversionCode`, `-PversionName`)
  and a release signing config that is used only when CI hands it the
  upload keystore in the environment.

**iOS** (`ios/App/App/Info.plist`)
- `NSLocalNetworkUsageDescription`: iOS asks before an app talks to the
  local network; without the sentence the hall's desktop copy is unreachable.
- `NSAppTransportSecurity` / `NSAllowsLocalNetworking`: plain http to
  local-network addresses only. Everything else keeps ATS (https).
- `NSCameraUsageDescription` (the QR scanner for connect codes, result
  slips and place cards; incident photos), `NSFaceIDUsageDescription` (the
  app lock), each also in `en.lproj`, `nl.lproj` and `fr.lproj`,
  `NSPhotoLibraryUsageDescription` (an existing photo for an incident; no
  copy is written back, so there is no add-to-library string),
  `ITSAppUsesNonExemptEncryption` (standard HTTPS only, so TestFlight does
  not ask per build), and the `manubrium` URL scheme.

After changing anything in `src/`: `npm run sync` (build, then
`npx cap sync`).

## Building for a phone

Nothing here installs the SDKs; they are needed only to build the native
apps. The identity - bundle id `cloud.pairings.manubrium`, name Manubrium,
version from `package.json` - is set in `capacitor.config.ts`, the Xcode
project and `android/app/build.gradle` together (`docs/releasing.md`).

### Prerequisites

- Node 24, npm 11, `npm install`.
- **Android:** Android Studio with its SDK and JDK 21.
- **iOS:** a Mac with Xcode 16 or later, and an Apple Developer Program
  membership for anything beyond the simulator. The project uses Swift
  Package Manager, so there is no `pod install`.

After changing anything in `src/`: `npm run sync` (build, then
`npx cap sync`), which copies the bundle into both native projects and
registers the plugins. After changing anything in `brand/`: `npm run assets`.

### A development build on your own phone

```sh
npm run sync
npx cap open android      # Android Studio: pick the device, Run
npx cap open ios          # Xcode: pick the device, Run
```

In Xcode, once per Mac: select the *App* target, *Signing & Capabilities*,
pick your team and keep *Automatically manage signing*. Xcode makes a
development certificate and profile for the phone it sees. The first run on
a phone asks to trust the developer under *Settings > General > VPN & Device
Management*. None of that touches the repository: the team id is not
committed, and the store build signs differently (below).

For the hall's local network, run a desktop OpenPairings on the laptop and
connect the phone to its private address; iOS asks once for the local
network, Android asks for nothing.

### Release builds: TestFlight and the Android apk

Both come out of GitHub Actions, signed with the organisation's secrets,
and need no Mac on anyone's desk:

- `.github/workflows/testflight.yml` archives, signs for the App Store and
  uploads to App Store Connect (then TestFlight).
- `.github/workflows/android.yml` builds the signed `.apk` and, on a
  version tag, puts it on the GitHub release as `manubrium.apk` (plus a
  versioned copy and `SHA256SUMS`), which is where Android phones install
  and update from. The `.aab` is kept as an artifact.

Both run from the Actions tab (*Run workflow*) or on a tag `vX.Y.Z` that
matches `package.json`. `docs/releasing.md` has the whole procedure, the
secrets, and what to create at Apple and Google first. The listing copy,
the privacy policy and the screenshot list are in `store/`.

## Known gaps

- **Store review is the first outside test.** The native shells are built
  and signed by CI and the iOS app is in App Store review; what the tests
  cover is the web bundle, the API client and the outbox.
- **Incident photos wait in the outbox as base64 text** in the app's
  preferences, not as files. Fine for a few; a file store is the follow-up.
- **Not in the app because the server does not offer it yet:** acknowledging
  from a phone the results Lite refuses for the desk (a decisive postponed
  game, a correction after the next round is paired, a round already sent to
  FIDE).
- **Team events: what still stays at the desk.** Setting the teams up
  (creating, renaming, seeding, the roster's board order, imports), pairing
  a team round robin (the whole schedule at once), pairing hand edits that
  rewrite a match, the cross table and the printed match sheets.
- **A screen reader's plain "activate" is a tap**, so on a result button
  it enters nothing: a result is entered with the hold gesture, or with
  Enter or Space held.
- **Built against the server's contract, not its finished code.** New
  tournaments, list search, check-in, byes, board reports and board codes
  were written while OpenPairings was still writing its half. The fakes
  agree with the contract; whether the server does is the first real run's
  job.
- **The Belgian list is the only national one offered**, because it is the
  only one the server has. The toggle shows whatever `player_sources` says.
- **The hall path needs the cloud once.** The pass comes from the cloud's
  `GET /tournaments/:id`, and is kept for its twelve hours. A phone that
  never opened the tournament while the cloud answered has no way to the
  laptop, and a tournament opened from the kept copy shows the tournament
  as the cloud last did (its rounds and tables come from the laptop).
- **Not every read takes the hall path.** The prize list (its players have
  ids and no uid), the settings, board codes and the live boards are read
  from the cloud's copy, a moment behind the laptop. Board codes and
  live-board commands, which name the laptop's own ids, go through the
  cloud as before, and so does a result queued by a version that named
  boards by id.
- **In a browser the hall path needs the laptop to allow CORS**; where it
  does not, the request goes through the cloud, as it would without a hall
  path. The phones do not use CORS.
- **A new tournament is not queued offline.** It needs a connection, on
  purpose.
- `npm audit` reports moderate advisories in `@capacitor/cli`'s `xcode`
  dependency. It is a build-time tool and never ships in the app.
