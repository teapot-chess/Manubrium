# Releasing Manubrium

Two workflows build the packages: `.github/workflows/testflight.yml`
(iOS, uploads to App Store Connect) and `.github/workflows/android.yml`
(a signed `.apk`, put on this repository's GitHub releases, plus an `.aab`
kept as an artifact). Both run on **Run workflow** in the Actions tab and,
once their tag triggers are back on, on a tag `vX.Y.Z` that matches
`package.json`'s version. Neither needs a Mac or a keystore on anybody's
desk: everything that signs comes from the repository's secrets, listed
below with where each one is made.

**Android is not on Google Play.** A Play Console account for an
organisation wants a D-U-N-S number, a personal one wants twelve testers
for two weeks before anything goes public, and we have neither. So
Android phones install the `.apk` from GitHub, and the app looks for the
next one itself (*Sideloading* below). The `.aab` is still built, for the
day that changes.

Identity, fixed in three places that `cap sync` does not rewrite:
`capacitor.config.ts`, `ios/App/App.xcodeproj` (`PRODUCT_BUNDLE_IDENTIFIER`)
and `android/app/build.gradle` (`applicationId`, `namespace`):

| | |
|---|---|
| bundle id / application id | `cloud.pairings.manubrium` |
| name | Manubrium |
| version | `package.json` → `MARKETING_VERSION` / `versionName` |
| build number | the workflow's run number → `CURRENT_PROJECT_VERSION` / `versionCode` |

The build number rises on its own and is unique per workflow, which is all
either side asks (App Store Connect refuses a build number it has seen for
the same version; Android refuses to install an apk over one with a higher
`versionCode`, and Play would refuse a `versionCode` it has seen at all -
the two workflows count separately, which is fine). Do not rename or
re-create `android.yml`: GitHub numbers runs per workflow file, a new file
starts again at 1, and every phone already on a higher `versionCode`
would refuse the "update" as a downgrade. If it ever has to happen, add
the old run number to `APP_BUILD` in the workflow.

## Releasing a version

1. Bump `version` in `package.json` (and `package-lock.json`: `npm install`
   does it). Commit, push, let CI go green.
2. `git tag v0.1.0 && git push origin v0.1.0`. With the tag triggers on,
   both workflows run; while they are off (until December 2026), run them
   on the tag by hand: `gh workflow run android.yml --ref v0.1.0` (and the
   same for `testflight.yml`, after enabling it). The tag's version must
   equal `package.json`'s or they stop at once.
3. iOS: in App Store Connect, **TestFlight**, the build appears when
   Apple has processed it (minutes). Add it to the internal group; an
   external group needs Beta App Review.
4. Android: nothing to do. The run on the tag makes the GitHub release
   `v0.1.0`, marked latest, with `manubrium.apk`, the same file as
   `Manubrium-<version>-<build>.apk`, and `SHA256SUMS`. Phones that have
   the app are offered it within a day.

Every GitHub release must carry `manubrium.apk`: the stable link and the
app's update check read the *latest* release, and a release without the
file makes the link a 404 and the check say nothing. Only `android.yml`
makes releases (`testflight.yml` makes none), so a release is always an
Android one; do not make one by hand in the web page. A pre-release is
ignored by both, which makes it the way to publish a test apk.

