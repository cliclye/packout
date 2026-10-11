# Packout on the phone (drive coach)

Packout builds a **coach pack** — one small JSON file with the schedule, scores, win probabilities,
your team's game plans for its next matches, and a card for every team — and puts it on a phone.
Two phone apps read it:

| | Android (or any browser) | iPhone / iPad |
| --- | --- | --- |
| App | Web app served by Packout (`src/resources/coach`) | Native SwiftUI app (`mobile/ios-coach`) |
| Install | Nothing | Build once with Xcode (below) |
| Get the data | **USB cable**: Phone page → *Send via USB* (uses `adb reverse`) · or scan the QR code on the same Wi-Fi | Same Wi-Fi, **or** USB cable with *Personal Hotspot* on, then scan the QR code · or AirDrop the `.packoutcoach` file |
| Offline | Keeps its last copy in the browser | Keeps its last copy on the phone |

In Packout open **Phone**, enter your team number, then press the button for your phone.
While *Start sharing* is on, Packout refreshes the pack every 30 seconds and the phone updates itself.

## iPhone app (Packout Coach)

Needs a Mac with Xcode and an Apple ID (a free one works; the app stays installed for 7 days, then re-run it).

1. Plug the iPhone into the Mac, unlock it and tap **Trust**.
2. Open `mobile/ios-coach/PackoutCoach.xcodeproj` in Xcode.
3. Select the **PackoutCoach** target → *Signing & Capabilities* → pick your **Team** (your Apple ID).
   If Xcode says the bundle id is taken, change `com.packout.coach` to something unique.
4. Choose your iPhone at the top and press **Run ▶**. On the phone: Settings → General → VPN & Device Management → trust your developer profile (first time only).
5. In the app open **Connect** and scan the QR code from Packout's Phone page, or import a `.packoutcoach` file.

The project is generated from `project.yml` (`brew install xcodegen && xcodegen generate`).

## Coach pack format (v1)

`format: "packout-coach"`, `version: 1`, `generatedAt`, `competition`, `event`, `myTeam`, `summary`,
`matches[]` (label, time, red/blue teams, scores, win probability `pRed`, projected scores),
`teams{}` (scouting stats, TBA rank/OPR, strengths and risks), `plans{matchKey}` (win chance, ranked
recommendations, partner/opponent roles, notes) and `rankings[]`. Readers must ignore unknown fields.
A sample generated from a real event is in `sample/coach-sample.json`.

## Security

The data endpoint needs the secret key from the QR code/link and only runs while *Start sharing* is on.
It never leaves your network (or the USB cable).
