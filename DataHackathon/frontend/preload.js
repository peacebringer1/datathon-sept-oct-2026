const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('appSettings', {
  saveClaudeApiKey: (apiKey) => ipcRenderer.invoke('settings:save-claude-key', apiKey),
  clearClaudeApiKey: () => ipcRenderer.invoke('settings:clear-claude-key'),
  exportTableToPDF: (payload) => ipcRenderer.invoke('export:table-pdf', payload),
  exportTableToExcel: (payload) => ipcRenderer.invoke('export:table-excel', payload)
});
