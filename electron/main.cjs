const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { Menu } = require("electron");
const ftp = require("basic-ftp");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

let mainWindow;
let ftpClient;
let ftpConfig;
let ftpTaskQueue = Promise.resolve();
const activeUploadCancelers = new Map();

const PS3_DEFAULT_PATH = "/dev_hdd0/PS2ISO/";

function assetPath(...parts) {
  return path.join(__dirname, "..", ...parts);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: "#081012",
    title: "Jester's Game Vault",
    icon: assetPath("src", "assets", "jester-icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5180";
  if (!app.isPackaged) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(assetPath("dist", "index.html"));
  }

  Menu.setApplicationMenu(createAppMenu());
}

function createAppMenu() {
  return Menu.buildFromTemplate([
    {
      label: "File",
      submenu: [
        {
          label: "About Jester's Game Vault",
          click: () => {
            mainWindow?.webContents.send("app:show-about");
          }
        },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" }
      ]
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" }
      ]
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "close" }
      ]
    }
  ]);
}

function emitVaultEvent(level, message, details = {}) {
  mainWindow?.webContents.send("vault:event", {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    level,
    message,
    details,
    createdAt: new Date().toISOString()
  });
}

function createTransferProgressEmitter(transferId, totalBytes, startedAt) {
  let lastReportedBytes = 0;

  return (bytesOverall) => {
    const clampedBytes = Math.max(0, Math.min(bytesOverall || 0, totalBytes));
    const elapsedMs = Math.max(Date.now() - startedAt, 1);
    const bytesPerSecond = Math.round(clampedBytes / (elapsedMs / 1000));
    const remainingBytes = Math.max(totalBytes - clampedBytes, 0);

    mainWindow?.webContents.send("transfer:progress", {
      id: transferId,
      bytes: Math.max(clampedBytes - lastReportedBytes, 0),
      bytesOverall: clampedBytes,
      totalBytes,
      percent: totalBytes ? Math.min(100, Math.round((clampedBytes / totalBytes) * 100)) : 0,
      elapsedMs,
      bytesPerSecond,
      remainingMs: bytesPerSecond > 0 ? Math.round((remainingBytes / bytesPerSecond) * 1000) : null
    });

    lastReportedBytes = Math.max(lastReportedBytes, clampedBytes);
  };
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (ftpClient) ftpClient.close();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

function formatLocalEntry(parentPath, dirent) {
  const fullPath = path.join(parentPath, dirent.name);
  return fs.stat(fullPath).then((stat) => ({
    name: dirent.name,
    path: fullPath,
    isDirectory: dirent.isDirectory(),
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    type: dirent.isDirectory() ? "Folder" : fileTypeLabel(dirent.name)
  }));
}

function fileTypeLabel(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  const labels = {
    ".iso": "ISO",
    ".bin": "BIN",
    ".cue": "CUE",
    ".pkg": "PKG",
    ".rap": "RAP",
    ".key": "KEY",
    ".dkey": "DKEY",
    ".sfo": "SFO",
    ".sprx": "SPRX",
    ".txt": "Text"
  };
  return labels[ext] || (ext ? ext.slice(1).toUpperCase() : "File");
}

function parentOf(targetPath) {
  const parsed = path.parse(targetPath);
  if (path.resolve(targetPath) === path.resolve(parsed.root)) return null;
  return path.dirname(targetPath);
}

function posixParent(targetPath) {
  const clean = normalizeRemotePath(targetPath);
  if (clean === "/") return null;
  return normalizeRemotePath(path.posix.dirname(clean));
}

function normalizeRemotePath(targetPath) {
  if (!targetPath || targetPath === ".") return PS3_DEFAULT_PATH;
  const normalized = path.posix.normalize(targetPath.replace(/\\/g, "/"));
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

function normalizeRemoteEntryPath(targetPath) {
  if (!targetPath) throw new Error("Remote path is required.");
  return path.posix.normalize(targetPath.replace(/\\/g, "/"));
}

function joinRemote(remoteDir, fileName) {
  return path.posix.join(normalizeRemotePath(remoteDir), fileName).replace(/\\/g, "/");
}

async function localFileEntry(filePath) {
  const stat = await fs.stat(filePath);
  return {
    name: path.basename(filePath),
    path: filePath,
    isDirectory: false,
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    type: fileTypeLabel(filePath)
  };
}

function remoteRelativePathFromPayload(payload) {
  const requestedName = payload.remoteName || payload.remoteRelativePath || path.basename(payload.localPath || "");
  const normalized = path.posix.normalize(String(requestedName).replace(/\\/g, "/"));
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
    throw new Error("Remote file name is invalid.");
  }
  return normalized
    .split("/")
    .filter(Boolean)
    .map((part) => path.posix.basename(part))
    .join("/");
}

function localDestinationPath(payload, remotePath) {
  const localDir = payload.localDir || payload.localPath;
  if (!localDir) throw new Error("Local destination folder is required.");
  const requestedName = payload.localName || path.posix.basename(remotePath);
  return path.join(localDir, path.basename(requestedName));
}

async function collectLocalUploadFiles(entryPath, rootName = path.basename(entryPath), relativePrefix = "") {
  const stat = await fs.stat(entryPath);
  if (stat.isFile()) {
    return [{
      name: path.basename(entryPath),
      path: entryPath,
      isDirectory: false,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      type: fileTypeLabel(entryPath),
      relativePath: relativePrefix || path.basename(entryPath),
      rootName
    }];
  }

  if (!stat.isDirectory()) return [];

  const dirents = await fs.readdir(entryPath, { withFileTypes: true });
  const nested = await Promise.all(
    dirents
      .filter((entry) => !entry.name.startsWith("$"))
      .map((entry) => {
        const childPath = path.join(entryPath, entry.name);
        const childRelativePath = path.posix.join(relativePrefix || rootName, entry.name);
        return collectLocalUploadFiles(childPath, rootName, childRelativePath);
      })
  );
  return nested.flat();
}

async function collectRemoteFiles(client, remotePath, relativePrefix = path.posix.basename(remotePath)) {
  const normalizedRemotePath = normalizeRemoteEntryPath(remotePath);
  const entries = await client.list(normalizedRemotePath);
  const files = [];
  for (const entry of entries.filter((item) => item.name !== "." && item.name !== "..")) {
    const childRemotePath = path.posix.join(normalizedRemotePath, entry.name);
    const childRelativePath = path.posix.join(relativePrefix, entry.name);
    if (entry.isDirectory) {
      files.push(...await collectRemoteFiles(client, childRemotePath, childRelativePath));
    } else {
      files.push({
        name: entry.name,
        remotePath: childRemotePath,
        relativePath: childRelativePath,
        size: entry.size || 0
      });
    }
  }
  return files;
}

function emitProgressResult(result) {
  return {
    ...result,
    bytesPerSecond: result.elapsedMs ? Math.round(result.bytes / (Math.max(result.elapsedMs, 1) / 1000)) : 0
  };
}

async function ensureConnected() {
  if (ftpClient && !ftpClient.closed) {
    return;
  }

  if (!ftpConfig) {
    emitVaultEvent("error", "FTP action blocked because no PS3 session is connected.");
    throw new Error("Not connected to the PS3 FTP server.");
  }

  emitVaultEvent("info", `Reopening FTP session to ${ftpConfig.host}:${ftpConfig.port}.`);
  if (ftpClient) ftpClient.close();
  ftpClient = new ftp.Client(30000);
  ftpClient.ftp.verbose = false;
  await ftpClient.access(ftpConfig);
  emitVaultEvent("success", `FTP session restored for ${ftpConfig.host}.`);
}

function runFtpTask(label, task) {
  return runQueuedFtpTask(label, task);
}

function runQueuedFtpTask(label, task) {
  const queuedTask = ftpTaskQueue.catch(() => {}).then(async () => {
    emitVaultEvent("info", `${label} started.`);
    try {
      const result = await task();
      emitVaultEvent("success", `${label} finished.`);
      return result;
    } catch (error) {
      const wasCanceled = error.message.toLowerCase().includes("canceled");
      emitVaultEvent(wasCanceled ? "warn" : "error", `${label} ${wasCanceled ? "canceled" : "failed"}: ${error.message}`);
      throw error;
    }
  });

  ftpTaskQueue = queuedTask.catch(() => {});
  return queuedTask;
}

async function runImmediateFtpTask(label, task) {
  emitVaultEvent("info", `${label} started.`);
  try {
    const result = await task();
    emitVaultEvent("success", `${label} finished.`);
    return result;
  } catch (error) {
    const wasCanceled = error.message.toLowerCase().includes("canceled");
    emitVaultEvent(wasCanceled ? "warn" : "error", `${label} ${wasCanceled ? "canceled" : "failed"}: ${error.message}`);
    throw error;
  }
}

async function createFtpClient(timeout = 30000) {
  if (!ftpConfig) {
    emitVaultEvent("error", "FTP action blocked because no PS3 session is connected.");
    throw new Error("Not connected to the PS3 FTP server.");
  }
  const client = new ftp.Client(timeout);
  client.ftp.verbose = false;
  await client.access(ftpConfig);
  return client;
}

async function withFreshFtpClient(task, timeout = 30000) {
  const client = await createFtpClient(timeout);
  try {
    return await task(client);
  } finally {
    client.close();
  }
}

ipcMain.handle("app:info", async () => ({
  name: "Jester's Game Vault",
  version: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  packaged: app.isPackaged
}));

ipcMain.handle("local:list", async (_event, targetPath) => {
  if (!targetPath) {
    return {
      path: "",
      parent: null,
      entries: []
    };
  }

  const resolvedPath = targetPath;
  const dirents = await fs.readdir(resolvedPath, { withFileTypes: true });
  const entries = await Promise.all(
    dirents
      .filter((entry) => !entry.name.startsWith("$"))
      .map((entry) => formatLocalEntry(resolvedPath, entry).catch(() => null))
  );

  return {
    path: resolvedPath,
    parent: parentOf(resolvedPath),
    entries: entries
      .filter(Boolean)
      .sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name))
  };
});