Or press **Run workflow** on either, on a branch, for a build that is not
a release (the apk is in the run's artifact).

## Secrets

Set under **Settings > Secrets and variables > Actions** of the repository
(or of the organisation, scoped to this repository). The four marked
*exists* are already there from OpenPairings' Mac signing and are shared
across the organisation.

| Secret | What | Status |
|---|---|---|
| `APPLE_TEAM_ID` | the ten-character team id (Membership details) | exists |
| `ASC_KEY_ID` | App Store Connect API key id | exists |
| `ASC_ISSUER_ID` | App Store Connect API issuer id | exists |
| `ASC_KEY_P8` | the API key's `.p8` file, base64 | exists |
| `APPLE_DIST_CERT_P12` | the **Apple Distribution** certificate with its private key, as `.p12`, base64 | new |
| `APPLE_DIST_CERT_PASSWORD` | the `.p12`'s password | new |
| `APPLE_PROVISIONING_PROFILE` | the **App Store** provisioning profile for `cloud.pairings.manubrium`, the `.mobileprovision` file, base64 | new |
| `APPLE_EXTENSION_PROFILE` | the **App Store** profile for the Live Activity extension `cloud.pairings.manubrium.RoundActivity`, `.mobileprovision`, base64 | new in 1.2 |
| `ANDROID_KEYSTORE` | the release keystore, `.jks` (PKCS12), base64 | set 2026-11-24 |
| `ANDROID_KEYSTORE_PASSWORD` | its store password | set 2026-11-24 |
| `ANDROID_KEY_ALIAS` | the key's alias in it, `upload` | set 2026-11-24 |
| `ANDROID_KEY_PASSWORD` | the key's password (PKCS12: the same as the store password) | set 2026-11-24 |
| `GOOGLE_SERVICES_JSON` | Firebase's `google-services.json` for push, base64; optional - without it Android has no push | not set yet |

Base64 on a Mac or Linux: `base64 -i file | pbcopy` (Mac) or
`base64 -w0 file` (Linux); paste the one line as the secret's value.
On Windows: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("file")) | Set-Clipboard`.

The workflows check that the `.p12` opens with its password and that the
profiles are for `cloud.pairings.manubrium` and its extension (and that the app's carries push) before they spend minutes on
Xcode, and print a fingerprint of the `.p12` so a wrong file is told apart
from a wrong password.

### Apple: what to make, in order

Everything is at [developer.apple.com/account](https://developer.apple.com/account)
unless said otherwise. The existing `ASC_*` key must have the **App Manager**
role (or Admin) for uploads; a Developer-role key cannot upload builds.

1. **App ID** - *Certificates, Identifiers & Profiles > Identifiers > +*,
   *App IDs*, type App. Description "Manubrium", **explicit** bundle id
   `cloud.pairings.manubrium`. Capability: **Push Notifications** (since
   1.2; the camera, the local network and the keychain need none).

2. **Apple Distribution certificate** - *Certificates > +*, **Apple
   Distribution**. It wants a certificate signing request: on a Mac,
   Keychain Access, *Certificate Assistant > Request a Certificate From a
   Certificate Authority*, saved to disk. Download the `.cer`, double-click
   it into the login keychain, then in Keychain Access select the
   certificate **together with its private key**, *Export 2 items*, as
   `.p12`, with a password. That file is `APPLE_DIST_CERT_P12` and the
   password `APPLE_DIST_CERT_PASSWORD`. One distribution certificate serves
   every app of the team; a team may hold at most two, so reuse an existing
   one if there is one with its private key. (The *Developer ID Application*
   certificate OpenPairings uses for the Mac is a different kind and cannot
   sign for the App Store.)

   No Mac? `openssl` makes the request: `openssl req -new -newkey rsa:2048
   -nodes -keyout dist.key -out dist.csr -subj "/CN=Manubrium/C=BE"`, and
   after the download `openssl pkcs12 -export -inkey dist.key -in
   distribution.cer -out dist.p12` (`-in` may need the `.cer` converted
   first: `openssl x509 -inform der -in distribution.cer -out distribution.pem`).

3. **App Store provisioning profile** - *Profiles > +*, under Distribution
   **App Store Connect**, App ID `cloud.pairings.manubrium`, the certificate
   from step 2, name it `Manubrium App Store`. Download: that
   `.mobileprovision` is `APPLE_PROVISIONING_PROFILE`. The workflow reads
   the name from the file, so the name is free; the profile expires in a
   year and must then be regenerated and the secret replaced.

4. **The app in App Store Connect** -
   [appstoreconnect.apple.com](https://appstoreconnect.apple.com), *Apps > +*,
   *New App*: iOS, name "Manubrium", primary language English, bundle id
   `cloud.pairings.manubrium` (from step 1), SKU `manubrium`. Uploads
   fail until the app exists here.

5. After the first upload, in **TestFlight**: the export-compliance question
   is already answered by `ITSAppUsesNonExemptEncryption = false` in
   `Info.plist` (standard HTTPS only); add the internal testers.

### Push notifications and the Live Activity: what to make

Manubrium 1.2 adds notifications and the round on the lock screen. The app
side needs exactly **two new things from Apple and one from Google**; the
rest sits on each OpenPairings server. Nothing else changes.

Apple ([developer.apple.com/account](https://developer.apple.com/account)):

1. **Push on the app's App ID.** *Identifiers*, `cloud.pairings.manubrium`,
   tick **Push Notifications**, save. (Push changes the profile, so:)
2. **Make the app's profile again** (*Profiles*, `Manubrium App Store`,
   *Edit*, *Save*, download) and replace `APPLE_PROVISIONING_PROFILE`. The
   workflow refuses a profile without the push entitlement and says so.
3. **The extension's App ID.** *Identifiers > +*, App ID, explicit bundle id
   `cloud.pairings.manubrium.RoundActivity`, description "Manubrium round".
   No capabilities: a Live Activity needs none of its own.
4. **The extension's profile.** *Profiles > +*, **App Store Connect**, App ID
   `cloud.pairings.manubrium.RoundActivity`, the same distribution
   certificate, name it `Manubrium RoundActivity`. That `.mobileprovision`,
   base64, is the new secret `APPLE_EXTENSION_PROFILE`.
5. **One APNs key, for the servers.** *Keys > +*, tick **Apple Push
   Notifications service (APNs)**, environment *Sandbox & Production*,
   download the `.p8` (once - Apple keeps no copy). Note its Key ID. This
   key goes on each OpenPairings server that should push (`APNS_KEY_ID`,
   `APNS_TEAM_ID`, `APNS_KEY_PATH`: OpenPairings' `docs/manubrium.md`), not
   in this repository and not in a GitHub secret. One key serves every
   server, alerts and Live Activities, sandbox and production.

Google ([console.firebase.google.com](https://console.firebase.google.com)):

1. **A Firebase project** with an **Android app** `cloud.pairings.manubrium`.
   Download its `google-services.json`: base64, it is the secret
   `GOOGLE_SERVICES_JSON`. It is not secret in the cryptographic sense, but
   it stays out of git (`android/.gitignore`) so a fork does not push into
   our project. Without the secret the Android build simply has no push,
   and the app says so.
2. **A service account for the servers.** *Project settings > Service
   accounts > Generate new private key*. That JSON goes on each OpenPairings
   server that should push (`FCM_SERVICE_ACCOUNT_PATH`), never here.

Firebase does not care how the app got onto the phone: a sideloaded apk
gets pushes like a Play one, on any phone with Google Play services (most;
not Huawei's newer ones, nor de-Googled ROMs, which get "no notifications
here" like a build without the file). FCM needs no SHA fingerprint, so
the Firebase app needs only the package name. Push arrives with the first
release built after the secret is set; until then the Android app says it
cannot push and everything else works.

So the secrets in this repository grow by two (`APPLE_EXTENSION_PROFILE`,
`GOOGLE_SERVICES_JSON`), and each server that wants push gets two files
(the `.p8` and the service account). A server without them sends nothing;
the app tells its arbiters that server has no notifications.

### Sideloading: the Android route

**The key.** Without Play there is no Play App Signing: the key in
`ANDROID_KEYSTORE` is the app's key itself, and Android installs an
update only over an app signed with the same key. Lose it, or sign one
release with another, and every installed copy refuses every later
version; the only way out is uninstalling, which takes the phone's
outbox and its servers with it. So:

- The keystore and its passwords are in `C:\Users\jorian\.manubrium-signing\`
  on the owner's PC (`manubrium-upload.jks`, `passwords.txt`). That drive
  is backed up hourly off-site, which is the backup. It is not in any
  repository and must not be.
- Alias `upload` (the name is history; it is the release key now), RSA
  4096, valid until 2054. SHA-256 of its certificate:
  `F4:78:15:6B:2C:8C:A5:B8:BF:2D:C5:9D:08:1B:71:7E:DF:ED:A9:D6:02:64:B8:27:00:F5:85:94:9C:2E:37:B4`.
  The workflow checks every apk against it and a tag refuses any other, so a
  secret replaced by mistake fails the run instead of the phones.
- Should the app ever go to Play after all, give Play App Signing this
  same key (*Use existing app signing key*); then phones that sideloaded it
  can take Play's updates.

**The download.** `https://github.com/teapot-chess/Manubrium/releases/latest/download/manubrium.apk`
is always the newest. Open it on the phone; the first time, Android asks to
allow the browser (or the file manager) to install unknown apps, then
installs. Play Protect may ask to scan an app it has not seen before; let it.

