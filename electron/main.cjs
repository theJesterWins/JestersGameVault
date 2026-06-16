const { app, BrowserWindow, clipboard, dialog, ipcMain } = require("electron");
const { Menu } = require("electron");
const ftp = require("basic-ftp");
const { execFile } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const net = require("node:net");
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

ipcMain.handle("app:copy-text", async (_event, text) => {
  clipboard.writeText(String(text || ""));
  return { ok: true };
});

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
  connected: Boolean(ftpConfig),
  controlConnected: Boolean(ftpClient && !ftpClient.closed),
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

ipcMain.handle("network:direct-lan-diagnose", async (_event, payload) => diagnoseDirectLan(payload || {}));

ipcMain.handle("network:direct-lan-apply", async (_event, payload) => applyDirectLanMapping(payload || {}));

ipcMain.handle("network:direct-lan-restore", async (_event, payload) => restoreDirectLanMapping(payload || {}));

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

async function diagnoseDirectLan(payload) {
  const ps3Ip = String(payload.ps3Ip || payload.host || "").trim();
  if (!isValidIpv4(ps3Ip)) {
    throw new Error("Enter the PS3 Ethernet IP address before running Direct LAN detection.");
  }

  const ps3Mac = normalizeMacForWindows(payload.ps3Mac || "");
  const snapshot = await getNetworkSnapshot();
  const adapter = chooseDirectLanAdapter(snapshot.adapters, payload.adapterName);
  const adapterIps = adapter ? getAdapterIps(snapshot.ips, adapter.name) : [];
  const recommendedPcIp = isValidIpv4(payload.pcIp)
    ? String(payload.pcIp).trim()
    : getRecommendedPcIp(ps3Ip);
  const matchingIp = adapterIps.find((ipInfo) => isSameSubnet(ipInfo.ipAddress, ps3Ip, ipInfo.prefixLength));
  const ps3Neighbor = findPs3Neighbor(snapshot.neighbors, ps3Ip, ps3Mac);
  const ftp = matchingIp
    ? await testTcpPort({ host: ps3Ip, port: Number(payload.port || 21), localAddress: matchingIp.ipAddress, timeoutMs: 1800 })
    : { tested: false, ok: false, error: "PC Ethernet is not currently in the PS3 subnet." };
  const scripts = buildDirectLanScripts({
    adapterName: adapter?.name || "Ethernet",
    ps3Ip,
    ps3Mac,
    pcIp: recommendedPcIp,
    prefixLength: 24
  });

  return buildDirectLanReport({
    platform: process.platform,
    adapter,
    adapterIps,
    ps3Ip,
    ps3Mac,
    recommendedPcIp,
    matchingIp,
    ps3Neighbor,
    ftp,
    scripts
  });
}

async function applyDirectLanMapping(payload) {
  if (process.platform !== "win32") {
    throw new Error("Direct LAN auto-map is currently available on Windows builds.");
  }

  const ps3Ip = String(payload.ps3Ip || payload.host || "").trim();
  if (!isValidIpv4(ps3Ip)) {
    throw new Error("Enter the PS3 Ethernet IP before auto-mapping.");
  }

  const ps3Mac = normalizeMacForWindows(payload.ps3Mac || "");
  const snapshot = await getNetworkSnapshot();
  const adapter = chooseDirectLanAdapter(snapshot.adapters, payload.adapterName);
  if (!adapter) {
    throw new Error("No active Ethernet adapter was detected.");
  }

  const pcIp = isValidIpv4(payload.pcIp) ? String(payload.pcIp).trim() : getRecommendedPcIp(ps3Ip);
  const script = buildElevatedDirectLanScript({
    action: "apply",
    adapterName: adapter.name,
    ps3Ip,
    ps3Mac,
    pcIp,
    prefixLength: 24
  });
  const result = await runElevatedPowerShell(script, "direct-lan-apply");
  const report = await diagnoseDirectLan({ ps3Ip, ps3Mac, pcIp, adapterName: adapter.name });

  emitVaultEvent(result.ok ? "success" : "warn", result.ok
    ? `Direct LAN auto-map applied for ${ps3Ip}.`
    : `Direct LAN auto-map finished with a warning: ${result.error || "check the connection"}.`, result);

  return {
    ...result,
    report,
    adapterName: adapter.name,
    ps3Ip,
    ps3Mac,
    pcIp
  };
}

