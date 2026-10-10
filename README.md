# Packout - FRC Scouting Workstation

A complete FIRST Robotics Competition scouting workstation for data analysis, alliance picklists, match video review, and computer vision AI robot tracking.

![Packout](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## Download

Grab the latest installer from the **[Releases page](https://github.com/cliclye/packout/releases/latest)**:

| Platform | File |
| --- | --- |
| macOS (Apple Silicon) | `Packout-<version>-arm64.dmg` — open it and drag Packout to Applications |
| Windows | `Packout-<version> Setup.exe` — run the installer |

The app is unsigned, so macOS may say it can't verify the developer: right-click the app → **Open** the first time
(or allow it in System Settings → Privacy & Security). Windows SmartScreen: **More info → Run anyway**.

Installers are built by GitHub Actions whenever a `v*` tag is pushed (`git tag v1.0.1 && git push --tags`).

## Features

- **Dashboard**: Overview of team rankings, efficiency, reliability, and data health
- **Picklist**: Customizable alliance selection strategies with multiple scoring models
- **Teams**: Deep-dive team statistics, pit data, and AI robot movement paths
- **Film Review**: Match footage review with synchronized scouting data and AI path tracing
- **Analysis**: Visual data comparison, scatter plots, and metric leaderboards
- **AI Analysis**: Computer vision robot tracking and automated trajectory extraction
- **Pit Scouting**: Robot chassis specifications, mechanisms, and inspection notes
- **Sync**: ADB phone transfer, folder monitoring, and dataset management
- **Competition Workspaces**: Separate data workspaces for each competition with easy switching

## Prerequisites

### Required Software

- **Node.js** (v22 or higher): [Download here](https://nodejs.org/)
- **npm** (comes with Node.js)
- **Git**: [Download here](https://git-scm.com/)

### Optional Dependencies (for full functionality)

- **ADB** (Android Debug Bridge) - For phone data transfer
  - Windows: Download from [Android Studio](https://developer.android.com/studio)
  - macOS: `brew install android-platform-tools`
- **Python 3.9–3.12** - For AI path tracing (the detector packages install from inside the app)
  - Windows: Download from [python.org](https://www.python.org/downloads/)
  - macOS: `brew install python@3.12`
- **yt-dlp** - For video downloading
  - Windows: Download from [yt-dlp GitHub](https://github.com/yt-dlp/yt-dlp)
  - macOS: `brew install yt-dlp`

## Installation

### Windows

1. **Clone the repository**
   ```bash
   git clone https://github.com/cliclye/packout.git
   cd packout
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Run the app**
   ```bash
   npm start
   ```

4. **Build for distribution** (optional)
   ```bash
   npm run make
   ```
   The built app will be in the `out/` directory.

### macOS

1. **Clone the repository**
   ```bash
   git clone https://github.com/cliclye/packout.git
   cd packout
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Run the app**
   ```bash
   npm start
   ```

4. **Build for distribution** (optional)
   ```bash
   npm run make
   ```
   The built app will be in the `out/` directory.

## Setup

### First Run

1. **Onboarding**: The app will guide you through initial setup
   - Welcome screen
   - Dependency check (ADB, Python, yt-dlp, ffmpeg)
   - Ready to start

2. **Create a Competition**
   - Click "+ New Competition" at the top
   - Select an event from the Blue Alliance dropdown
   - Confirm to add the competition

3. **Configure API Keys** (in Settings)
   - **Roboflow API Key**: Required for AI robot detection
     - Get your key at [roboflow.com](https://roboflow.com/)
   - **Blue Alliance API Key**: Required for schedule fetching
     - Get your key at [thebluealliance.com/account](https://www.thebluealliance.com/account)

### Data Import

There are several ways to import scouting data:

1. **Load Sample Data**: Click "Load Sample Data" in the Dashboard or Sync page
2. **Import from Folder**: Use the "Choose Folder" button in the Sync page
3. **ADB Phone Transfer**: Connect an Android phone and click "Start ADB Phone Transfer"
4. **Rescan Documents**: Click "Rescan Documents" to scan default folders

### Fetch Match Schedule

1. Go to **Settings**
2. Ensure you have a competition selected with an event key
3. Enter your Blue Alliance API key
4. Click "Fetch Event Schedule"

## Usage

### Competition Workspaces

- **Switch Competitions**: Use the dropdown at the top to switch between competitions
- **Create New**: Click "+ New Competition" and select from Blue Alliance events
- **Delete Competition**: Click "Delete" to remove the current competition (with confirmation)
- Each competition has its own isolated data workspace

### Dashboard

- View top 10 teams by pick score
- Check data health and risk metrics
- See upcoming matches from the schedule

### Picklist

- Customize Pick 1 and Pick 2 strategies
- Choose from: Balanced, Scoring, Defense, Reliability, Endgame
- View team rankings with strategy scores
- Export picklist to CSV

### Teams

- Browse all teams with detailed metrics
- View pit specifications
- See AI robot movement paths
- Check match history

### Film Review

- Select a match to review
- Download videos from YouTube (requires yt-dlp)
- Import local video files
- Jump to key timestamps (Auto, Teleop, Endgame)
- View synchronized scouting data

### Analysis

- **Overview** – league leaderboards, scatter plots and role mix, filterable by team or match.
- **Team deep dive** – everything derivable from the scouting data already collected:
  points by phase per match, accuracy trends, climb success by level, uptime and
  defense impact, consistency/floor/ceiling, form trend, percentile radar vs the
  field, auto-generated strengths and watch-outs, and (with AI paths) distance,
  speed and field-position stats.
- **Compare** – overlay up to four teams on one radar and see every metric side by side.

### AI Trace

Turns match video into robot paths using the same tracker as `scouting-ai`
(`src/main/scout.js` is a line-for-line port of `AIScout`, verified to produce
identical output to the Java version — see `test/scout.test.js`).

1. **Source** – video link, local file, or an existing detector `output.json`.
2. **Download & detect** – yt-dlp downloads 720p; the Roboflow detector runs in a
   private Python environment (installed from the page, needs Python 3.9–3.12 and
   your Roboflow key in Settings).
3. **Calibrate & track** – drag the four field corners on the preview frame, enter
   the teams (closest to camera first) and optionally the teleop start time.
4. **Review & import** – preview all six paths, then import into the competition
   (or export AIScout-format CSVs).

Analyses are kept per match, so you can re-track with a better calibration
without repeating the slow stages.

### Sync

- Load sample data
- Start/stop ADB phone transfer
- Import from custom folders
- Rescan default document folders
- View import log

## Configuration Files

### Data Storage

- Everything is stored in the app's user-data folder (`workspace.json`), not localStorage
- Each competition is its own workspace; use Sync → Backup to export one

### API Keys

- Roboflow API key: Stored in localStorage
- Blue Alliance API key: Stored in localStorage
- Can be updated in Settings at any time

## Troubleshooting

### App won't start

- Ensure Node.js v22+ is installed: `node --version`
- Delete `node_modules` and reinstall: `rm -rf node_modules && npm install`
- Check for port conflicts (default: 3000)

### ADB not detected

- Ensure ADB is installed and in your PATH
- macOS: `brew install android-platform-tools`
- Windows: Add Android SDK platform-tools to PATH
- Test with: `adb devices`

### Video download fails

- Ensure yt-dlp is installed: `yt-dlp --version`
- Check video URL is valid
- Verify network connection

### AI analysis fails

- Ensure Python 3 is installed: `python3 --version`
- Install the detector packages from the AI Trace page (Python 3.9–3.12 required)
- Check Roboflow API key is valid
- Verify scouting-ai directory exists

### Data not persisting

- Check browser localStorage is enabled
- Check for localStorage quota limits
- Clear app data and re-import

## Development

### Project Structure

```
packout-desktop/
├── src/
│   ├── index.js            # Electron main process (IPC, media protocol)
│   ├── preload.js          # Safe bridge exposed to the UI as window.packout
│   ├── main/               # scout.js (AIScout port), ai.js pipeline, importer, adb, storage…
│   ├── shared/             # models, analytics, path math (used by main + UI)
│   ├── resources/          # detector.py, bundled schedule
│   └── renderer/           # React UI: views/, components/, styles/, store.js
├── test/scout.test.js      # verifies the tracker against scouting-ai's Java output
├── forge.config.js
└── .github/workflows/      # builds .dmg / Setup.exe and publishes releases on v* tags
```

### Available Scripts

- `npm start` - Start development server
- `npm run make` - Build distributable app
- `npm run package` - Package without making distributables
- `npm run lint` - Run ESLint

## License

MIT License - see LICENSE file for details

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

For issues and questions, please open an issue on GitHub.

## Acknowledgments

- Built with [Electron](https://www.electronjs.org/)
- UI framework: [React](https://reactjs.org/)
- Data from [The Blue Alliance](https://www.thebluealliance.com/)
- AI detection with [Roboflow](https://roboflow.com/)
