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
- **shares** the round's pairings or the standings as plain text, with the
  OpenResults link when there is one;
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
- **scans the code** OpenPairings now prints on result slips and place
  cards: a slip opens its board's result entry, a place card the player's
  board in the round on screen;
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

The server side - the API, device tokens, roles - lives in OpenPairings
(`docs/manubrium.md`, section "Full app"). This repository is only the app.
Manubrium Lite, the no-install browser page at `/m`, is OpenPairings' own and
has nothing to do with this code.

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
  share.ts       the round and the standings as text, and the browser's share
  byes.ts        a player's byes: which rounds may still change
  search.ts      when a list search is worth sending, what a hit adds
  alnasl.ts      the line a hall board's report gets beside its pairing
  defaultTime.ts the default-time list, the round's clock, the forfeit to offer
  scan.ts        the codes on result slips and place cards
  themes.ts      the palettes, light and dark, and applying one
  lock.ts        the app lock: when it locks, the code (salted hash only)
  phoneSettings.ts  what this phone keeps for itself (the reminder switch)
  servers.ts     the servers on this phone, one token each
  secure.ts      where the tokens live: Keychain / Keystore, Preferences in a browser
  platform.ts    phone-or-browser differences: storage, camera, deep links,
                 notifications, Face ID / fingerprint
  contract.testkit.ts  test helper: the vendored contract schemas
  ui/            the screens (HallPanel.tsx: the hall apps under More;
                 DefaultTime.tsx, PlayerSheet.tsx, PrizeList.tsx, PhoneSettings.tsx, AppLock.tsx)
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
pairing and hand edits, publishing, players, check-in, byes, settings, a new
tournament, the hall boards' codes, the hall apps' commands - needs the server's
answer and is online only. The app says so when it is not. Where the desk
would ask a question before a change (a rule the boards break, a round
already sent), the server asks it and the app shows it; nothing is answered
on the arbiter's behalf.

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

### Store builds: TestFlight and Google Play

Both come out of GitHub Actions, signed with the organisation's secrets,
and need no Mac on anyone's desk:

- `.github/workflows/testflight.yml` archives, signs for the App Store and
  uploads to App Store Connect (then TestFlight).
- `.github/workflows/android.yml` builds the signed `.aab` for the Play
  Console and the `.apk` for a tester without Play.

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
  FIDE). Team events' hand edits stay at the desk.
- **Built against the server's contract, not its finished code.** New
  tournaments, list search, check-in, byes, board reports and board codes
  were written while OpenPairings was still writing its half. The fakes
  agree with the contract; whether the server does is the first real run's
  job.
- **The Belgian list is the only national one offered**, because it is the
  only one the server has. The toggle shows whatever `player_sources` says.
- **A new tournament is not queued offline.** It needs a connection, on
  purpose.
- `npm audit` reports moderate advisories in `@capacitor/cli`'s `xcode`
  dependency. It is a build-time tool and never ships in the app.