async function restoreDirectLanMapping(payload) {
  if (process.platform !== "win32") {
    throw new Error("Direct LAN restore is currently available on Windows builds.");
  }

  const ps3Ip = String(payload.ps3Ip || payload.host || "").trim();
  if (!isValidIpv4(ps3Ip)) {
    throw new Error("Enter the PS3 Ethernet IP before restoring Direct LAN settings.");
  }

  const snapshot = await getNetworkSnapshot();
  const adapter = chooseDirectLanAdapter(snapshot.adapters, payload.adapterName);
  if (!adapter) {
    throw new Error("No active Ethernet adapter was detected.");
  }

  const pcIp = isValidIpv4(payload.pcIp) ? String(payload.pcIp).trim() : getRecommendedPcIp(ps3Ip);
  const script = buildElevatedDirectLanScript({
    action: "restore",
    adapterName: adapter.name,
    ps3Ip,
    ps3Mac: normalizeMacForWindows(payload.ps3Mac || ""),
    pcIp,
    prefixLength: 24,
    addedIp: payload.addedIp !== false,
    addedRoute: payload.addedRoute !== false,
    addedNeighbor: payload.addedNeighbor !== false
  });
  const result = await runElevatedPowerShell(script, "direct-lan-restore");
  const report = await diagnoseDirectLan({ ps3Ip, ps3Mac: payload.ps3Mac, pcIp, adapterName: adapter.name });

  emitVaultEvent(result.ok ? "success" : "warn", result.ok
    ? `Direct LAN mapping restored for ${ps3Ip}.`
    : `Direct LAN restore finished with a warning: ${result.error || "check adapter settings"}.`, result);

  return {
    ...result,
    report,
    adapterName: adapter.name,
    ps3Ip,
    pcIp
  };
}

async function getNetworkSnapshot() {
  if (process.platform !== "win32") {
    return getPortableNetworkSnapshot();
  }

  const script = `
$ErrorActionPreference = 'Stop'
$adapters = @(Get-NetAdapter | Select-Object Name, ifIndex, Status, LinkSpeed, MacAddress, InterfaceDescription)
$ips = @(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' } | Select-Object InterfaceAlias, IPAddress, PrefixLength, PrefixOrigin, SuffixOrigin, AddressState)
$neighbors = @(Get-NetNeighbor -AddressFamily IPv4 | Select-Object InterfaceAlias, IPAddress, LinkLayerAddress, State)
[pscustomobject]@{
  adapters = $adapters
  ips = $ips
  neighbors = $neighbors
} | ConvertTo-Json -Depth 5 -Compress
`;
  const { stdout } = await runProcess("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    timeout: 12000
  });
  const parsed = JSON.parse(stdout || "{}");
  return {
    adapters: toArray(parsed.adapters).map(normalizeAdapter),
    ips: toArray(parsed.ips).map(normalizeIpInfo),
    neighbors: toArray(parsed.neighbors).map(normalizeNeighbor)
  };
}

function getPortableNetworkSnapshot() {
  const adapters = [];
  const ips = [];
  const interfaces = os.networkInterfaces();
  for (const [name, addresses] of Object.entries(interfaces)) {
    const ipv4Addresses = (addresses || []).filter((address) => address.family === "IPv4" && !address.internal);
    if (ipv4Addresses.length === 0) continue;
    adapters.push({
      name,
      ifIndex: 0,
      status: "Up",
      linkSpeed: "",
      macAddress: normalizeMacForWindows(ipv4Addresses[0].mac || ""),
      description: name
    });
    for (const address of ipv4Addresses) {
      ips.push({
        interfaceAlias: name,
        ipAddress: address.address,
        prefixLength: netmaskToPrefix(address.netmask),
        prefixOrigin: "",
        suffixOrigin: "",
        addressState: ""
      });
    }
  }
  return { adapters, ips, neighbors: [] };
}

function normalizeAdapter(adapter) {
  return {
    name: String(adapter.Name || adapter.name || ""),
    ifIndex: Number(adapter.ifIndex || adapter.InterfaceIndex || 0),
    status: String(adapter.Status || adapter.status || ""),
    linkSpeed: String(adapter.LinkSpeed || adapter.linkSpeed || ""),
    macAddress: normalizeMacForWindows(adapter.MacAddress || adapter.macAddress || ""),
    description: String(adapter.InterfaceDescription || adapter.description || "")
  };
}