ipcMain.handle("local:pick-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"]
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
});

ipcMain.handle("local:pick-files", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile", "openDirectory", "multiSelections"],
    filters: [
      { name: "PS3 backups, folders, keys, and homebrew", extensions: ["iso", "key", "dkey", "bin", "cue", "pkg", "rap", "sprx", "self"] },
      { name: "All files", extensions: ["*"] }
    ]
  });
  if (result.canceled) return [];

  const entries = await Promise.all(
    result.filePaths.map((filePath) => localFileEntry(filePath))
  );

  return entries;
});

ipcMain.handle("local:pick-key-file", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [
      { name: "PS3 ISO keys", extensions: ["key", "dkey"] },
      { name: "All files", extensions: ["*"] }
    ]
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return localFileEntry(result.filePaths[0]);
});

ipcMain.handle("local:describe-paths", async (_event, filePaths) => {
  if (!Array.isArray(filePaths)) return [];
  const entries = await Promise.all(
    filePaths
      .filter(Boolean)
      .map((filePath) => localFileEntry(filePath).catch(() => null))
  );
  return entries.filter(Boolean);
});

ipcMain.handle("local:expand-entries", async (_event, entries) => {
  if (!Array.isArray(entries)) return [];
  const expanded = await Promise.all(
    entries
      .filter((entry) => entry?.path)
      .map((entry) => collectLocalUploadFiles(entry.path, entry.name || path.basename(entry.path)).catch((error) => ({
        error: error.message,
        source: entry.path
      })))
  );
  const files = [];
  const errors = [];
  for (const item of expanded.flat()) {
    if (item?.error) {
      errors.push(item);
    } else if (item) {
      files.push(item);
    }
  }
  return { files, errors };
});

