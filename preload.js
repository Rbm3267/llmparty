const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Status check
  checkLMStudioStatus: () => ipcRenderer.invoke('check-lmstudio-status'),
  
  // Stats
  getStats: () => ipcRenderer.invoke('get-stats'),
  saveStats: (stats) => ipcRenderer.invoke('save-stats', stats),

  // File system configurations
  readConfigs: () => ipcRenderer.invoke('read-configs'),
  saveConfigs: (configs) => ipcRenderer.invoke('save-configs', configs),
  resetConfigs: () => ipcRenderer.invoke('reset-configs'),

  // Model Operations
  getModels: () => ipcRenderer.invoke('get-models'),
  loadModel: (modelPath) => ipcRenderer.invoke('load-model', modelPath),
  unloadModel: () => ipcRenderer.invoke('unload-model'),

  // Tool Launchers
  launchClaudeCode: () => ipcRenderer.invoke('launch-claude-code'),
  launchAider: () => ipcRenderer.invoke('launch-aider'),
  startLMStudioServer: () => ipcRenderer.invoke('start-lmstudio'),
  stopLMStudioServer: () => ipcRenderer.invoke('stop-lmstudio'),

  // Log Tailer
  getLogs: (service, limit) => ipcRenderer.invoke('get-logs', service, limit),

  // Theme support
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
});