function normalizeIpInfo(ipInfo) {
  return {
    interfaceAlias: String(ipInfo.InterfaceAlias || ipInfo.interfaceAlias || ""),
    ipAddress: String(ipInfo.IPAddress || ipInfo.ipAddress || ""),
    prefixLength: Number(ipInfo.PrefixLength || ipInfo.prefixLength || 24),
    prefixOrigin: String(ipInfo.PrefixOrigin || ipInfo.prefixOrigin || ""),
    suffixOrigin: String(ipInfo.SuffixOrigin || ipInfo.suffixOrigin || ""),
    addressState: String(ipInfo.AddressState || ipInfo.addressState || "")
  };
}

function normalizeNeighbor(neighbor) {
  return {
    interfaceAlias: String(neighbor.InterfaceAlias || neighbor.interfaceAlias || ""),
    ipAddress: String(neighbor.IPAddress || neighbor.ipAddress || ""),
    linkLayerAddress: normalizeMacForWindows(neighbor.LinkLayerAddress || neighbor.linkLayerAddress || ""),
    state: String(neighbor.State || neighbor.state || "")
  };
}

function chooseDirectLanAdapter(adapters, requestedName) {
  const normalizedRequested = String(requestedName || "").trim().toLowerCase();
  if (normalizedRequested) {
    const requested = adapters.find((adapter) => adapter.name.toLowerCase() === normalizedRequested);
    if (requested) return requested;
  }

  const upAdapters = adapters.filter((adapter) => adapter.status.toLowerCase() === "up");
  const usableAdapters = upAdapters.filter((adapter) => {
    const text = `${adapter.name} ${adapter.description}`.toLowerCase();
    return !/(wi-?fi|wireless|bluetooth|loopback|vpn|virtualbox|hyper-v|vmware|wintun|tap)/u.test(text);
  });
  const ethernet = usableAdapters.find((adapter) => /ethernet|realtek|intel|killer|gbe|2\.5gbe/u.test(`${adapter.name} ${adapter.description}`.toLowerCase()));
  return ethernet || usableAdapters[0] || upAdapters[0] || adapters[0] || null;
}

function getAdapterIps(ips, adapterName) {
  const normalizedName = String(adapterName || "").toLowerCase();
  return ips
    .filter((ipInfo) => ipInfo.interfaceAlias.toLowerCase() === normalizedName && isValidIpv4(ipInfo.ipAddress))
    .sort((a, b) => Number(isApipaAddress(a.ipAddress)) - Number(isApipaAddress(b.ipAddress)));
}

function findPs3Neighbor(neighbors, ps3Ip, ps3Mac) {
  const normalizedMac = normalizeMacForWindows(ps3Mac);
  return neighbors.find((neighbor) => {
    if (neighbor.ipAddress === ps3Ip) return true;
    return normalizedMac && neighbor.linkLayerAddress === normalizedMac;
  }) || null;
}