ipcMain.handle("local:find-matching-key-file", async (_event, isoPath) => {
  if (!isoPath || path.extname(isoPath).toLowerCase() !== ".iso") return null;
  const dirName = path.dirname(isoPath);
  const baseName = path.basename(isoPath, path.extname(isoPath));
  const candidates = [
    path.join(dirName, `${baseName}.key`),
    path.join(dirName, `${baseName}.dkey`)
  ];

  for (const candidate of candidates) {
    try {
      return await localFileEntry(candidate);
    } catch {
      // Keep looking; missing adjacent key files are expected.
    }
  }

  return null;
});

ipcMain.handle("ftp:connect", async (_event, config) => {
  if (ftpClient) ftpClient.close();

  emitVaultEvent("info", `Connecting to PS3 FTP at ${config.host}:${config.port || 21}.`);
  const client = new ftp.Client(30000);
  client.ftp.verbose = false;
  const normalizedConfig = {
    host: config.host.trim(),
    port: Number(config.port) || 21,
    user: config.username.trim() || "anonymous",
    password: config.password || "",
    secure: false
  };

  await client.access(normalizedConfig);
  ftpClient = client;
  ftpConfig = normalizedConfig;
  emitVaultEvent("success", `Connected to ${normalizedConfig.host}:${normalizedConfig.port} as ${normalizedConfig.user}.`);

  return {
    connected: true,
    host: normalizedConfig.host,
    port: normalizedConfig.port,
    user: normalizedConfig.user
  };
});