**Updates.** The Android build asks
`api.github.com/repos/teapot-chess/Manubrium/releases/latest` on start and
when it comes back to the front, at most once a day, and when a newer
version has a `manubrium.apk`, offers it: *Download* opens the file's link
in the phone's browser, which downloads it, and tapping it brings up the
installer. It is not an installer inside the app on purpose: that would
need `REQUEST_INSTALL_PACKAGES` (a permission Play Protect and Play both
treat as sensitive), a native plug-in, a FileProvider for a file of our
own and handling a download the hall's wifi drops halfway; the browser has
all of that already and the installer screen is the same. The check is an
anonymous GET with nothing of the phone's in it, and can be switched off
under *More, This phone*, which also has *Check now*. Code:
`src/update.ts`, `src/ui/Update.tsx`.

**Google's developer verification.** Google announced in 2025 that
certified Android phones will install only apps whose developer is
verified with Google, sideloaded ones included: from September 2026 in
Brazil, Indonesia, Singapore and Thailand, worldwide from 2027. Verifying
happens in the *Android Developer Console* (not the Play Console): an
identity check, and the package name `cloud.pairings.manubrium` registered
with the certificate above. An organisation is asked for a D-U-N-S
number there too; a person verifies with an ID, which is the way open to
us. Google also promised a free tier for small distribution and a flow
for experienced users to install unverified apps anyway. Check the
current rules before the rollout reaches Belgium and register the package
with this key then; nothing in the workflow changes, because the apk is
already signed with the key that will be registered.

