const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('appSettings', {
  saveGeminiApiKey: (apiKey) => ipcRenderer.invoke('settings:save-gemini-key', apiKey),
  clearGeminiApiKey: () => ipcRenderer.invoke('settings:clear-gemini-key')
});