ipcMain.handle("ftp:disconnect", async () => {
  if (ftpClient) ftpClient.close();
  ftpClient = undefined;
  ftpConfig = undefined;
  emitVaultEvent("info", "Disconnected from PS3 FTP.");
  return { connected: false };
});

ipcMain.handle("ftp:status", async () => ({
  connected: Boolean(ftpClient && !ftpClient.closed),
  host: ftpConfig?.host,
  port: ftpConfig?.port,
  user: ftpConfig?.user
}));

ipcMain.handle("ftp:cancel-transfer", async (_event, payload) => {
  const transferId = payload?.id;
  if (!transferId) {
    throw new Error("Transfer id is required.");
  }

  const cancelUpload = activeUploadCancelers.get(transferId);
  if (!cancelUpload) {
    emitVaultEvent("warn", `Cancel requested for queued transfer ${transferId}.`);
    return { cancelled: true, active: false, id: transferId };
  }

  cancelUpload();
  return { cancelled: true, active: true, id: transferId };
});

ipcMain.handle("ftp:list", async (_event, remotePath) => runImmediateFtpTask("Remote list", async () => withFreshFtpClient(async (client) => {
  const normalizedPath = normalizeRemotePath(remotePath);
  emitVaultEvent("info", `Listing ${normalizedPath}.`);
  await client.cd(normalizedPath);
  const entries = await client.list();
  emitVaultEvent("success", `Listed ${entries.length} item(s) in ${normalizedPath}.`);

  return {
    path: normalizedPath,
    parent: posixParent(normalizedPath),
    entries: entries
      .filter((entry) => entry.name !== "." && entry.name !== "..")
      .map((entry) => ({
        name: entry.name,
        path: joinRemote(normalizedPath, entry.name),
        isDirectory: entry.isDirectory,
        size: entry.size,
        modifiedAt: entry.modifiedAt ? entry.modifiedAt.toISOString() : null,
        type: entry.isDirectory ? "Folder" : fileTypeLabel(entry.name)
      }))
      .sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name))
  };
})));

ipcMain.handle("ftp:preflight-upload", async (_event, payload) => runImmediateFtpTask("Upload preflight", async () => withFreshFtpClient(async (client) => {
  const remoteDir = normalizeRemotePath(payload.remoteDir);
  const remoteRelativePath = remoteRelativePathFromPayload(payload);
  const remotePath = joinRemote(remoteDir, remoteRelativePath);
  const remoteParent = normalizeRemotePath(path.posix.dirname(remotePath));
  const remoteFileName = path.posix.basename(remotePath);
  const partialName = `${remoteFileName}.part`;
  const warnings = [];
  let parentExists = true;
  let existingFile = null;
  let partialFile = null;

  try {
    const entries = await client.list(remoteParent);
    existingFile = entries.find((entry) => entry.name === remoteFileName) || null;
    partialFile = entries.find((entry) => entry.name === partialName) || null;
  } catch (error) {
    parentExists = false;
    warnings.push(`Remote folder will be created: ${remoteParent}`);
    emitVaultEvent("warn", `Upload preflight could not list ${remoteParent}: ${error.message}.`);
  }

  if (existingFile) warnings.push(`Existing file will be replaced: ${remoteFileName}`);
  if (partialFile) warnings.push(`Old partial will be overwritten: ${partialName}`);

  emitVaultEvent(warnings.length ? "warn" : "success", warnings.length
    ? `Upload preflight found ${warnings.length} note(s) for ${remoteFileName}.`
    : `Upload preflight OK for ${remoteFileName}.`, {
    remotePath,
    parentExists,
    warnings
  });

  return {
    ok: true,
    remotePath,
    remoteParent,
    parentExists,
    existingFile: existingFile ? { name: existingFile.name, size: existingFile.size || 0 } : null,
    partialFile: partialFile ? { name: partialFile.name, size: partialFile.size || 0 } : null,
    warnings
  };
})));

