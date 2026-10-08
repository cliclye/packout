# Packout - FRC Scouting Workstation

A complete FIRST Robotics Competition scouting workstation for data analysis, alliance picklists, match video review, and computer vision AI robot tracking.

![Packout](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)
![License](https://img.shields.io/badge/license-MIT-green)

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

- **Node.js** (v18 or higher): [Download here](https://nodejs.org/)
- **npm** (comes with Node.js)
- **Git**: [Download here](https://git-scm.com/)

### Optional Dependencies (for full functionality)

- **ADB** (Android Debug Bridge) - For phone data transfer
  - Windows: Download from [Android Studio](https://developer.android.com/studio)
  - macOS: `brew install android-platform-tools`
- **Python 3** - For AI analysis
  - Windows: Download from [python.org](https://www.python.org/downloads/)
  - macOS: `brew install python@3.12`
- **Java** - For path analysis
  - Windows: Download from [Adoptium](https://adoptium.net/)
  - macOS: `brew install openjdk`
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
   - Dependency check (ADB, Python, Java, yt-dlp)
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

### AI Analysis

- Enter match video URL
- Configure alliance teams
- Download video
- Run Roboflow AI detection
- Execute path analysis
- Import generated path data

### Sync

- Load sample data
- Start/stop ADB phone transfer
- Import from custom folders
- Rescan default document folders
- View import log

## Configuration Files

### Data Storage

- Competition data is stored in localStorage
- Each competition's data is saved separately
- Data persists between app launches

### API Keys

- Roboflow API key: Stored in localStorage
- Blue Alliance API key: Stored in localStorage
- Can be updated in Settings at any time

## Troubleshooting

### App won't start

- Ensure Node.js v18+ is installed: `node --version`
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
- Ensure Java is installed: `java -version`
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
│   ├── index.js           # Electron main process
│   ├── preload.js         # Preload script for IPC
│   ├── store.js           # State management
│   ├── models.js          # Data models
│   ├── analytics.js       # Analytics calculations
│   └── renderer/
│       ├── App.jsx        # Main React component
│       ├── App.css        # Styles
│       └── index.jsx      # React entry point
├── package.json
├── forge.config.js        # Electron Forge config
├── webpack.main.config.js # Main process webpack config
└── webpack.renderer.config.js # Renderer webpack config
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
