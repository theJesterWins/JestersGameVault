const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("vaultAPI", {
  getAppInfo: () => ipcRenderer.invoke("app:info"),
  copyText: (text) => ipcRenderer.invoke("app:copy-text", text),
  listLocal: (targetPath) => ipcRenderer.invoke("local:list", targetPath),
  pickLocalFolder: () => ipcRenderer.invoke("local:pick-folder"),
  pickLocalFiles: () => ipcRenderer.invoke("local:pick-files"),
  pickLocalKeyFile: () => ipcRenderer.invoke("local:pick-key-file"),
  expandLocalEntries: (entries) => ipcRenderer.invoke("local:expand-entries", entries),
  describeLocalPaths: (paths) => ipcRenderer.invoke("local:describe-paths", paths),
  findMatchingKeyFile: (isoPath) => ipcRenderer.invoke("local:find-matching-key-file", isoPath),
  getDroppedFilePath: (file) => webUtils.getPathForFile(file),
  connectFtp: (config) => ipcRenderer.invoke("ftp:connect", config),
  disconnectFtp: () => ipcRenderer.invoke("ftp:disconnect"),
  ftpStatus: () => ipcRenderer.invoke("ftp:status"),
  listRemote: (remotePath) => ipcRenderer.invoke("ftp:list", remotePath),
  preflightUpload: (payload) => ipcRenderer.invoke("ftp:preflight-upload", payload),
  uploadToRemote: (payload) => ipcRenderer.invoke("ftp:upload", payload),
  downloadFromRemote: (payload) => ipcRenderer.invoke("ftp:download", payload),
  cancelTransfer: (payload) => ipcRenderer.invoke("ftp:cancel-transfer", payload),
  verifyIsoKeyPair: (payload) => ipcRenderer.invoke("ftp:verify-iso-key-pair", payload),
  deleteRemote: (payload) => ipcRenderer.invoke("ftp:delete", payload),
  runSpeedTest: (payload) => ipcRenderer.invoke("ftp:speed-test", payload),
  diagnoseDirectLan: (payload) => ipcRenderer.invoke("network:direct-lan-diagnose", payload),
  applyDirectLan: (payload) => ipcRenderer.invoke("network:direct-lan-apply", payload),
  restoreDirectLan: (payload) => ipcRenderer.invoke("network:direct-lan-restore", payload),
  webmanAction: (action) => ipcRenderer.invoke("webman:action", action),
  getStorageInfo: (payload) => ipcRenderer.invoke("storage:info", payload),
  onTransferProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("transfer:progress", listener);
    return () => ipcRenderer.removeListener("transfer:progress", listener);
  },
  onVaultEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("vault:event", listener);
    return () => ipcRenderer.removeListener("vault:event", listener);
  },
  onShowAbout: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("app:show-about", listener);
    return () => ipcRenderer.removeListener("app:show-about", listener);
  }
});