ipcMain.handle("ftp:upload", async (_event, payload) => runFtpTask("Upload", async () => {
  const transferClient = await createFtpClient();

  const stat = await fs.stat(payload.localPath);
  if (stat.isDirectory()) {
    throw new Error("Folder upload is not enabled yet. Select files for this version.");
  }

  const transferId = payload.id || `${Date.now()}-${path.basename(payload.localPath)}`;
  const remoteDir = normalizeRemotePath(payload.remoteDir);
  const remoteRelativePath = remoteRelativePathFromPayload(payload);
  const remotePath = joinRemote(remoteDir, remoteRelativePath);
  const remoteFileName = path.posix.basename(remotePath);
  const remoteParent = normalizeRemotePath(path.posix.dirname(remotePath));
  const usePartFile = payload.usePartFile !== false;
  const verifySize = payload.verifySize !== false;
  const transferPath = usePartFile ? `${remotePath}.part` : remotePath;
  const transferFileName = path.posix.basename(transferPath);
  const startedAt = Date.now();
  const emitProgress = createTransferProgressEmitter(transferId, stat.size, startedAt);
  let pollClient;
  let pollTimer;
  let pollInFlight = false;
  let pollWarningEmitted = false;
  let wasCanceled = false;

  const pollRemoteSize = async () => {
    if (pollInFlight) return;
    pollInFlight = true;
    try {
      if (!pollClient || pollClient.closed) {
        pollClient = new ftp.Client(10000);
        pollClient.ftp.verbose = false;
        await pollClient.access(ftpConfig);
      }
      const entries = await pollClient.list(remoteParent);
      const remoteEntry = entries.find((entry) => entry.name === transferFileName || entry.name === remoteFileName);
      if (remoteEntry?.size) {
        emitProgress(remoteEntry.size);
      }
    } catch (error) {
      if (!pollWarningEmitted) {
        pollWarningEmitted = true;
        emitVaultEvent("warn", `Remote size polling paused: ${error.message}.`);
      }
      if (pollClient) pollClient.close();
      pollClient = undefined;
    } finally {
      pollInFlight = false;
    }
  };

  const stopPolling = () => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = undefined;
    if (pollClient) pollClient.close();
    pollClient = undefined;
  };

  emitVaultEvent("info", `Upload started: ${path.basename(payload.localPath)} -> ${remotePath}.`, {
    transferId,
    localPath: payload.localPath,
    remotePath,
    transferPath,
    totalBytes: stat.size
  });
  emitProgress(0);

  const cancelUpload = () => {
    wasCanceled = true;
    emitVaultEvent("warn", `Cancel requested: ${path.basename(payload.localPath)}.`, {
      transferId,
      remotePath
    });
    if (pollClient) {
      pollClient.close();
      pollClient = undefined;
    }
    if (transferClient && !transferClient.closed) {
      transferClient.close();
    }
  };

  activeUploadCancelers.set(transferId, cancelUpload);

  transferClient.trackProgress((info) => {
    emitProgress(info.bytesOverall);
  });

  try {
    await transferClient.ensureDir(remoteParent);
    pollTimer = setInterval(pollRemoteSize, 5000);
    await pollRemoteSize();
    await transferClient.uploadFrom(payload.localPath, transferPath);
    emitProgress(stat.size);
    if (verifySize) {
      const uploadedSize = await transferClient.size(transferPath);
      if (uploadedSize !== stat.size) {
        throw new Error(`Uploaded size mismatch before rename: expected ${stat.size} B, got ${uploadedSize} B.`);
      }
    }
    if (usePartFile) {
      await transferClient.remove(remotePath, true).catch(() => {});
      await transferClient.rename(transferPath, remotePath);
    }
    let verified = false;
    let remoteBytes = stat.size;
    if (verifySize) {
      remoteBytes = await transferClient.size(remotePath);
      verified = remoteBytes === stat.size;
      if (!verified) {
        throw new Error(`Uploaded size mismatch: expected ${stat.size} B, got ${remoteBytes} B.`);
      }
    }
    const elapsedMs = Date.now() - startedAt;
    emitVaultEvent("success", `Upload complete: ${path.basename(payload.localPath)}.`, {
      transferId,
      remotePath,
      totalBytes: stat.size,
      elapsedMs,
      verified,
      usedPartFile: usePartFile
    });

    return emitProgressResult({
      id: transferId,
      remotePath,
      remoteName: remoteFileName,
      bytes: stat.size,
      remoteBytes,
      elapsedMs,
      verified,
      usedPartFile: usePartFile
    });
  } catch (error) {
    if (wasCanceled) {
      emitVaultEvent("warn", `Upload canceled: ${path.basename(payload.localPath)}.`, {
        transferId,
        remotePath
      });
      throw new Error("Transfer canceled by user.");
    }

    emitVaultEvent("error", `Upload failed: ${path.basename(payload.localPath)}.`, {
      transferId,
      remotePath,
      message: error.message
    });
    throw error;
  } finally {
    activeUploadCancelers.delete(transferId);
    try {
      transferClient.trackProgress();
    } catch {
      // A canceled transfer closes the FTP client before progress cleanup.
    }
    stopPolling();
    if (transferClient && !transferClient.closed) {
      transferClient.close();
    }
  }
}));

