const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const child_process = require('child_process');
const os = require('os');

let mainWindow;
let adbInterval;

// Default folders
const getDefaultPaths = () => {
  const home = os.homedir();
  return [
    path.join(home, 'Documents', 'ScoutingData'),
    path.join(home, 'Documents', 'PitData'),
    path.join(home, 'Documents', 'MatchVideos'),
    path.join(home, 'Documents', 'PACKVideos'),
    path.join(home, 'Documents', 'ScoutingAIData')
  ];
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    webPreferences: {
      contextIsolation: true,
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
    },
  });

  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return result.canceled ? null : result.filePaths;
});

ipcMain.handle('select-video', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Video files', extensions: ['mp4', 'mov', 'm4v', 'avi', 'mkv'] }
    ]
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('import-folder', async (event, folderPath) => {
  const results = { matchRecords: [], pitRecords: [], robotPaths: [], videoFiles: [] };
  
  const scanDir = (dir) => {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        scanDir(fullPath);
      } else {
        const ext = path.extname(file).toLowerCase();
        if (ext === '.json') {
          try {
            const content = fs.readFileSync(fullPath, 'utf8');
            const data = JSON.parse(content);
            if (data.matchNumber !== undefined) {
              results.matchRecords.push(data);
            } else if (data.teamNumber !== undefined) {
              results.pitRecords.push(data);
            }
          } catch (e) {
            console.error("Error parsing JSON:", fullPath, e);
          }
        } else if (ext === '.csv') {
          try {
            const content = fs.readFileSync(fullPath, 'utf8');
            const lines = content.split('\n');
            const pathPoints = [];
            for (const line of lines) {
              if (!line.trim()) continue;
              const [isAuto, x, y, time] = line.split(',');
              if (isAuto !== undefined && x !== undefined && y !== undefined && time !== undefined) {
                pathPoints.push({
                  isAuto: isAuto.trim() === 'true' || isAuto.trim() === '1',
                  x: parseFloat(x),
                  y: parseFloat(y),
                  time: parseFloat(time)
                });
              }
            }
            const digitsMatch = file.match(/\d+/);
            const team = digitsMatch ? parseInt(digitsMatch[0]) : null;
            if (team) {
              results.robotPaths.push({ team, pathPoints, file: fullPath });
            }
          } catch (e) {
            console.error("Error parsing CSV:", fullPath, e);
          }
        } else if (['.mp4', '.mov', '.mkv', '.avi', '.m4v'].includes(ext)) {
          results.videoFiles.push(fullPath);
        }
      }
    }
  };
  
  if (fs.existsSync(folderPath)) {
    scanDir(folderPath);
  }
  return results;
});

ipcMain.handle('export-csv', async (event, content, defaultPath) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultPath || 'export.csv',
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  });
  if (!result.canceled && result.filePath) {
    fs.writeFileSync(result.filePath, content, 'utf8');
    return result.filePath;
  }
  return null;
});

ipcMain.handle('get-default-folders', async () => {
  const folders = getDefaultPaths();
  return folders.map(f => ({
    path: f,
    exists: fs.existsSync(f)
  }));
});

ipcMain.handle('scan-default-folders', async () => {
  const folders = getDefaultPaths();
  for (const f of folders) {
    if (!fs.existsSync(f)) {
      fs.mkdirSync(f, { recursive: true });
    }
  }
  return true;
});

ipcMain.handle('read-schedule-file', async () => {
  try {
    let schedPath = path.join(app.getAppPath(), 'src', 'resources', 'schedule.txt');
    if (!fs.existsSync(schedPath) && process.resourcesPath) {
      schedPath = path.join(process.resourcesPath, 'schedule.txt');
    }
    
    if (fs.existsSync(schedPath)) {
      const content = fs.readFileSync(schedPath, 'utf8');
      const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      const matches = [];
      for (let i = 0; i < lines.length; i += 2) {
        if (i + 1 < lines.length) {
          const name = lines[i];
          const parts = lines[i+1].split('\t');
          if (parts.length >= 6) {
             const matchNumber = parseInt(name.replace(/\D/g, '') || "0", 10);
             matches.push({
               matchNumber: matchNumber,
               name: name,
               redTeams: [parts[0].trim(), parts[1].trim(), parts[2].trim()],
               blueTeams: [parts[3].trim(), parts[4].trim(), parts[5].trim()],
               timeLabel: parts.slice(6).join(' ').trim()
             });
          }
        }
      }
      return matches;
    }
    return [];
  } catch (e) {
    console.error("Error reading schedule:", e);
    return [];
  }
});

ipcMain.handle('fetch-blue-alliance', (event, endpoint, apiKey) => {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.thebluealliance.com',
      path: `/api/v3${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`,
      method: 'GET',
      headers: {
        'X-TBA-Auth-Key': apiKey,
        'User-Agent': 'Packout-Desktop'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });
    req.on('error', (e) => reject(e));
    req.end();
  });
});

ipcMain.handle('check-command', (event, command) => {
  return new Promise((resolve) => {
    child_process.exec(`which ${command}`, (error) => {
      resolve(!error);
    });
  });
});

ipcMain.handle('start-adb-transfer', (event, destination) => {
  if (adbInterval) return false;
  adbInterval = setInterval(() => {
    child_process.exec(`adb pull /sdcard/Documents/ScoutingData/ "${destination}"`, (error, stdout) => {
      if (!error && stdout.toLowerCase().includes('pulled')) {
         console.log("ADB Transfer Success:", stdout);
      }
    });
  }, 5000);
  return true;
});

ipcMain.handle('stop-adb-transfer', () => {
  if (adbInterval) {
    clearInterval(adbInterval);
    adbInterval = null;
    return true;
  }
  return false;
});

ipcMain.handle('download-video', async (event, url, destination, usingYtDlp = true) => {
  const downloadDir = path.join(app.getPath('userData'), 'DownloadedVideos');
  if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });
  const finalDest = destination || path.join(downloadDir, `match-${Date.now()}.mp4`);

  return new Promise((resolve, reject) => {
    if (usingYtDlp) {
      // Use yt-dlp with better options for reliability
      const cmd = `yt-dlp -f "best[ext=mp4]/best" -o "${finalDest}" --no-playlist "${url}"`;
      child_process.exec(cmd, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
        if (error) {
          console.error('yt-dlp error:', error);
          console.error('stderr:', stderr);
          reject(new Error(`Video download failed: ${error.message || stderr || 'Unknown error'}`));
        } else {
          if (fs.existsSync(finalDest)) {
            resolve({ path: finalDest, stdout });
          } else {
            reject(new Error('Video download completed but file not found'));
          }
        }
      });
    } else {
      const file = fs.createWriteStream(finalDest);
      https.get(url, (response) => {
        if (response.statusCode !== 200) {
          file.close();
          fs.unlink(finalDest, () => {});
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve({ path: finalDest, stdout: 'Downloaded via HTTP' });
        });
      }).on('error', (err) => {
        file.close();
        fs.unlink(finalDest, () => {});
        reject(err);
      });
    }
  });
});

ipcMain.handle('save-settings', async (event, settings) => {
  const settingsPath = path.join(app.getPath('userData'), 'settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  return true;
});

ipcMain.handle('load-settings', async () => {
  const settingsPath = path.join(app.getPath('userData'), 'settings.json');
  if (fs.existsSync(settingsPath)) {
    try {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch (e) {
      console.error("Error loading settings:", e);
    }
  }
  return {};
});
