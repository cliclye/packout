# Packout on the phone (drive coach)

> This lives on the `phone-integration` branch. To drop it, delete the branch — `main` doesn't depend on it.
> Preview builds from this branch are tagged `vX.Y.Z-phone` and published as *pre-releases*.

Packout builds a **coach pack** — one small JSON file with the schedule, scores, win probabilities,
your team's game plans for its next matches, and a card for every team — and gets it onto a phone.

**FRC events don't allow Wi-Fi or hotspots, so the main way is a QR code that carries the data itself.**
Packout compresses the pack (~8 KB) and shows it as a short looping series of QR codes (about 25 frames,
8 seconds per loop). The iPhone app's camera collects every frame, checks them, and rebuilds the pack.
No network, cable or server involved — and it works for repeat updates between matches.

| | iPhone / iPad (native app) | Android (or any browser) |
| --- | --- | --- |
| Get data, **no network** | **Phone → Show QR code**, then in the app *Data → Scan from computer screen* | **Phone → Send via USB** (cable, uses `adb reverse`) |
| Practice / home | Same Wi-Fi: *Start sharing*, scan the link QR | Same, in the browser |
| Anywhere | AirDrop / Files the `.packoutcoach` file | Import it on the web page |
| Offline afterwards | Yes, last copy kept on the phone | Yes, kept in the browser |

## Getting the iPhone app

Apple only lets *signed* apps run on a phone, so a downloaded app can't be double-clicked like the Mac one.
Pick one (do it at home, before the event — it needs internet once):

1. **Sideloadly or AltStore (no Mac needed)** — download `PackoutCoach-<version>-unsigned.ipa` from the
   [latest release](https://github.com/cliclye/packout/releases/latest), plug in your iPhone and install it with
   [Sideloadly](https://sideloadly.io) (Mac/Windows) or [AltStore](https://altstore.io) using your own free Apple ID.
   Free Apple IDs expire the app after **7 days** — re-install before each event (a paid $99 developer account lasts a year).
2. **Xcode (Mac)** — open `mobile/ios-coach/PackoutCoach.xcodeproj`, choose your iPhone, set your Apple ID under
   *Signing & Capabilities → Team*, press Run. Then trust the profile in Settings → General → VPN & Device Management.
3. **TestFlight / App Store** — needs a paid Apple Developer account; the project is ready to archive when the team wants it.

The project is generated from `project.yml` (`brew install xcodegen && xcodegen generate`).

## At the event

1. In Packout open **Phone**, enter your team number, press **Show QR code**.
2. On the phone open **Packout Coach → Data → Scan from computer screen**, point it at the screen (20–30 cm)
   until all boxes turn green. If a frame keeps failing, pick *Easier* codes in the QR window.
3. Press **Refresh data** in the QR window (or reopen it) before each match to send new scores and plans.

## Coach pack format (v1)

`format: "packout-coach"`, `version: 1`, `generatedAt`, `competition`, `event`, `myTeam`, `summary`,
`matches[]` (label, time, red/blue teams, scores, win probability `pRed`, projected scores),
`teams{}` (scouting stats, TBA rank/OPR, strengths and risks), `plans{matchKey}` (win chance, ranked
recommendations, partner/opponent roles, notes) and `rankings[]`. Readers must ignore unknown fields.
A sample generated from a real event is in `sample/coach-sample.json`.

## Security

The QR transfer uses no network. The optional Wi-Fi endpoint needs the secret key from its link and only runs while
*Start sharing* is on; it never leaves your local network.

Frame format for the QR stream: `PK1.<session>.<index>.<total>.<crc32>.<base64 slice>` of the raw-deflate-compressed JSON
(see `src/shared/qrframes.js` and `ios-coach/Sources/FrameAssembler.swift`).