ipcMain.handle("ftp:download", async (_event, payload) => runFtpTask("Download", async () => {
  const transferClient = await createFtpClient();
  const transferId = payload.id || `${Date.now()}-${path.posix.basename(payload.remotePath || "download")}`;
  const remotePath = normalizeRemoteEntryPath(payload.remotePath);
  const isDirectory = Boolean(payload.isDirectory);
  const localDir = payload.localDir || payload.localPath;
  if (!localDir) throw new Error("Local destination folder is required.");
  const usePartFile = payload.usePartFile !== false;
  const verifySize = payload.verifySize !== false;
  const startedAt = Date.now();
  let totalBytes = Number(payload.size || 0);
  let wasCanceled = false;
  let emitProgress = createTransferProgressEmitter(transferId, totalBytes, startedAt);

  if (isDirectory) {
    const remoteFiles = await collectRemoteFiles(transferClient, remotePath);
    totalBytes = remoteFiles.reduce((sum, fileInfo) => sum + Number(fileInfo.size || 0), 0);
    emitProgress = createTransferProgressEmitter(transferId, totalBytes, startedAt);
    emitVaultEvent("info", `Folder download started: ${remotePath} -> ${localDir}.`, {
      transferId,
      remotePath,
      localDir,
      files: remoteFiles.length,
      totalBytes
    });

    const cancelDownload = () => {
      wasCanceled = true;
      emitVaultEvent("warn", `Cancel requested: ${remotePath}.`, { transferId, remotePath });
      if (transferClient && !transferClient.closed) transferClient.close();
    };

    activeUploadCancelers.set(transferId, cancelDownload);
    transferClient.trackProgress((info) => emitProgress(info.bytesOverall));
    emitProgress(0);

    try {
      for (const fileInfo of remoteFiles) {
        const finalLocalPath = path.join(localDir, ...fileInfo.relativePath.split("/"));
        const partialLocalPath = usePartFile ? `${finalLocalPath}.part` : finalLocalPath;
        await fs.mkdir(path.dirname(finalLocalPath), { recursive: true });
        await transferClient.downloadTo(partialLocalPath, fileInfo.remotePath);
        if (verifySize) {
          const partialStat = await fs.stat(partialLocalPath);
          if (partialStat.size !== fileInfo.size) {
            throw new Error(`Downloaded size mismatch for ${fileInfo.relativePath}: expected ${fileInfo.size} B, got ${partialStat.size} B.`);
          }
        }
        if (usePartFile) {
          await fs.rm(finalLocalPath, { force: true }).catch(() => {});
          await fs.rename(partialLocalPath, finalLocalPath);
        }
      }

      if (verifySize) {
        for (const fileInfo of remoteFiles) {
          const finalLocalPath = path.join(localDir, ...fileInfo.relativePath.split("/"));
          const stat = await fs.stat(finalLocalPath);
          if (stat.size !== fileInfo.size) {
            throw new Error(`Downloaded size mismatch for ${fileInfo.relativePath}: expected ${fileInfo.size} B, got ${stat.size} B.`);
          }
        }
      }

      emitProgress(totalBytes);
      const elapsedMs = Date.now() - startedAt;
      const result = emitProgressResult({
        id: transferId,
        remotePath,
        localPath: path.join(localDir, path.posix.basename(remotePath)),
        bytes: totalBytes,
        elapsedMs,
        verified: verifySize,
        downloadedFiles: remoteFiles.length,
        usedPartFile: usePartFile
      });
      emitVaultEvent("success", `Folder download complete: ${remotePath}.`, result);
      return result;
    } catch (error) {
      if (wasCanceled) {
        emitVaultEvent("warn", `Download canceled: ${remotePath}.`, { transferId, remotePath });
        throw new Error("Transfer canceled by user.");
      }
      emitVaultEvent("error", `Download failed: ${remotePath}.`, { transferId, remotePath, message: error.message });
      throw error;
    } finally {
      activeUploadCancelers.delete(transferId);
      try {
        transferClient.trackProgress();
      } catch {
        // A canceled transfer closes the FTP client before progress cleanup.
      }
      if (transferClient && !transferClient.closed) transferClient.close();
    }
  }

  if (!totalBytes) {
    totalBytes = await transferClient.size(remotePath);
    emitProgress = createTransferProgressEmitter(transferId, totalBytes, startedAt);
  }

  const finalLocalPath = localDestinationPath(payload, remotePath);
  const partialLocalPath = usePartFile ? `${finalLocalPath}.part` : finalLocalPath;
  emitVaultEvent("info", `Download started: ${remotePath} -> ${finalLocalPath}.`, {
    transferId,
    remotePath,
    finalLocalPath,
    totalBytes
  });

  const cancelDownload = () => {
    wasCanceled = true;
    emitVaultEvent("warn", `Cancel requested: ${remotePath}.`, { transferId, remotePath });
    if (transferClient && !transferClient.closed) transferClient.close();
  };

  activeUploadCancelers.set(transferId, cancelDownload);
  transferClient.trackProgress((info) => emitProgress(info.bytesOverall));
  emitProgress(0);

  try {
    await fs.mkdir(path.dirname(finalLocalPath), { recursive: true });
    await transferClient.downloadTo(partialLocalPath, remotePath);
    emitProgress(totalBytes);
    if (verifySize) {
      const partialStat = await fs.stat(partialLocalPath);
      if (partialStat.size !== totalBytes) {
        throw new Error(`Downloaded size mismatch before rename: expected ${totalBytes} B, got ${partialStat.size} B.`);
      }
    }
    if (usePartFile) {
      await fs.rm(finalLocalPath, { force: true }).catch(() => {});
      await fs.rename(partialLocalPath, finalLocalPath);
    }
    let verified = false;
    if (verifySize) {
      const finalStat = await fs.stat(finalLocalPath);
      verified = finalStat.size === totalBytes;
      if (!verified) {
        throw new Error(`Downloaded size mismatch: expected ${totalBytes} B, got ${finalStat.size} B.`);
      }
    }

    const elapsedMs = Date.now() - startedAt;
    const result = emitProgressResult({
      id: transferId,
      remotePath,
      localPath: finalLocalPath,
      bytes: totalBytes,
      elapsedMs,
      verified,
      usedPartFile: usePartFile
    });
    emitVaultEvent("success", `Download complete: ${remotePath}.`, result);
    return result;
  } catch (error) {
    if (wasCanceled) {
      emitVaultEvent("warn", `Download canceled: ${remotePath}.`, { transferId, remotePath });
      throw new Error("Transfer canceled by user.");
    }
    emitVaultEvent("error", `Download failed: ${remotePath}.`, { transferId, remotePath, message: error.message });
    throw error;
  } finally {
    activeUploadCancelers.delete(transferId);
    try {
      transferClient.trackProgress();
    } catch {
      // A canceled transfer closes the FTP client before progress cleanup.
    }
    if (transferClient && !transferClient.closed) transferClient.close();
  }
}));

