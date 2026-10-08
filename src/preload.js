const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  selectVideo: () => ipcRenderer.invoke('select-video'),
  importFolder: (folderPath) => ipcRenderer.invoke('import-folder', folderPath),
  exportCsv: (content, defaultPath) => ipcRenderer.invoke('export-csv', content, defaultPath),
  scanDefaultFolders: () => ipcRenderer.invoke('scan-default-folders'),
  getDefaultFolders: () => ipcRenderer.invoke('get-default-folders'),
  readScheduleFile: () => ipcRenderer.invoke('read-schedule-file'),
  fetchBlueAlliance: (endpoint, apiKey) => ipcRenderer.invoke('fetch-blue-alliance', endpoint, apiKey),
  checkCommand: (command) => ipcRenderer.invoke('check-command', command),
  startAdbTransfer: (destination) => ipcRenderer.invoke('start-adb-transfer', destination),
  stopAdbTransfer: () => ipcRenderer.invoke('stop-adb-transfer'),
  downloadVideo: (url, destination, usingYtDlp) => ipcRenderer.invoke('download-video', url, destination, usingYtDlp),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  loadSettings: () => ipcRenderer.invoke('load-settings')
});