### Google Play, if it ever happens

1. **The keystore.** It exists (above); do not make a new one. For the
   record, it was made with:

       keytool -genkeypair -keystore manubrium-upload.jks -storetype PKCS12 \
         -alias upload -keyalg RSA -keysize 4096 -validity 10000 \
         -dname "CN=Manubrium, O=teapot-chess, C=BE"

   with a random 32-character password (PKCS12 has one for the store and
   the key), set as the secrets with `gh secret set NAME < file` so that
   it was never printed.

2. **The app in the Play Console** - [play.google.com/console](https://play.google.com/console),
   *Create app*: name "Manubrium", app, free, the declarations. The
   application id is fixed by the first bundle uploaded; it will be
   `cloud.pairings.manubrium`.

3. **Play App Signing** - on the first upload, choose *Use existing app
   signing key* and hand Google this keystore's key (the Console's PEPK
   tool), not Google-managed signing: phones that sideloaded the apk only
   take updates signed with it.

4. The store listing, the data-safety form and the content rating are
   filled from `store/play-store.md` and `store/privacy-policy.md`;
   the policy must also be at a public URL (the OpenPairings site can host
   it).

### Rotating or revoking

Replace the secret and run the workflow; nothing is cached. An expired
provisioning profile or distribution certificate fails the *Import* step
with Apple's reason in the log. The App Store Connect key is shared with
OpenPairings' Mac signing: revoking it breaks both.

## What the workflows do not do

- Take screenshots. `store/screenshots.md` says which are needed.
- Upload to Google Play. There is no Play listing; the `.aab` is an artifact.
- Test the update check on a phone. The tests cover the version
  comparison, the daily limit and what counts as a release with an apk;
  the browser hand-off and the installer are Android's.
- Build a signed package on a pull request. `ci.yml` runs the unit tests,
  the type check, the web build and `npx cap sync` (which catches a plugin
  that both native projects cannot take), and compiles the iOS project with
  its widget extension for the simulator, unsigned - no secrets.
