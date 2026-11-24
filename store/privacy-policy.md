# Manubrium privacy policy

*Effective 2026-11-24. Applies to the Manubrium app for iOS and Android.*

Manubrium is a phone app for running a chess tournament that is managed
on an [OpenPairings](https://pairings.cloud) server. The app is a client:
it has no servers, no accounts and no analytics of its own.

## What the app talks to

Only the OpenPairings servers you add to it yourself, by scanning or
pasting a connect link from your account page on that server. The one
exception is notifications, if you switch them on: those are delivered
through Apple's or Google's push service (see *Notifications and push
tokens* below). There is no advertising, no analytics and no crash
reporting in the app. On Android it contains two Google libraries, for
two jobs only: Firebase Cloud Messaging, to receive notifications, and
ML Kit barcode scanning, to read QR codes on the phone (see *Camera and
photos*).

Connections use HTTPS. Plain HTTP is accepted only for a server on a
private network address (the hall's own network, where a copy of
OpenPairings runs on a laptop in the same room), because such a server
has no certificate; the app refuses plain HTTP to any public address.

## What the app stores on the phone

- **A device token for each server you added**, issued by that server
  when you connected, in the iOS Keychain or the Android Keystore. It
  identifies this phone to that server and nothing else. Removing the
  server in the app deletes it; the account page on the server can revoke
  it at any time, after which the phone is signed out.
- **The server's name and address, and the name and role your account
  has there**, as the server reported them, so the app can show them.
- **An outbox** of results and incidents entered while the phone had no
  connection (with the photo of an incident, if you took one), until the
  server has accepted them. The outbox is kept in the app's own storage,
  not in the Keychain or Keystore.
- **The phone's push token**, once you have switched notifications on,
  and your choices about notifications and the lock screen (see below).

The app keeps no cache of rounds or standings: it asks the server each
time. The app opts out of Android's cloud backup and device transfer, so
none of this is copied to Google. Deleting the app deletes what it stored
on the phone; what you sent to a server stays on that server, under its
operator's terms.

## What the app sends to a server

What you enter: results, incidents with their text and, when you attach
one, a photo; pairing, publishing, player, bye and settings changes, new
tournaments, and the names you search for in the rating lists, when your
role allows them. Each is sent to the one server the tournament lives on,
under your account there. That server's operator is the controller of
that data; the server's own privacy terms apply to it (for the hosted
service at pairings.cloud, its terms page).

## Notifications and push tokens

Notifications are off until you switch them on: the round screen offers
them once, and the Servers screen can switch them on later. Only then
does the phone's system give the app a **push token**: an address that
Apple (on an iPhone) or Google's Firebase Cloud Messaging (on Android)
uses to deliver a notification to this app on this phone. It does not
contain your name, your account or anything you entered. On an iPhone,
the round on the lock screen (a Live Activity) has push tokens of the
same kind, one per activity, and on iOS 17.2 and later one more that lets
a server start the activity again.

**What is stored, and where.** The app keeps the token on the phone. It
sends it, only to the servers you added that can send notifications, with
what each server needs to use it: which service it belongs to (Apple or
Google), whether the app is a store build or a test build, which events
you chose (a round paired or published, a result or incident from the
hall, the default time), and that server's address as the app knows it.
For the lock screen the server also keeps which tournament and round the
activity shows, and the short texts it draws it with, in the app's
language.

**Why.** So that server can tell you, through Apple or Google, about the
events you chose, and keep the round on your lock screen current. The
server sends the notification text (for example "Round 5 is paired") and
the tournament it is about; Apple or Google carries it to the phone. The
token is used for nothing else, and the app never sends it anywhere but
to your servers.

**Deletion.** Switching an event off on the Servers screen tells that
server to stop sending it. Switching the lock screen off takes those
tokens back from every server. Removing a server from the app deletes the
phone's push registration on that server before the phone signs out (if
the server is out of reach, the app tries again later); revoking the
phone on the account page deletes it too. Turning notifications off in
the phone's settings stops delivery at once. Deleting the app makes the
token worthless; a server that hears so from Apple or Google deletes it.

## Camera and photos

The camera is used to scan the QR code that connects the app to a server,
to scan the code on a result slip, a place card or a team match slip so
the right board or match opens, and, when you choose, to photograph an
incident (a scoresheet, a clock) for the arbiter's log.

Scanning happens on the phone. The code is read on the device (on
Android by Google's ML Kit library, which is inside the app), the picture
is not kept and is not sent anywhere, and the text of the code is used
only to open what it points to. A scanned slip is not stored; nothing is
sent to the server except the ordinary request for that board, as if you
had tapped it.

The photo library is read only when you pick an existing photo for an
incident. No image leaves the phone except as that incident attachment,
to that server.

## Local network

On iOS the system asks once before the app may talk to devices on the
local network. The app needs it only to reach a copy of OpenPairings on
the hall's own network. Refusing it leaves the hosted service reachable.

## Children

The app is made for tournament arbiters and organisers and is not
directed at children.

## Changes and contact

Changes to this policy appear in the app's repository history at
[github.com/teapot-chess/Manubrium](https://github.com/teapot-chess/Manubrium)
and on this page with a new effective date. Questions: the contact
address on [pairings.cloud](https://pairings.cloud).