function buildDirectLanReport({
  platform,
  adapter,
  adapterIps,
  ps3Ip,
  ps3Mac,
  recommendedPcIp,
  matchingIp,
  ps3Neighbor,
  ftp,
  scripts
}) {
  const currentIps = adapterIps.map((ipInfo) => `${ipInfo.ipAddress}/${ipInfo.prefixLength}`);
  const steps = [];
  steps.push(adapter
    ? {
        level: adapter.status.toLowerCase() === "up" ? "ok" : "warn",
        label: `Ethernet adapter: ${adapter.name}`,
        detail: `${adapter.status || "Unknown"}${adapter.linkSpeed ? ` at ${adapter.linkSpeed}` : ""}`
      }
    : {
        level: "error",
        label: "No Ethernet adapter detected",
        detail: "Plug the PS3 into the PC Ethernet port and run detection again."
      });

  steps.push(currentIps.length
    ? {
        level: matchingIp ? "ok" : "warn",
        label: "PC Ethernet IP",
        detail: matchingIp
          ? `${matchingIp.ipAddress}/${matchingIp.prefixLength} is already in the PS3 subnet.`
          : `${currentIps.join(", ")} is not in the ${ps3Ip}/24 subnet.`
      }
    : {
        level: "warn",
        label: "PC Ethernet IP",
        detail: `Auto-map will add ${recommendedPcIp}/24 for this PS3 link.`
      });

  if (ps3Mac) {
    steps.push(ps3Neighbor
      ? {
          level: "ok",
          label: "PS3 MAC seen",
          detail: `${formatMacForDisplay(ps3Neighbor.linkLayerAddress)} on ${ps3Neighbor.interfaceAlias || "a local adapter"}.`
        }
      : {
          level: "warn",
          label: "PS3 MAC not seen yet",
          detail: `Auto-map can pin ${formatMacForDisplay(ps3Mac)} to ${ps3Ip} after the IP route is created.`
        });
  }

  steps.push(ftp.tested
    ? {
        level: ftp.ok ? "ok" : "warn",
        label: "FTP probe",
        detail: ftp.ok ? `Port 21 answered at ${ps3Ip}.` : ftp.error || `Port 21 did not answer at ${ps3Ip}.`
      }
    : {
        level: "warn",
        label: "FTP probe skipped",
        detail: ftp.error || "Auto-map first, then probe again."
      });

  const summary = matchingIp
    ? (ftp.ok ? `Direct LAN looks ready for ${ps3Ip}.` : `Ethernet is mapped to ${ps3Ip}; FTP did not answer yet.`)
    : `Auto-map can add ${recommendedPcIp}/24 and route only ${ps3Ip} over Ethernet.`;

  return {
    platform,
    adapter,
    adapterIps,
    ps3Ip,
    ps3Mac,
    ps3MacDisplay: formatMacForDisplay(ps3Mac),
    ps3MacSeen: Boolean(ps3Neighbor),
    ps3Neighbor,
    sameSubnet: Boolean(matchingIp),
    recommendedPcIp,
    ftp,
    summary,
    steps,
    applyScript: scripts.applyScript,
    restoreScript: scripts.restoreScript
  };
}

function buildDirectLanScripts({ adapterName, ps3Ip, ps3Mac, pcIp, prefixLength }) {
  const applyScript = [
    `$adapter = ${psQuote(adapterName)}`,
    `$ps3Ip = ${psQuote(ps3Ip)}`,
    `$ps3Mac = ${psQuote(ps3Mac)}`,
    `$pcIp = ${psQuote(pcIp)}`,
    `$prefix = ${Number(prefixLength) || 24}`,
    "if (-not (Get-NetIPAddress -InterfaceAlias $adapter -IPAddress $pcIp -ErrorAction SilentlyContinue)) {",
    "  New-NetIPAddress -InterfaceAlias $adapter -IPAddress $pcIp -PrefixLength $prefix | Out-Null",
    "}",
    "if (-not (Get-NetRoute -DestinationPrefix \"$ps3Ip/32\" -InterfaceAlias $adapter -ErrorAction SilentlyContinue)) {",
    "  New-NetRoute -DestinationPrefix \"$ps3Ip/32\" -InterfaceAlias $adapter -NextHop 0.0.0.0 -RouteMetric 1 | Out-Null",
    "}",
    "if ($ps3Mac) {",
    "  netsh interface ipv4 delete neighbors \"$adapter\" $ps3Ip 2>$null | Out-Null",
    "  netsh interface ipv4 add neighbors \"$adapter\" $ps3Ip $ps3Mac | Out-Null",
    "}",
    "Test-NetConnection -ComputerName $ps3Ip -Port 21"
  ].join("\n");

  const restoreScript = [
    `$adapter = ${psQuote(adapterName)}`,
    `$ps3Ip = ${psQuote(ps3Ip)}`,
    `$pcIp = ${psQuote(pcIp)}`,
    "Remove-NetRoute -DestinationPrefix \"$ps3Ip/32\" -InterfaceAlias $adapter -Confirm:$false -ErrorAction SilentlyContinue",
    "Remove-NetIPAddress -InterfaceAlias $adapter -IPAddress $pcIp -Confirm:$false -ErrorAction SilentlyContinue",
    "netsh interface ipv4 delete neighbors \"$adapter\" $ps3Ip 2>$null | Out-Null"
  ].join("\n");

  return { applyScript, restoreScript };
}

