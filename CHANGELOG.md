# Changelog

What changed in Manubrium, newest first. The server side of each change is in
OpenPairings' own changelog.

## [Unreleased]

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
