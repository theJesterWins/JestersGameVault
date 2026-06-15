const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("vaultAPI", {
  listLocal: (targetPath) => ipcRenderer.invoke("local:list", targetPath),
  pickLocalFolder: () => ipcRenderer.invoke("local:pick-folder"),
  pickLocalFiles: () => ipcRenderer.invoke("local:pick-files"),
  pickLocalKeyFile: () => ipcRenderer.invoke("local:pick-key-file"),
  findMatchingKeyFile: (isoPath) => ipcRenderer.invoke("local:find-matching-key-file", isoPath),
  getDroppedFilePath: (file) => webUtils.getPathForFile(file),
  connectFtp: (config) => ipcRenderer.invoke("ftp:connect", config),
  disconnectFtp: () => ipcRenderer.invoke("ftp:disconnect"),
  ftpStatus: () => ipcRenderer.invoke("ftp:status"),
  listRemote: (remotePath) => ipcRenderer.invoke("ftp:list", remotePath),
  uploadToRemote: (payload) => ipcRenderer.invoke("ftp:upload", payload),
  verifyIsoKeyPair: (payload) => ipcRenderer.invoke("ftp:verify-iso-key-pair", payload),
  deleteRemote: (payload) => ipcRenderer.invoke("ftp:delete", payload),
  runSpeedTest: (payload) => ipcRenderer.invoke("ftp:speed-test", payload),
  webmanAction: (action) => ipcRenderer.invoke("webman:action", action),
  onTransferProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("transfer:progress", listener);
    return () => ipcRenderer.removeListener("transfer:progress", listener);
  },
  onVaultEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("vault:event", listener);
    return () => ipcRenderer.removeListener("vault:event", listener);
  }
});
