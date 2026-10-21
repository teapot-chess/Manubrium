# Google Play listing

Copy for the Play Console, *Main store listing* and the policy forms.
Lengths are Google's limits.

**App name** (30): Manubrium

**Short description** (80):
Run your OpenPairings chess tournament from the playing hall.

**Full description** (4000):

Manubrium is the phone companion to OpenPairings, the open tournament manager for chess. Connect it to your OpenPairings server - the hosted one at pairings.cloud or a copy running on a laptop in the playing hall - and run the tournament from where the games are.

<b>The round is the home screen.</b> Every board, every result, as it stands. Tap a board, tap the result, done. The entry is sent at once, or kept in an outbox and sent when the hall's network comes back; nothing is lost and nothing is sent twice.

<b>For the arbiter.</b> Enter results and log incidents from the floor, with a photo of the scoresheet or the clock when it matters. What has been sent, what is waiting and what the server refused is always visible.

<b>For the organiser.</b> Pair the next round, publish it, read the standings, add a late player or withdraw one - from the phone, as soon as the last result is in.

<b>Several servers, one app.</b> Connect to as many OpenPairings servers as you work with. A connect code on your account page links the phone in one scan; each phone gets its own token, which the account page can revoke.

<b>Plain and offline-first.</b> No sign-up, no analytics, no account of its own. The app talks only to the servers you add and stores only what it needs to reach them. It follows the phone's light or dark theme.

Manubrium needs an OpenPairings server (version 1.0 or later) with the mobile API switched on, and an account on it. The server and its documentation are at pairings.cloud. Manubrium is free software under the Apache License 2.0; the source is at github.com/teapot-chess/Manubrium.

**Category:** Sports. **Tags:** chess, tournament, sports management.

**Contact email:** (the organisation's support address). **Website:**
https://pairings.cloud. **Privacy policy URL:** the published
`store/privacy-policy.md`.

**Release notes** (500, first version):
First release: results, incidents, pairing, publishing, standings and players, with an outbox for the hall's dead spots.

## Policy forms

**Data safety**

- Does the app collect or share any of the required user data types?
  **Yes.**
- Is all of the user data collected by the app encrypted in transit?
  **Yes** - HTTPS to any server not on the hall's own network; plain http
  is accepted only for private addresses (10/8, 172.16/12, 192.168/16,
  link-local, `.local`), where the server is in the same room.
- Do you provide a way for users to request that their data is deleted?
  **Yes** - removing the server in the app deletes the phone's token
  (the account page on the server also revokes it); the account is the
  server's to delete.

| Data type | Collected | Shared | Processed ephemerally | Required | Purpose |
|---|---|---|---|---|---|
| Photos and videos > Photos | Yes, only when the user attaches one to an incident | No | No | Optional | App functionality |
| App activity > Other user-generated content (results, incidents) | Yes | No | No | Required | App functionality |
| App info and performance > Crash logs, Diagnostics | No | - | - | - | - |
| Device or other IDs | No | - | - | - | - |
| Personal info | No (the server shows the account's name/email to the app; the app sends none) | - | - | - | - |

"Collected" here means sent to the OpenPairings server the user added;
there is no other recipient and no third-party SDK. The device token is
issued by that server and stays in the phone's keystore.

**Ads:** no. **App access:** restricted - give a review account (server
URL, email, password) with a small running tournament and the steps:
sign in on the server in a browser, *Account > Manubrium app > Connect a
phone*, scan the QR code with the app or paste the link under it into
*Add a server*.

**Content rating (IARC):** Utility/productivity; none of the questions
apply; expected Everyone / PEGI 3.

**Target audience:** 18 and over (arbiters and organisers; it is not
designed for children). **News app:** no. **COVID-19 contact tracing:**
no. **Government app:** no. **Financial features:** none. **Health:** none.

**Permissions declared:** `INTERNET`, `CAMERA` (QR code and incident
photos; the camera is declared not required). No location, no contacts,
no background location, no `READ_MEDIA_*` - an existing photo is picked
through the system photo picker, which needs no permission.
