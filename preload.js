'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quotaHalo', {
  getSettings: () => ipcRenderer.invoke('quotahalo:get-settings'),
  updateSettings: (patch) => ipcRenderer.invoke('quotahalo:update-settings', patch),
  resetSettings: () => ipcRenderer.invoke('quotahalo:reset-settings'),
  getSnapshot: (options) => ipcRenderer.invoke('quotahalo:get-snapshot', options),
  chooseSource: () => ipcRenderer.invoke('quotahalo:choose-source'),
  openSource: () => ipcRenderer.invoke('quotahalo:open-source'),
  windowAction: (action) => ipcRenderer.invoke('quotahalo:window-action', action),
  onRefresh: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('quotahalo:refresh', handler);
    return () => ipcRenderer.removeListener('quotahalo:refresh', handler);
  },
  onSettingsChanged: (callback) => {
    const handler = (_event, nextSettings) => callback(nextSettings);
    ipcRenderer.on('quotahalo:settings-changed', handler);
    return () => ipcRenderer.removeListener('quotahalo:settings-changed', handler);
  },
});