ipcMain.handle("ftp:verify-iso-key-pair", async (_event, payload) => runFtpTask("ISO/key verification", async () => {
  await ensureConnected();

  const remoteDir = normalizeRemotePath(payload.remoteDir);
  const isoName = path.posix.basename(String(payload.isoName || "").replace(/\\/g, "/"));
  if (!isoName.toLowerCase().endsWith(".iso")) {
    throw new Error("Verification requires a PS3 ISO file name.");
  }

  const expectedIsoBytes = Number(payload.expectedIsoBytes || 0);
  const baseName = isoName.slice(0, -4);
  const keyNames = [`${baseName}.key`, `${baseName}.dkey`];
  const entries = await ftpClient.list(remoteDir);
  const isoEntry = entries.find((entry) => entry.name === isoName);
  const keyEntry = entries.find((entry) => keyNames.includes(entry.name));
  const isoSizeMatches = Boolean(isoEntry && (!expectedIsoBytes || isoEntry.size === expectedIsoBytes));
  const ok = Boolean(isoEntry && keyEntry && isoSizeMatches);

  emitVaultEvent(ok ? "success" : "warn", ok
    ? `ISO/key verification passed for ${isoName}.`
    : `ISO/key verification needs attention for ${isoName}.`, {
    remoteDir,
    isoName,
    isoBytes: isoEntry?.size || 0,
    expectedIsoBytes,
    keyName: keyEntry?.name || null,
    keyBytes: keyEntry?.size || 0,
    isoSizeMatches
  });

  return {
    ok,
    remoteDir,
    iso: isoEntry ? { name: isoEntry.name, size: isoEntry.size, sizeMatches: isoSizeMatches } : null,
    key: keyEntry ? { name: keyEntry.name, size: keyEntry.size } : null,
    expectedKeyNames: keyNames
  };
}));

