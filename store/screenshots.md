# Screenshots the stores need

Nobody has taken these yet: they need the app on a device or simulator
against a server with a tournament in progress. What is required, per
store, and which screens to take, so one session on a Mac and one on
Android Studio cover it.

## Which screens, in this order

The same six for both stores, in the app's light theme (dark versions of
the first two are a bonus, not a requirement):

1. **The round** - the home screen, boards with some results in, one
   board with the result sheet open. The first screenshot is the one the
   store shows in search results.
2. **A result just sent** with the outbox badge showing "1 waiting" -
   airplane mode on, to show the offline story.
3. **An incident** being written, with a photo attached.
4. **Standings** after a few rounds.
5. **Players** with the add/withdraw controls (organiser role).
6. **Servers** with two servers listed and the QR scanner button.

Use a demo tournament with real-looking names (an OpenPairings seed, not
"Player 1"). No personal data of real players.

## App Store (App Store Connect, *Media Manager*)

Required, up to 10 per size, PNG or JPEG, no alpha, no rounded corners
or device frames needed (Apple adds none; frames are allowed but not
required):

| Device class | Size (portrait) | Required |
|---|---|---|
| iPhone 6.9" (iPhone 16 Pro Max / 17 Pro Max) | 1320 x 2868 or 1290 x 2796 | **yes** - covers all iPhones |
| iPhone 6.5" (11 Pro Max / XS Max) | 1284 x 2778 or 1242 x 2688 | optional since 2024 (6.9" scales down) |
| iPad 13" (iPad Pro M4) | 2064 x 2752 or 2048 x 2732 | **yes**, because the app's `TARGETED_DEVICE_FAMILY` includes iPad; otherwise set it to iPhone-only in Xcode |

Simulators that give those sizes: *iPhone 16 Pro Max* (6.9"), *iPad Pro
13-inch (M4)*. `Cmd-S` in the Simulator saves a PNG at native resolution.

Also needed on the version page: nothing else is mandatory (the preview
video is optional).

## Google Play (Play Console, *Main store listing*)

| Asset | Size | Required |
|---|---|---|
| App icon | 512 x 512 PNG, 32-bit, no alpha needed | **yes** - `brand/assets/icon-only.png` scaled down |
| Feature graphic | 1024 x 500 PNG/JPEG | **yes** - the mark on the app's green with the name; make it from `brand/icon.svg` |
| Phone screenshots | 2 to 8, 16:9 to 9:16, each side 320-3840 px | **yes** - Pixel 8/9 at 1080 x 2400 |
| 7" tablet screenshots | up to 8 | optional (required only to be listed as tablet-designed) |
| 10" tablet screenshots | up to 8 | optional |

Android Studio's emulator: *Pixel 9* (1080 x 2400), the camera button in
the emulator toolbar saves a PNG.

## Also to hand before submitting

- A review account on a public OpenPairings server with a small running
  tournament, and the connect steps (both listings have the text).
- The privacy policy at a public URL (`store/privacy-policy.md`).
- For Play: the data-safety and content-rating answers in `store/play-store.md`.