function buildElevatedDirectLanScript({
  action,
  adapterName,
  ps3Ip,
  ps3Mac,
  pcIp,
  prefixLength,
  addedIp = true,
  addedRoute = true,
  addedNeighbor = true
}) {
  const resultObject = "$result";
  const header = [
    "$ErrorActionPreference = 'Stop'",
    `$resultPath = ${psQuote("")}`,
    "try {",
    `  $adapter = ${psQuote(adapterName)}`,
    `  $ps3Ip = ${psQuote(ps3Ip)}`,
    `  $ps3Mac = ${psQuote(ps3Mac)}`,
    `  $pcIp = ${psQuote(pcIp)}`,
    `  $prefix = ${Number(prefixLength) || 24}`
  ];

  const applyLines = [
    "  $existingIp = Get-NetIPAddress -InterfaceAlias $adapter -IPAddress $pcIp -ErrorAction SilentlyContinue",
    "  $addedIp = $false",
    "  if (-not $existingIp) {",
    "    New-NetIPAddress -InterfaceAlias $adapter -IPAddress $pcIp -PrefixLength $prefix | Out-Null",
    "    $addedIp = $true",
    "  }",
    "  $existingRoute = Get-NetRoute -DestinationPrefix \"$ps3Ip/32\" -InterfaceAlias $adapter -ErrorAction SilentlyContinue",
    "  $addedRoute = $false",
    "  if (-not $existingRoute) {",
    "    New-NetRoute -DestinationPrefix \"$ps3Ip/32\" -InterfaceAlias $adapter -NextHop 0.0.0.0 -RouteMetric 1 | Out-Null",
    "    $addedRoute = $true",
    "  }",
    "  $addedNeighbor = $false",
    "  if ($ps3Mac) {",
    "    netsh interface ipv4 delete neighbors \"$adapter\" $ps3Ip 2>$null | Out-Null",
    "    netsh interface ipv4 add neighbors \"$adapter\" $ps3Ip $ps3Mac | Out-Null",
    "    $addedNeighbor = $true",
    "  }",
    "  Start-Sleep -Milliseconds 600",
    "  $ftpOpen = Test-NetConnection -ComputerName $ps3Ip -Port 21 -InformationLevel Quiet -WarningAction SilentlyContinue",
    `  ${resultObject} = [pscustomobject]@{ ok = $true; action = 'apply'; adapterName = $adapter; ps3Ip = $ps3Ip; ps3Mac = $ps3Mac; pcIp = $pcIp; addedIp = $addedIp; addedRoute = $addedRoute; addedNeighbor = $addedNeighbor; ftpOpen = $ftpOpen; finishedAt = (Get-Date).ToString('o') }`
  ];

  const restoreLines = [
    `  $removeRoute = ${addedRoute ? "$true" : "$false"}`,
    `  $removeIp = ${addedIp ? "$true" : "$false"}`,
    `  $removeNeighbor = ${addedNeighbor ? "$true" : "$false"}`,
    "  if ($removeRoute) {",
    "    Remove-NetRoute -DestinationPrefix \"$ps3Ip/32\" -InterfaceAlias $adapter -Confirm:$false -ErrorAction SilentlyContinue",
    "  }",
    "  if ($removeIp) {",
    "    Remove-NetIPAddress -InterfaceAlias $adapter -IPAddress $pcIp -Confirm:$false -ErrorAction SilentlyContinue",
    "  }",
    "  if ($removeNeighbor) {",
    "    netsh interface ipv4 delete neighbors \"$adapter\" $ps3Ip 2>$null | Out-Null",
    "  }",
    `  ${resultObject} = [pscustomobject]@{ ok = $true; action = 'restore'; adapterName = $adapter; ps3Ip = $ps3Ip; pcIp = $pcIp; removedIp = $removeIp; removedRoute = $removeRoute; removedNeighbor = $removeNeighbor; finishedAt = (Get-Date).ToString('o') }`
  ];

  const footer = [
    "  $result | ConvertTo-Json -Depth 5 -Compress | Set-Content -Path $resultPath -Encoding UTF8",
    "  exit 0",
    "} catch {",
    `  [pscustomobject]@{ ok = $false; action = ${psQuote(action)}; error = $_.Exception.Message; finishedAt = (Get-Date).ToString('o') } | ConvertTo-Json -Depth 5 -Compress | Set-Content -Path $resultPath -Encoding UTF8`,
    "  exit 1",
    "}"
  ];

  return {
    action,
    lines: [...header, ...(action === "restore" ? restoreLines : applyLines), ...footer]
  };
}