ipcMain.handle("ftp:delete", async (_event, payload) => runFtpTask("Remote delete", async () => {
  await ensureConnected();

  const remotePath = normalizeRemoteEntryPath(payload.remotePath);
  if (!remotePath.startsWith("/dev_hdd0/")) {
    throw new Error("Delete is limited to /dev_hdd0 paths.");
  }

  emitVaultEvent("warn", `Delete requested: ${remotePath}.`);
  if (payload.isDirectory) {
    await ftpClient.removeDir(remotePath);
  } else {
    await ftpClient.remove(remotePath);
  }
  emitVaultEvent("success", `Deleted ${remotePath}.`);

  return {
    deleted: true,
    remotePath,
    isDirectory: Boolean(payload.isDirectory)
  };
}));

ipcMain.handle("ftp:speed-test", async (_event, payload) => runFtpTask("Speed test", async () => {
  await ensureConnected();

  const sizeBytes = Math.min(Number(payload.sizeBytes) || 8 * 1024 * 1024, 32 * 1024 * 1024);
  const remoteDir = normalizeRemotePath(payload.remoteDir || PS3_DEFAULT_PATH);
  const fileName = `.jgv_speedtest_${Date.now()}.tmp`;
  const remotePath = joinRemote(remoteDir, fileName);
  const localPath = path.join(os.tmpdir(), fileName);
  const testData = crypto.randomBytes(sizeBytes);
  const startedAt = Date.now();
  emitVaultEvent("info", `Speed test started in ${remoteDir}.`, { sizeBytes });

  try {
    await fs.writeFile(localPath, testData);
    await ftpClient.ensureDir(remoteDir);
    await ftpClient.uploadFrom(localPath, remotePath);
    const elapsedMs = Math.max(Date.now() - startedAt, 1);
    await ftpClient.remove(remotePath);
    emitVaultEvent("success", `Speed test complete: ${Math.round(sizeBytes / (elapsedMs / 1000))} B/s.`, {
      sizeBytes,
      elapsedMs,
      remoteDir
    });

    return {
      sizeBytes,
      elapsedMs,
      bytesPerSecond: Math.round(sizeBytes / (elapsedMs / 1000)),
      remoteDir
    };
  } finally {
    await fs.unlink(localPath).catch(() => {});
  }
}));

ipcMain.handle("webman:action", async (_event, action) => {
  if (!ftpConfig?.host) {
    throw new Error("Connect to your PS3 first so the app knows its IP address.");
  }

  const route = action === "restart" ? "restart.ps3" : "refresh.ps3";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`http://${ftpConfig.host}/${route}`, {
      signal: controller.signal
    });
    return {
      action,
      ok: response.ok,
      status: response.status,
      url: `http://${ftpConfig.host}/${route}`
    };
  } finally {
    clearTimeout(timeout);
  }
});
