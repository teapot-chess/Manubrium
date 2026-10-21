# App Store listing

Copy for App Store Connect, *App Information* and the version page. Lengths
are Apple's limits.

**Name** (30): Manubrium

**Subtitle** (30): Run the chess tournament from the hall

**Primary category:** Sports. **Secondary:** Utilities.

**Keywords** (100, comma-separated, no spaces after commas):
`chess,tournament,arbiter,pairings,swiss,results,standings,openpairings,round,FIDE`

**Promotional text** (170, editable without a new build):
For organisers and arbiters whose tournament runs on OpenPairings. Results from the boards, pairing and publishing from your pocket, offline in the hall.

**Description** (4000):

Manubrium is the phone companion to OpenPairings, the open tournament manager for chess. Connect it to your OpenPairings server - the hosted one at pairings.cloud or a copy running on a laptop in the playing hall - and run the tournament from where the games are.

THE ROUND IS THE HOME SCREEN
Every board, every result, as it stands. Tap a board, tap the result, done. The entry is sent at once, or kept in an outbox and sent when the hall's network comes back; nothing is lost and nothing is sent twice.

FOR THE ARBITER
Enter results and log incidents from the floor, with a photo of the scoresheet or the clock when it matters. What has already been sent, what is still waiting and what the server refused is always visible.

FOR THE ORGANISER
Start a tournament, add players straight from the FIDE or Belgian rating list, tick them off as they arrive, record their requested byes. Pair the next round, publish it, share the pairings and the standings - from the phone, as soon as the last result is in.

HALL BOARDS
With Alnasl in the hall, what each electronic board saw sits small beside its pairing, in red when it disagrees with the result entered. A board never enters a result; the arbiter does.

SEVERAL SERVERS, ONE APP
Connect to as many OpenPairings servers as you work with. A connect code on your account page links the phone in one scan; each phone gets its own token, which the account page can revoke.

PLAIN AND OFFLINE-FIRST
No sign-up, no analytics, no account of its own. The app talks only to the servers you add and stores only what it needs to reach them. It follows the phone's light or dark setting.

Manubrium needs an OpenPairings server (version 0.101 or later) with the mobile API switched on, and an account on it. The server, and its documentation, are at pairings.cloud. Manubrium is free software under the Apache License 2.0.

**What's new** (first version):
First release: results, incidents, pairing, publishing, standings, players, new tournaments, byes, sharing and hall boards, with an outbox for the hall's dead spots.

**Support URL:** https://pairings.cloud/help
**Marketing URL:** https://pairings.cloud
**Privacy policy URL:** https://pairings.cloud/help/manubrium-privacy
**Copyright:** 2026 teapot-chess contributors

**Age rating:** none of the content descriptors apply; 4+.

**App Review notes:**
The app needs an OpenPairings account. A review account with a small running tournament: *(server URL, email, password, to be filled in before submission)*. Sign in on that server in a browser, open Account > Manubrium app > Connect a phone, and scan the QR code with the app, or paste the link under it into "Add a server". The camera is used for that QR code and for incident photos; the local-network prompt only appears for a server on a private address.

## App privacy (the questionnaire)

Data collection: **Yes, we collect data from this app** - then only:

| Data type | Collected? | Linked to the user | Used for tracking | Purpose |
|---|---|---|---|---|
| Contact info > Email address | No (the server has it; the app only shows it) | - | - | - |
| User content > Photos | Yes, when the user attaches one to an incident | Yes (to the account on that server) | No | App functionality |
| User content > Other (results, incidents) | Yes | Yes | No | App functionality |
| Identifiers > Device ID | No - the device token is created by the server and is not a device identifier | - | - | - |
| Diagnostics | No | - | - | - |
| Usage data | No | - | - | - |

Everything the app sends goes to the OpenPairings server the user added,
and to nothing else; there is no third-party SDK. Tracking: **No**. The
answers above describe the app as a client; the servers' own policies
describe what they keep.

**Export compliance:** only standard HTTPS (`ITSAppUsesNonExemptEncryption`
is `false` in Info.plist, so the question does not appear per build).

**Content rights:** the app contains no third-party content.