async function runElevatedPowerShell(scriptInfo, name) {
  const tempDir = path.join(os.tmpdir(), "JestersGameVault");
  await fs.mkdir(tempDir, { recursive: true });
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const scriptPath = path.join(tempDir, `${name}-${stamp}.ps1`);
  const resultPath = path.join(tempDir, `${name}-${stamp}.json`);
  const scriptText = scriptInfo.lines
    .join("\n")
    .replace("$resultPath = ''", `$resultPath = ${psQuote(resultPath)}`);
  await fs.writeFile(scriptPath, scriptText, "utf8");

  const command = [
    "$ErrorActionPreference = 'Stop'",
    `$process = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',${psQuote(scriptPath)}) -Verb RunAs -WindowStyle Hidden -Wait -PassThru`,
    "if ($process.ExitCode -ne 0) { exit $process.ExitCode }"
  ].join("\n");

  let launchError = null;
  try {
    await runProcess("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
      timeout: 180000
    });
  } catch (error) {
    launchError = error;
  }

  let parsed = null;
  try {
    const rawResult = await fs.readFile(resultPath, "utf8");
    parsed = JSON.parse(rawResult);
  } catch {
    // If UAC was cancelled there may be no result file to read.
  }

  await fs.rm(scriptPath, { force: true }).catch(() => {});
  await fs.rm(resultPath, { force: true }).catch(() => {});

  if (parsed) {
    if (!parsed.ok) throw new Error(parsed.error || "Direct LAN mapping did not complete.");
    return parsed;
  }

  if (launchError) {
    throw new Error(`Windows did not complete the admin Direct LAN action: ${launchError.message}`);
  }

  throw new Error("Windows did not return a Direct LAN result.");
}

function runProcess(fileName, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(fileName, args, {
      timeout: options.timeout || 10000,
      windowsHide: true,
      maxBuffer: 1024 * 1024
    }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function testTcpPort({ host, port, localAddress, timeoutMs }) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ tested: true, ...result });
    };

    socket.setTimeout(timeoutMs || 1800);
    socket.once("connect", () => finish({ ok: true }));
    socket.once("timeout", () => finish({ ok: false, error: `Timed out opening ${host}:${port}.` }));
    socket.once("error", (error) => finish({ ok: false, error: error.message }));
    socket.connect({ host, port, localAddress });
  });
}

function isValidIpv4(value) {
  const parts = String(value || "").trim().split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/u.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

function ipToInt(ipAddress) {
  return ipAddress.split(".").reduce((value, part) => ((value << 8) + Number(part)) >>> 0, 0);
}

function prefixToMask(prefixLength) {
  const prefix = Math.max(0, Math.min(Number(prefixLength) || 0, 32));
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

function isSameSubnet(leftIp, rightIp, prefixLength) {
  if (!isValidIpv4(leftIp) || !isValidIpv4(rightIp)) return false;
  const mask = prefixToMask(prefixLength);
  return (ipToInt(leftIp) & mask) === (ipToInt(rightIp) & mask);
}

function isApipaAddress(ipAddress) {
  return String(ipAddress || "").startsWith("169.254.");
}

function getRecommendedPcIp(ps3Ip) {
  const parts = ps3Ip.split(".").map(Number);
  parts[3] = parts[3] === 250 ? 249 : 250;
  return parts.join(".");
}

function netmaskToPrefix(netmask) {
  if (!isValidIpv4(netmask)) return 24;
  const bits = netmask
    .split(".")
    .map((part) => Number(part).toString(2).padStart(8, "0"))
    .join("");
  return bits.replace(/0+$/u, "").length;
}

function normalizeMacForWindows(value) {
  const raw = String(value || "").trim();
  const hex = raw.replace(/[^a-fA-F0-9]/gu, "").toUpperCase();
  if (hex.length !== 12) return "";
  return hex.match(/.{1,2}/gu).join("-");
}

function formatMacForDisplay(value) {
  return normalizeMacForWindows(value).replace(/-/g, ":");
}

function psQuote(value) {
  return `'${String(value || "").replace(/'/g, "''")}'`;
}

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}
