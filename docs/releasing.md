# Releasing Manubrium to the stores

Two workflows build the store packages: `.github/workflows/testflight.yml`
(iOS, uploads to App Store Connect) and `.github/workflows/android.yml`
(a signed `.aab` and `.apk`). Both run on **Run workflow** in the Actions tab
and on a tag `vX.Y.Z` that matches `package.json`'s version. Neither needs
a Mac or a keystore on anybody's desk: everything that signs comes from the
repository's secrets, listed below with where each one is made.

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
either store asks (App Store Connect refuses a build number it has seen for
the same version; Play refuses a `versionCode` it has seen at all - the two
workflows count separately, which is fine, since the stores do too).

## Releasing a version

1. Bump `version` in `package.json` (and `package-lock.json`: `npm install`
   does it). Commit, push, let CI go green.
2. `git tag v0.1.0 && git push origin v0.1.0`. Both workflows run; the
   tag's version must equal `package.json`'s or they stop at once.
3. iOS: in App Store Connect, **TestFlight**, the build appears when
   Apple has processed it (minutes). Add it to the internal group; an
   external group needs Beta App Review.
4. Android: download the artifact `Manubrium-android-<version>-<build>`
   from the run and upload the `.aab` in the Play Console under
   **Testing > Internal testing > Create new release**. (Play has an API
   for this; it needs a service account, which is not set up. Upload by
   hand until it is.)

Or press **Run workflow** on either, with no tag, for a build that is not
a release.

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
| `ANDROID_KEYSTORE` | the upload keystore, `.jks`, base64 | new |
| `ANDROID_KEYSTORE_PASSWORD` | its store password | new |
| `ANDROID_KEY_ALIAS` | the key's alias in it | new |
| `ANDROID_KEY_PASSWORD` | the key's password | new |

Base64 on a Mac or Linux: `base64 -i file | pbcopy` (Mac) or
`base64 -w0 file` (Linux); paste the one line as the secret's value.
On Windows: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("file")) | Set-Clipboard`.

The workflows check that the `.p12` opens with its password and that the
profile is for `cloud.pairings.manubrium` before they spend minutes on
Xcode, and print a fingerprint of the `.p12` so a wrong file is told apart
from a wrong password.

### Apple: what to make, in order

Everything is at [developer.apple.com/account](https://developer.apple.com/account)
unless said otherwise. The existing `ASC_*` key must have the **App Manager**
role (or Admin) for uploads; a Developer-role key cannot upload builds.

1. **App ID** - *Certificates, Identifiers & Profiles > Identifiers > +*,
   *App IDs*, type App. Description "Manubrium", **explicit** bundle id
   `cloud.pairings.manubrium`. No capabilities are needed (the camera,
   the local network and the keychain need none).

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

### Google: what to make, in order

1. **The upload keystore.** Play App Signing holds the real app key; the
   repository holds only the *upload* key, which Google can reset if lost.
   With any JDK:

       keytool -genkeypair -v -keystore manubrium-upload.jks -alias upload \
         -keyalg RSA -keysize 4096 -validity 10000 \
         -dname "CN=Manubrium, O=teapot-chess, C=BE"

   It asks for the store password and (with recent keytool, the same) key
   password. The file, base64, is `ANDROID_KEYSTORE`; the passwords are
   `ANDROID_KEYSTORE_PASSWORD` and `ANDROID_KEY_PASSWORD`; `ANDROID_KEY_ALIAS`
   is `upload`. Keep the `.jks` somewhere that is not this repository, too.

2. **The app in the Play Console** - [play.google.com/console](https://play.google.com/console),
   *Create app*: name "Manubrium", app, free, the declarations. The
   application id is fixed by the first bundle uploaded; it will be
   `cloud.pairings.manubrium`.

3. **Play App Signing** - on the first upload under *Testing > Internal
   testing*, accept Google-managed signing (the default). Google derives
   the upload certificate from that first `.aab`; later uploads must be
   signed with the same key, hence the secret.

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
- Upload to Google Play. The `.aab` is an artifact; upload it by hand.
- Build on a pull request. `ci.yml` runs the unit tests, the type check,
  the web build and `npx cap sync` (which catches a plugin that both
  native projects cannot take) - no SDK, no signing.
