import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  BadgeCheck,
  Cable,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  ClipboardCheck,
  Disc3,
  Download,
  FileUp,
  File,
  Folder,
  Gamepad2,
  HardDrive,
  Home,
  PlugZap,
  Power,
  RefreshCw,
  Router,
  Save,
  Search,
  Server,
  ShieldCheck,
  Trash2,
  Upload,
  X
} from "lucide-react";
import "./styles.css";
import jesterIcon from "./assets/jester-icon.png";

const PS3_PATHS = [
  { label: "PS3", path: "/dev_hdd0/PS3ISO/", hint: "PS3 ISO games" },
  { label: "PS2", path: "/dev_hdd0/PS2ISO/", hint: "PS2 ISO games" },
  { label: "PSX", path: "/dev_hdd0/PSXISO/", hint: "PS1 BIN/CUE or ISO" },
  { label: "PSP", path: "/dev_hdd0/PSPISO/", hint: "PSP ISO games" }
];

const PROFILE_STORAGE_KEY = "jgv.ps3Profiles";
const SETTINGS_STORAGE_KEY = "jgv.settings";
const DEFAULT_SETTINGS = {
  refreshAfterUpload: false
};

const SAMPLE_LOCAL = [
  folder("Homebrew", "2026-06-03T15:28:00Z"),
  folder("Owned Disc Dumps", "2026-06-07T19:12:00Z"),
  file("my_ps3_backup.iso", "ISO", 18_500_000_000, "2026-06-08T18:34:00Z"),
  file("ps2_collection_backup.iso", "ISO", 4_400_000_000, "2026-06-08T20:13:00Z"),
  file("webMAN_MOD_1.47.45.pkg", "PKG", 16_400_000, "2026-06-01T14:08:00Z"),
  file("README.txt", "Text", 2_100, "2026-05-29T10:22:00Z")
];

const SAMPLE_REMOTE = [
  folder("..", "2026-06-08T19:20:00Z"),
  file("existing_backup.iso", "ISO", 15_200_000_000, "2026-06-04T21:41:00Z"),
  file(".webman_ignore.txt", "Text", 120, "2026-05-22T11:09:00Z")
];

function folder(name, modifiedAt) {
  return {
    name,
    path: name,
    isDirectory: true,
    size: 0,
    type: "Folder",
    modifiedAt
  };
}

function file(name, type, size, modifiedAt) {
  return {
    name,
    path: name,
    isDirectory: false,
    size,
    type,
    modifiedAt
  };
}

function createMockApi() {
  let remotePath = "/dev_hdd0/PS3ISO/";

  return {
    async listLocal(targetPath) {
      return {
        path: targetPath || "",
        parent: targetPath ? "C:\\" : null,
        entries: targetPath ? SAMPLE_LOCAL.map((entry) => ({ ...entry, path: `${targetPath}\\${entry.name}` })) : []
      };
    },
    async pickLocalFolder() {
      return "";
    },
    async pickLocalFiles() {
      return [file("selected_ps3_backup.iso", "ISO", 8_900_000_000, new Date().toISOString())].map((entry) => ({
        ...entry,
        path: `C:\\Backups\\${entry.name}`
      }));
    },
    async pickLocalKeyFile() {
      const entry = file("selected_ps3_backup.key", "KEY", 16, new Date().toISOString());
      return { ...entry, path: `C:\\Backups\\${entry.name}` };
    },
    async findMatchingKeyFile(isoPath) {
      const isoName = fileNameFromPath(isoPath);
      const keyName = isoName.replace(/\.iso$/i, ".key");
      const entry = file(keyName, "KEY", 16, new Date().toISOString());
      return { ...entry, path: `C:\\Backups\\${entry.name}` };
    },
    getDroppedFilePath(fileItem) {
      return fileItem.path || "";
    },
    async connectFtp(config) {
      await wait(250);
      return { connected: true, host: config.host, port: config.port, user: config.username };
    },
    async disconnectFtp() {
      return { connected: false };
    },
    async ftpStatus() {
      return { connected: true, host: "192.168.1.159", port: 21, user: "anonymous" };
    },
    async listRemote(targetPath) {
      remotePath = targetPath || remotePath;
      return {
        path: remotePath,
        parent: "/dev_hdd0/",
        entries: SAMPLE_REMOTE.map((entry) => ({ ...entry, path: `${remotePath}${entry.name}` }))
      };
    },
    async uploadToRemote(payload) {
      await wait(900);
      const remoteName = payload.remoteName || payload.localPath.split("\\").pop();
      return {
        id: payload.id,
        remotePath: `${payload.remoteDir}${remoteName}`,
        remoteName,
        bytes: 42_000_000,
        elapsedMs: 900
      };
    },
    async cancelTransfer() {
      await wait(100);
      return { cancelled: true, active: true };
    },
    async verifyIsoKeyPair(payload) {
      await wait(200);
      return {
        ok: true,
        remoteDir: payload.remoteDir,
        iso: { name: payload.isoName, size: payload.expectedIsoBytes, sizeMatches: true },
        key: { name: payload.isoName.replace(/\.iso$/i, ".key"), size: 16 },
        expectedKeyNames: [payload.isoName.replace(/\.iso$/i, ".key"), payload.isoName.replace(/\.iso$/i, ".dkey")]
      };
    },
    async deleteRemote(payload) {
      await wait(300);
      return { deleted: true, remotePath: payload.remotePath, isDirectory: payload.isDirectory };
    },
    async runSpeedTest() {
      await wait(800);
      return { sizeBytes: 8_388_608, elapsedMs: 1800, bytesPerSecond: 4_660_337 };
    },
    async webmanAction(action) {
      await wait(300);
      return { action, ok: true, status: 200, url: `http://192.168.1.100/${action}.ps3` };
    },
    onTransferProgress() {
      return () => {};
    },
    onVaultEvent() {
      return () => {};
    }
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const api = window.vaultAPI || createMockApi();

function App() {
  const canceledTransfersRef = useRef(new Set());
  const [connection, setConnection] = useState({
    host: "",
    port: "21",
    username: "anonymous",
    password: "",
    connected: false
  });
  const [status, setStatus] = useState("Ready for PS3 FTP.");
  const [local, setLocal] = useState({ path: "", parent: null, entries: [] });
  const [remote, setRemote] = useState({ path: "/dev_hdd0/PS2ISO/", parent: null, entries: [] });
  const [selectedLocal, setSelectedLocal] = useState(null);
  const [selectedRemote, setSelectedRemote] = useState(null);
  const [queue, setQueue] = useState([]);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [profiles, setProfiles] = useState(() => readStoredProfiles());
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [profileName, setProfileName] = useState("");
  const [settings, setSettings] = useState(() => readStoredSettings());
  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const [keyPairCandidate, setKeyPairCandidate] = useState(null);
  const [remoteDragActive, setRemoteDragActive] = useState(false);
  const [lastProgressAt, setLastProgressAt] = useState(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [events, setEvents] = useState(() => [
    {
      id: "boot",
      level: "info",
      message: "Jester's Game Vault ready.",
      createdAt: new Date().toISOString()
    }
  ]);

  const pushEvent = useCallback((level, message, details = {}) => {
    setEvents((items) => [
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        level,
        message,
        details,
        createdAt: new Date().toISOString()
      },
      ...items
    ].slice(0, 80));
  }, []);

  const refreshLocal = useCallback(async (targetPath) => {
    try {
      const result = await api.listLocal(targetPath);
      setLocal(result);
      setSelectedLocal(null);
    } catch (error) {
      setStatus(`Local browse failed: ${error.message}`);
      pushEvent("error", `Local browse failed: ${error.message}`);
    }
  }, [pushEvent]);

  const refreshRemote = useCallback(async (targetPath = remote.path, force = false) => {
    if (!force && !connection.connected && window.vaultAPI) return;
    try {
      const result = await api.listRemote(targetPath);
      setRemote(result);
      setSelectedRemote(null);
    } catch (error) {
      setStatus(`PS3 browse failed: ${error.message}`);
      pushEvent("error", `PS3 browse failed: ${error.message}`);
      if (error.message.includes("Not connected")) {
        setConnection((current) => ({ ...current, connected: false }));
      }
    }
  }, [connection.connected, pushEvent, remote.path]);

  useEffect(() => {
    refreshLocal();
  }, [refreshLocal]);

  useEffect(() => {
    if (!window.vaultAPI) refreshRemote("/dev_hdd0/PS2ISO/");
  }, [refreshRemote]);

  useEffect(() => {
    const cleanup = api.onTransferProgress((progress) => {
      setQueue((items) =>
        items.map((item) =>
          item.id === progress.id
            ? {
                ...item,
                progress: progress.percent,
                bytesTransferred: progress.bytesOverall,
                bytesPerSecond: progress.bytesPerSecond,
                remainingMs: progress.remainingMs,
                elapsedMs: progress.elapsedMs,
                status: item.status === "Canceling" || item.status === "Canceled" ? item.status : "Transferring"
              }
            : item
        )
      );
      setLastProgressAt(Date.now());
    });
    return cleanup;
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const cleanup = api.onVaultEvent((event) => {
      setEvents((items) => [event, ...items].slice(0, 80));
    });
    return cleanup;
  }, []);

  useEffect(() => {
    writeStoredProfiles(profiles);
  }, [profiles]);

  useEffect(() => {
    writeStoredSettings(settings);
  }, [settings]);

  useEffect(() => {
    if (!window.vaultAPI) return undefined;

    const timer = setInterval(async () => {
      try {
        const result = await api.ftpStatus();
        setConnection((current) => {
          if (!current.connected || result.connected) return current;
          return { ...current, connected: false };
        });
      } catch {
        setConnection((current) => (current.connected ? { ...current, connected: false } : current));
      }
    }, 8000);

    return () => clearInterval(timer);
  }, []);

  const filteredLocalEntries = useMemo(() => applyFilter(local.entries, filter), [local.entries, filter]);
  const filteredRemoteEntries = useMemo(() => applyFilter(remote.entries, filter), [remote.entries, filter]);
  const selectedLocalEntry = local.entries.find((entry) => entry.path === selectedLocal);
  const selectedRemoteEntry = remote.entries.find((entry) => entry.path === selectedRemote);
  const activeTransfer = useMemo(() => {
    return (
      queue.find((item) => item.status === "Transferring") ||
      queue.find((item) => item.status === "Canceling") ||
      queue.find((item) => item.status === "Queued" || item.status === "Deleting") ||
      queue.find((item) => item.status === "Failed") ||
      queue.find((item) => item.status === "Completed") ||
      null
    );
  }, [queue]);
  const doctorReport = useMemo(
    () =>
      buildVaultDoctorReport({
        localEntries: local.entries,
        remoteEntries: remote.entries,
        remotePath: remote.path,
        selectedLocalEntry,
        selectedRemoteEntry,
        queue
      }),
    [local.entries, queue, remote.entries, remote.path, selectedLocalEntry, selectedRemoteEntry]
  );

  async function connect() {
    setBusy(true);
    try {
      const result = await api.connectFtp(connection);
      setConnection((current) => ({ ...current, connected: result.connected }));
      setStatus(`Connected to ${result.host}:${result.port} as ${result.user}.`);
      await refreshRemote(remote.path, true);
    } catch (error) {
      setConnection((current) => ({ ...current, connected: false }));
      setStatus(`Connection failed: ${error.message}`);
      pushEvent("error", `Connection failed: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    await api.disconnectFtp();
    setConnection((current) => ({ ...current, connected: false }));
    setStatus("Disconnected.");
    pushEvent("info", "Disconnected.");
  }

  function applyProfile(profileId) {
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile) {
      setSelectedProfileId("");
      setProfileName("");
      return;
    }

    setSelectedProfileId(profile.id);
    setProfileName(profile.name);
    setConnection((current) => ({
      ...current,
      host: profile.host,
      port: profile.port || "21",
      username: profile.username || "anonymous",
      password: profile.password || ""
    }));
    setStatus(`Loaded profile: ${profile.name}.`);
  }

  function saveProfile() {
    const host = connection.host.trim();
    if (!host) {
      setStatus("Enter a PS3 IP address before saving a profile.");
      pushEvent("warn", "Profile save skipped because no PS3 IP address is set.");
      return;
    }

    const name = profileName.trim() || host;
    const id = selectedProfileId || `profile-${Date.now()}`;
    const profile = {
      id,
      name,
      host,
      port: connection.port || "21",
      username: connection.username || "anonymous",
      password: connection.password || ""
    };

    setProfiles((items) => {
      const next = items.filter((item) => item.id !== id);
      return [...next, profile].sort((a, b) => a.name.localeCompare(b.name));
    });
    setSelectedProfileId(id);
    setProfileName(name);
    setStatus(`Saved PS3 profile: ${name}.`);
    pushEvent("success", `Saved PS3 profile: ${name}.`);
  }

  function deleteProfile() {
    if (!selectedProfileId) {
      setStatus("Select a saved profile before deleting one.");
      return;
    }
    const profile = profiles.find((item) => item.id === selectedProfileId);
    setProfiles((items) => items.filter((item) => item.id !== selectedProfileId));
    setSelectedProfileId("");
    setProfileName("");
    setStatus(profile ? `Deleted profile: ${profile.name}.` : "Deleted saved profile.");
  }

  async function runVaultDoctor() {
    const needsAttention = doctorReport.issues.filter((issue) => issue.severity !== "ok").length;
    setStatus(needsAttention ? `Vault Doctor found ${needsAttention} item(s) to check.` : "Vault Doctor found no issues in this view.");
    pushEvent(needsAttention ? "warn" : "success", needsAttention ? `Vault Doctor found ${needsAttention} item(s) to check.` : "Vault Doctor found no issues.");
    await refreshLocal(local.path);
    await refreshRemote(remote.path);
  }

  async function chooseLocalFolder() {
    const folderPath = await api.pickLocalFolder();
    if (folderPath) refreshLocal(folderPath);
  }

  async function chooseAndUploadFiles() {
    const pickedFiles = await api.pickLocalFiles();
    await uploadEntries(pickedFiles, { promptForIsoKey: true });
  }

  async function uploadDroppedFiles(event) {
    event.preventDefault();
    setRemoteDragActive(false);

    const droppedFiles = Array.from(event.dataTransfer.files || []);
    const entries = droppedFiles.map((fileItem) => {
      const filePath = api.getDroppedFilePath?.(fileItem) || fileItem.path || "";
      return {
        name: fileItem.name,
        path: filePath,
        isDirectory: false,
        size: fileItem.size,
        modifiedAt: new Date(fileItem.lastModified || Date.now()).toISOString(),
        type: fileTypeFromName(fileItem.name)
      };
    });

    if (entries.some((entry) => !entry.path)) {
      setStatus("Those files dropped in, but Electron did not expose their Windows paths. Use Choose files instead.");
      pushEvent("warn", "Dropped files did not expose Windows paths. Use Choose files instead.");
      return;
    }

    await uploadEntries(entries, { promptForIsoKey: true });
  }

  async function transferSelected() {
    if (!selectedLocalEntry || selectedLocalEntry.isDirectory) {
      setStatus("Select a file from Local Files before transferring, or use Choose files.");
      return;
    }

    await uploadEntries([selectedLocalEntry], { promptForIsoKey: true });
  }

  async function uploadEntries(entries, options = {}) {
    const { promptForIsoKey = false } = options;
    const files = entries.filter((entry) => entry?.path && !entry.isDirectory);
    if (files.length === 0) {
      setStatus("Choose one or more files to upload to the active PS3 folder.");
      pushEvent("warn", "Upload skipped because no files were selected.");
      return;
    }

    if (!connection.connected && window.vaultAPI) {
      setStatus("Connect to your PS3 before starting an FTP transfer.");
      pushEvent("warn", "Upload blocked because the PS3 FTP session is not connected.");
      return;
    }

    const autoMatch = promptForIsoKey ? await withAutoMatchedKeys(files) : { files, candidate: null };
    const filesForUpload = autoMatch.files;
    const keyPairPrompt = promptForIsoKey && isPs3IsoTarget(remote.path)
      ? autoMatch.candidate || getIsoKeyPairPrompt(filesForUpload)
      : null;
    if (keyPairPrompt) {
      setKeyPairCandidate(keyPairPrompt);
      setStatus(`Pair a key with ${keyPairPrompt.isoEntry.name} before uploading, or upload the ISO only.`);
      pushEvent("info", `Pair key requested for ${keyPairPrompt.isoEntry.name}.`);
      return;
    }

    const queuedFiles = prepareUploadJobs(filesForUpload);
    const uploadedJobs = [];
    let failedUploads = 0;
    let canceledUploads = 0;
    const shouldVerifyIsoKeys = isPs3IsoTarget(remote.path) && queuedFiles.some((job) => isPs3IsoKeyFile(job.remoteName));

    setQueue((items) => [
      ...queuedFiles.map(({ entry, id, remoteName, note }) => ({
        id,
        operation: isPs3IsoKeyFile(remoteName) ? "Transfer PS3 key" : "Transfer to PS3",
        source: entry.path,
        destination: `${remote.path}${remoteName}`,
        size: entry.size,
        progress: 0,
        status: "Queued",
        note,
        elapsedMs: 0
      })),
      ...items
    ]);

    for (const { entry, id, remoteName } of queuedFiles) {
      if (canceledTransfersRef.current.has(id)) {
        canceledUploads += 1;
        setQueue((items) =>
          items.map((item) =>
            item.id === id
              ? {
                  ...item,
                  status: "Canceled",
                  note: "Canceled before start"
                }
              : item
          )
        );
        pushEvent("warn", `Transfer canceled before start: ${entry.name}.`);
        continue;
      }

      setStatus(`Uploading ${entry.name} to ${remote.path}${remoteName}`);
      try {
        const result = await api.uploadToRemote({
          id,
          localPath: entry.path,
          remoteDir: remote.path,
          remoteName
        });
        if (canceledTransfersRef.current.has(id)) {
          canceledUploads += 1;
          setQueue((items) =>
            items.map((item) =>
              item.id === id
                ? {
                    ...item,
                    status: "Canceled",
                    note: "Canceled"
                  }
                : item
            )
          );
          setStatus(`Transfer canceled: ${entry.name}`);
          pushEvent("warn", `Transfer canceled for ${entry.name}.`);
          continue;
        }
        uploadedJobs.push({ entry, id, remoteName, result });
        setQueue((items) =>
          items.map((item) =>
            item.id === id
              ? {
                  ...item,
                  destination: result.remotePath,
                  progress: 100,
                  status: "Completed",
                  elapsedMs: result.elapsedMs
                }
              : item
          )
        );
        setStatus(`Transfer complete: ${entry.name}`);
      } catch (error) {
        const wasCanceled = canceledTransfersRef.current.has(id) || error.message.toLowerCase().includes("canceled");
        if (wasCanceled) {
          canceledUploads += 1;
          setQueue((items) =>
            items.map((item) =>
              item.id === id
                ? {
                    ...item,
                    status: "Canceled",
                    note: "Canceled; partial file may remain on PS3"
                  }
                : item
            )
          );
          setStatus(`Transfer canceled: ${entry.name}`);
          pushEvent("warn", `Transfer canceled for ${entry.name}. Partial file may remain on the PS3.`);
          continue;
        }

        failedUploads += 1;
        setQueue((items) =>
          items.map((item) => (item.id === id ? { ...item, status: "Failed", error: error.message } : item))
        );
        setStatus(`Transfer failed for ${entry.name}: ${error.message}`);
        pushEvent("error", `Transfer failed for ${entry.name}: ${error.message}`);
        if (error.message.includes("Not connected")) {
          setConnection((current) => ({ ...current, connected: false }));
        }
      }
    }

    if (shouldVerifyIsoKeys) {
      await verifyUploadedIsoKeys(uploadedJobs);
    }

    await refreshRemote(remote.path);

    if (uploadedJobs.length > 0 && failedUploads === 0 && canceledUploads === 0 && settings.refreshAfterUpload) {
      await runWebmanAction("refresh");
    } else if (canceledUploads > 0 && failedUploads === 0) {
      setStatus(`Transfer queue finished with ${canceledUploads} canceled item(s).`);
    }
  }

  async function cancelQueueItem(item) {
    if (!item || !["Queued", "Transferring"].includes(item.status)) return;

    canceledTransfersRef.current.add(item.id);
    setQueue((items) =>
      items.map((current) =>
        current.id === item.id
          ? {
              ...current,
              status: current.status === "Transferring" ? "Canceling" : "Canceled",
              note: current.status === "Transferring" ? "Cancel requested" : "Canceled before start"
            }
          : current
      )
    );

    setStatus(`Cancel requested: ${fileNameFromPath(item.source)}.`);
    pushEvent("warn", `Cancel requested for ${fileNameFromPath(item.source)}.`);

    if (item.status === "Transferring" && window.vaultAPI) {
      try {
        await api.cancelTransfer({ id: item.id });
      } catch (error) {
        pushEvent("error", `Cancel request failed: ${error.message}`);
      }
    }
  }

  async function withAutoMatchedKeys(files) {
    if (!isPs3IsoTarget(remote.path)) return { files, candidate: null };

    const nextFiles = [...files];
    const autoMatches = [];
    for (const isoEntry of files.filter((entry) => isPs3IsoFile(entry.name))) {
      const alreadyHasKey = nextFiles.some((entry) => isPs3IsoKeyFile(entry.name) && isIsoKeyMatch(isoEntry, entry));
      if (alreadyHasKey) continue;

      const nearbyKey = findMatchingKeyInEntries(isoEntry, local.entries) || await api.findMatchingKeyFile?.(isoEntry.path);
      if (!nearbyKey) continue;

      nextFiles.push(nearbyKey);
      autoMatches.push({ isoEntry, keyEntry: nearbyKey, autoMatched: true });
      pushEvent("success", `Auto-found matching key for ${isoEntry.name}: ${nearbyKey.name}.`);
    }

    return {
      files: nextFiles,
      candidate: files.filter((entry) => isPs3IsoFile(entry.name)).length === 1 && autoMatches.length === 1 ? autoMatches[0] : null
    };
  }

  async function verifyUploadedIsoKeys(uploadedJobs) {
    const isoJobs = uploadedJobs.filter((job) => isPs3IsoFile(job.remoteName));
    for (const job of isoJobs) {
      try {
        const result = await api.verifyIsoKeyPair({
          remoteDir: remote.path,
          isoName: job.remoteName,
          expectedIsoBytes: job.entry.size
        });
        if (result.ok) {
          setQueue((items) => items.map((item) => (item.id === job.id ? { ...item, status: "Verified" } : item)));
          setStatus(`ISO/key check passed: ${job.remoteName} + ${result.key.name}`);
          pushEvent("success", `ISO/key check passed for ${job.remoteName}.`);
        } else {
          const missing = result.key ? "ISO size mismatch" : `Missing ${result.expectedKeyNames.join(" or ")}`;
          setStatus(`ISO/key check needs attention: ${missing}`);
          pushEvent("warn", `ISO/key check needs attention for ${job.remoteName}: ${missing}.`);
        }
      } catch (error) {
        setStatus(`ISO/key check failed: ${error.message}`);
        pushEvent("error", `ISO/key check failed for ${job.remoteName}: ${error.message}`);
      }
    }
  }

  async function chooseKeyForPair() {
    const keyEntry = await api.pickLocalKeyFile();
    if (!keyEntry) return;
    setKeyPairCandidate((current) => (current ? { ...current, keyEntry } : current));
  }

  async function uploadPairedIsoKey() {
    if (!keyPairCandidate || !isIsoKeyMatch(keyPairCandidate.isoEntry, keyPairCandidate.keyEntry)) return;
    const entries = [keyPairCandidate.isoEntry, keyPairCandidate.keyEntry];
    setKeyPairCandidate(null);
    await uploadEntries(entries, { promptForIsoKey: false });
  }

  async function uploadIsoWithoutKey() {
    if (!keyPairCandidate) return;
    const { isoEntry } = keyPairCandidate;
    setKeyPairCandidate(null);
    setStatus(`Uploading ${isoEntry.name} without a key.`);
    pushEvent("warn", `Uploading ${isoEntry.name} without a paired key.`);
    await uploadEntries([isoEntry], { promptForIsoKey: false });
  }

  function requestDeleteRemote() {
    if (!selectedRemoteEntry) {
      setStatus("Select a PS3 file or folder before deleting.");
      pushEvent("warn", "Delete skipped because no PS3 item is selected.");
      return;
    }
    setDeleteCandidate(selectedRemoteEntry);
  }

  async function confirmDeleteRemote() {
    if (!deleteCandidate) return;
    if (!connection.connected && window.vaultAPI) {
      setStatus("Connect to your PS3 before deleting remote files.");
      pushEvent("warn", "Delete blocked because the PS3 FTP session is not connected.");
      setDeleteCandidate(null);
      return;
    }

    const candidate = deleteCandidate;
    const id = `${Date.now()}-delete-${candidate.name}`;
    setDeleteCandidate(null);
    setQueue((items) => [
      {
        id,
        operation: "Delete from PS3",
        source: candidate.path,
        destination: "Removed",
        size: candidate.size,
        progress: 0,
        status: "Deleting",
        elapsedMs: 0
      },
      ...items
    ]);
    setStatus(`Deleting ${candidate.path}`);

    try {
      await api.deleteRemote({
        remotePath: candidate.path,
        isDirectory: candidate.isDirectory
      });
      setQueue((items) =>
        items.map((item) => (item.id === id ? { ...item, progress: 100, status: "Completed" } : item))
      );
      setStatus(`Deleted ${candidate.name} from the PS3.`);
      await refreshRemote(remote.path);
    } catch (error) {
      setQueue((items) =>
        items.map((item) => (item.id === id ? { ...item, status: "Failed", error: error.message } : item))
      );
      setStatus(`Delete failed: ${error.message}`);
      pushEvent("error", `Delete failed: ${error.message}`);
      if (error.message.includes("Not connected")) {
        setConnection((current) => ({ ...current, connected: false }));
      }
    }
  }

  async function runWebmanAction(action) {
    try {
      const result = await api.webmanAction(action);
      setStatus(`${action === "restart" ? "Restart" : "Refresh XML"} request sent: ${result.url}`);
    } catch (error) {
      setStatus(`webMAN request failed: ${error.message}`);
      pushEvent("error", `webMAN request failed: ${error.message}`);
    }
  }

  async function runSpeedTest() {
    if (!connection.connected && window.vaultAPI) {
      setStatus("Connect to your PS3 before running the FTP speed test.");
      pushEvent("warn", "Speed test blocked because the PS3 FTP session is not connected.");
      return;
    }

    setStatus(`Running FTP speed test against ${remote.path}`);
    try {
      const result = await api.runSpeedTest({
        remoteDir: remote.path,
        sizeBytes: 8 * 1024 * 1024
      });
      setStatus(
        `Speed test: ${formatBytes(result.bytesPerSecond)}/s using ${formatBytes(result.sizeBytes)} in ${(
          result.elapsedMs / 1000
        ).toFixed(1)}s.`
      );
      await refreshRemote(remote.path);
    } catch (error) {
      setStatus(`Speed test failed: ${error.message}`);
      pushEvent("error", `Speed test failed: ${error.message}`);
      if (error.message.includes("Not connected")) {
        setConnection((current) => ({ ...current, connected: false }));
      }
    }
  }

  async function selectRemotePath(targetPath) {
    const normalizedPath = normalizeRemotePathText(targetPath);
    setRemote((current) => ({
      ...current,
      path: normalizedPath,
      parent: remoteParentPath(normalizedPath)
    }));
    await refreshRemote(normalizedPath);
  }

  function useDirectLanPreset() {
    setConnection((current) => ({
      ...current,
      host: "192.168.50.2",
      port: "21",
      username: "anonymous",
      password: ""
    }));
    setStatus("Direct Ethernet preset loaded. Set PC Ethernet to 192.168.50.1, then connect.");
    pushEvent("info", "Direct Ethernet preset loaded.");
  }

  function clearCompleted() {
    setQueue((items) => items.filter((item) => !["Completed", "Verified", "Canceled"].includes(item.status)));
  }

  return (
    <main className="app-shell">
      <header className="titlebar">
        <div className="brand">
          <img src={jesterIcon} alt="" className="brand-icon" />
          <div>
            <h1>Jester's Game Vault</h1>
            <p>For owned backups and homebrew</p>
          </div>
        </div>
        <div className="status-strip">
          <span className={connection.connected ? "status-dot live" : "status-dot"} />
          <span>{connection.connected ? "Connected" : "Disconnected"}</span>
          <span>FTP</span>
        </div>
      </header>

      <ProfileBar
        profiles={profiles}
        selectedProfileId={selectedProfileId}
        profileName={profileName}
        refreshAfterUpload={settings.refreshAfterUpload}
        onSelectProfile={applyProfile}
        onProfileNameChange={setProfileName}
        onSaveProfile={saveProfile}
        onDeleteProfile={deleteProfile}
        onRefreshAfterUploadChange={(refreshAfterUpload) => setSettings((current) => ({ ...current, refreshAfterUpload }))}
      />

      <section className="connection-bar" aria-label="PS3 FTP connection">
        <LabeledInput
          label="PS3 IP Address"
          value={connection.host}
          onChange={(host) => setConnection((current) => ({ ...current, host }))}
          placeholder="e.g. 192.168.1.149"
        />
        <LabeledInput label="Port" value={connection.port} onChange={(port) => setConnection((current) => ({ ...current, port }))} small />
        <LabeledInput
          label="Username"
          value={connection.username}
          onChange={(username) => setConnection((current) => ({ ...current, username }))}
        />
        <LabeledInput
          label="Password"
          value={connection.password}
          onChange={(password) => setConnection((current) => ({ ...current, password }))}
          placeholder="Optional"
          type="password"
        />
        {connection.connected ? (
          <button className="button secondary" type="button" onClick={disconnect}>
            <X size={17} />
            Disconnect
          </button>
        ) : (
          <button className="button primary" type="button" onClick={connect} disabled={busy}>
            <PlugZap size={17} />
            Connect
          </button>
        )}
        <div className="connection-note">
          <ShieldCheck size={16} />
          webMAN MOD usually uses anonymous FTP on port 21.
        </div>
      </section>

      <section className="workspace">
        <FilePane
          title="Local Files"
          tone="teal"
          pathText={local.path}
          parent={local.parent}
          entries={filteredLocalEntries}
          selectedPath={selectedLocal}
          selectedEntry={selectedLocalEntry}
          onSelect={setSelectedLocal}
          onOpen={(entry) => entry.isDirectory && refreshLocal(entry.path)}
          onUp={() => local.parent && refreshLocal(local.parent)}
          onRefresh={() => refreshLocal(local.path)}
          onHome={() => refreshLocal()}
          footer={`${local.entries.length} items`}
          emptyPathText="Choose a local folder or files"
          action={<button className="icon-button" type="button" title="Choose local folder" onClick={chooseLocalFolder}><HardDrive size={17} /></button>}
        />

        <TransferColumn
          selectedLocalEntry={selectedLocalEntry}
          onTransfer={transferSelected}
          onChooseFiles={chooseAndUploadFiles}
          connected={connection.connected || !window.vaultAPI}
        />

        <FilePane
          title="PS3 Vault"
          tone="gold"
          pathText={remote.path}
          parent={remote.parent}
          entries={filteredRemoteEntries}
          selectedPath={selectedRemote}
          selectedEntry={selectedRemoteEntry}
          onSelect={setSelectedRemote}
          onOpen={(entry) => entry.isDirectory && selectRemotePath(entry.path)}
          onUp={() => remote.parent && selectRemotePath(remote.parent)}
          onRefresh={() => refreshRemote(remote.path)}
          onHome={() => selectRemotePath("/dev_hdd0/")}
          footer={connection.connected || !window.vaultAPI ? `${remote.entries.length} remote items` : "Connect to browse PS3"}
          dropEnabled
          dragActive={remoteDragActive}
          onDragEnter={() => setRemoteDragActive(true)}
          onDragLeave={() => setRemoteDragActive(false)}
          onDropFiles={uploadDroppedFiles}
          action={
            <div className="pane-actions">
              <Server size={17} />
              <button
                className="icon-button danger"
                type="button"
                title="Delete selected PS3 item"
                disabled={!selectedRemoteEntry}
                onClick={requestDeleteRemote}
              >
                <Trash2 size={16} />
              </button>
            </div>
          }
        />

        <aside className="vault-rail">
          <div className="rail-section">
            <h2>PS3 Paths</h2>
            <div className="path-buttons">
              {PS3_PATHS.map((item) => (
                <button
                  className={remote.path === item.path ? "path-button active" : "path-button"}
                  type="button"
                  key={item.path}
                  onClick={() => selectRemotePath(item.path)}
                >
                  <Folder size={18} />
                  <span>
                    <strong>{item.path}</strong>
                    <small>{item.hint}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="rail-section">
            <h2>Utilities</h2>
            <button className="button full" type="button" onClick={() => runWebmanAction("refresh")}>
              <RefreshCw size={17} />
              Refresh XML
            </button>
            <button className="button full warning" type="button" onClick={() => runWebmanAction("restart")}>
              <Power size={17} />
              Restart PS3
            </button>
          </div>
          <div className="rail-section">
            <h2>Network</h2>
            <button className="button full" type="button" onClick={useDirectLanPreset}>
              <Router size={17} />
              Direct LAN
            </button>
            <button className="button full" type="button" onClick={runSpeedTest}>
              <Cable size={17} />
              Speed Test
            </button>
          </div>
        </aside>
      </section>

      <VaultDoctor report={doctorReport} onRun={runVaultDoctor} />

      <section className="queue-panel" aria-label="Transfer queue">
        <div className="queue-header">
          <div>
            <h2>Queue</h2>
            <p>{status}</p>
          </div>
          <div className="queue-actions">
            <label className="search-box">
              <Search size={16} />
              <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter files" />
            </label>
            <button className="button secondary" type="button" onClick={clearCompleted}>
              <Check size={16} />
              Clear Completed
            </button>
          </div>
        </div>
        <QueueTable items={queue} onCancel={cancelQueueItem} />
        <LiveLog events={events} />
      </section>

      <StatusBar
        connection={connection}
        activeTransfer={activeTransfer}
        status={status}
        lastProgressAt={lastProgressAt}
        nowMs={nowMs}
        onCancel={cancelQueueItem}
      />

      {deleteCandidate ? (
        <ConfirmDeleteDialog
          entry={deleteCandidate}
          onCancel={() => setDeleteCandidate(null)}
          onConfirm={confirmDeleteRemote}
        />
      ) : null}

      {keyPairCandidate ? (
        <KeyPairDialog
          candidate={keyPairCandidate}
          onChooseKey={chooseKeyForPair}
          onUploadIsoOnly={uploadIsoWithoutKey}
          onCancel={() => setKeyPairCandidate(null)}
          onConfirm={uploadPairedIsoKey}
        />
      ) : null}
    </main>
  );
}

function LabeledInput({ label, value, onChange, small = false, type = "text", placeholder }) {
  return (
    <label className={small ? "field small" : "field"}>
      <span>{label}</span>
      <input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function ProfileBar({
  profiles,
  selectedProfileId,
  profileName,
  refreshAfterUpload,
  onSelectProfile,
  onProfileNameChange,
  onSaveProfile,
  onDeleteProfile,
  onRefreshAfterUploadChange
}) {
  return (
    <section className="profile-bar" aria-label="Saved PS3 profiles and transfer options">
      <label className="profile-field">
        <span>Saved PS3</span>
        <select value={selectedProfileId} onChange={(event) => onSelectProfile(event.target.value)}>
          <option value="">New profile</option>
          {profiles.map((profile) => (
            <option value={profile.id} key={profile.id}>
              {profile.name} ({profile.host})
            </option>
          ))}
        </select>
      </label>
      <label className="profile-field name">
        <span>Profile Name</span>
        <input value={profileName} placeholder="Office PS3" onChange={(event) => onProfileNameChange(event.target.value)} />
      </label>
      <button className="button secondary" type="button" onClick={onSaveProfile}>
        <Save size={16} />
        Save Profile
      </button>
      <button className="button secondary" type="button" onClick={onDeleteProfile} disabled={!selectedProfileId}>
        <Trash2 size={16} />
        Delete Profile
      </button>
      <label className="toggle-option">
        <input
          type="checkbox"
          checked={refreshAfterUpload}
          onChange={(event) => onRefreshAfterUploadChange(event.target.checked)}
        />
        <span>Refresh XML after successful uploads</span>
      </label>
    </section>
  );
}

function VaultDoctor({ report, onRun }) {
  const icon = report.needsAttention > 0 ? <AlertTriangle size={18} /> : <BadgeCheck size={18} />;
  const topIssues = report.issues.slice(0, 4);

  return (
    <section className={`doctor-panel ${report.needsAttention > 0 ? "warn" : "ok"}`} aria-label="Vault Doctor diagnostics">
      <div className="doctor-summary">
        <div className="doctor-title">
          <span className="doctor-icon">{icon}</span>
          <div>
            <h2>Vault Doctor</h2>
            <p>{report.summary}</p>
          </div>
        </div>
        <div className="doctor-stats">
          <span><strong>{report.ready}</strong> Ready</span>
          <span><strong>{report.needsAttention}</strong> Check</span>
          <span><strong>{report.issues.length}</strong> Findings</span>
        </div>
        <button className="button secondary" type="button" onClick={onRun}>
          <ClipboardCheck size={16} />
          Scan
        </button>
      </div>
      <div className="doctor-findings">
        {topIssues.map((issue) => (
          <div className={`doctor-finding ${issue.severity}`} key={issue.id}>
            <strong>{issue.title}</strong>
            <span>{issue.detail}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function FilePane({
  title,
  tone,
  pathText,
  emptyPathText = "Loading...",
  parent,
  entries,
  selectedPath,
  selectedEntry,
  onSelect,
  onOpen,
  onUp,
  onRefresh,
  onHome,
  footer,
  action,
  dropEnabled = false,
  dragActive = false,
  onDragEnter,
  onDragLeave,
  onDropFiles
}) {
  return (
    <section
      className={`file-pane ${tone}${dropEnabled ? " drop-enabled" : ""}${dragActive ? " dragging" : ""}`}
      onDragEnter={(event) => {
        if (!dropEnabled) return;
        event.preventDefault();
        onDragEnter?.();
      }}
      onDragOver={(event) => {
        if (!dropEnabled) return;
        event.preventDefault();
      }}
      onDragLeave={(event) => {
        if (!dropEnabled || event.currentTarget.contains(event.relatedTarget)) return;
        onDragLeave?.();
      }}
      onDrop={(event) => {
        if (!dropEnabled) return;
        onDropFiles?.(event);
      }}
    >
      <div className="pane-header">
        <h2>{title}</h2>
        <div className="pane-action">{action}</div>
      </div>
      <div className="pathbar">
        <button className="icon-button" type="button" title="Back" disabled>
          <ChevronLeft size={16} />
        </button>
        <button className="icon-button" type="button" title="Forward" disabled>
          <ChevronRight size={16} />
        </button>
        <button className="icon-button" type="button" title="Home" onClick={onHome}>
          <Home size={16} />
        </button>
        <button className="icon-button" type="button" title="Up" onClick={onUp} disabled={!parent}>
          <Upload size={16} />
        </button>
        <div className="breadcrumb" title={pathText || emptyPathText}>{pathText || emptyPathText}</div>
        <button className="icon-button" type="button" title="Refresh" onClick={onRefresh}>
          <RefreshCw size={16} />
        </button>
      </div>

      <div className="file-table" role="table">
        {dropEnabled ? (
          <div className="drop-copy">
            <FileUp size={16} />
            Drop files here to upload to {pathText}
          </div>
        ) : null}
        <div className="file-row file-head" role="row">
          <span>Name</span>
          <span>Size</span>
          <span>Type</span>
          <span>Modified</span>
        </div>
        <div className="file-body">
          {entries.length === 0 ? (
            <div className="empty-state">No files to show</div>
          ) : (
            entries.map((entry) => (
              <button
                className={selectedPath === entry.path ? "file-row selected" : "file-row"}
                type="button"
                role="row"
                key={entry.path}
                onClick={() => onSelect(entry.path)}
                onDoubleClick={() => onOpen(entry)}
              >
                <span className="file-name">
                  {entry.isDirectory ? <Folder size={18} /> : entry.type === "ISO" ? <Disc3 size={18} /> : <File size={18} />}
                  <span>{entry.name}</span>
                </span>
                <span>{entry.isDirectory ? "" : formatBytes(entry.size)}</span>
                <span>{entry.type}</span>
                <span>{formatDate(entry.modifiedAt)}</span>
              </button>
            ))
          )}
        </div>
      </div>

      <footer className="pane-footer">
        <span>{footer}</span>
        <span>{selectedEntry ? selectedEntry.name : "No selection"}</span>
      </footer>
    </section>
  );
}

function TransferColumn({ selectedLocalEntry, onTransfer, onChooseFiles, connected }) {
  const canTransfer = connected && selectedLocalEntry && !selectedLocalEntry.isDirectory;
  return (
    <section className="transfer-column">
      <button className="transfer-button choose" type="button" disabled={!connected} onClick={onChooseFiles}>
        <FileUp size={18} />
        <span>Choose Files</span>
      </button>
      <button className="transfer-button" type="button" disabled={!canTransfer} onClick={onTransfer}>
        <Upload size={18} />
        <span>Transfer to PS3</span>
      </button>
      <button className="transfer-button muted" type="button" disabled>
        <Download size={18} />
        <span>Transfer to PC</span>
      </button>
      <div className="transfer-hint">
        <Cable size={18} />
        <p>IP FTP session</p>
      </div>
      <div className="vault-badge">
        <Gamepad2 size={18} />
        <span>Cobra + webMAN ready</span>
      </div>
    </section>
  );
}

function QueueTable({ items, onCancel }) {
  if (items.length === 0) {
    return (
      <div className="queue-empty">
        <Circle size={10} />
        Transfers will appear here.
      </div>
    );
  }

  return (
    <div className="queue-table" role="table">
      <div className="queue-row queue-head" role="row">
        <span>Operation</span>
        <span>Source</span>
        <span>Destination</span>
        <span>Size</span>
        <span>Progress</span>
        <span>Status</span>
        <span>Action</span>
      </div>
      {items.map((item) => (
        <div className="queue-row" role="row" key={item.id}>
          <span>{item.operation}</span>
          <span title={item.source}>{item.source}</span>
          <span title={item.destination}>{item.destination}</span>
          <span>{formatBytes(item.size)}</span>
          <span className="progress-cell">
            <span className="progress-track">
              <span style={{ width: `${item.progress}%` }} />
            </span>
            <strong>{item.progress}%</strong>
            <small>
              {item.note || (item.bytesTransferred ? `${formatBytes(item.bytesTransferred)} copied` : "Waiting")}
              {item.bytesPerSecond ? ` at ${formatBytes(item.bytesPerSecond)}/s` : ""}
              {item.remainingMs ? `, ${formatDuration(item.remainingMs)} left` : ""}
            </small>
          </span>
          <span className={`queue-status ${item.status.toLowerCase()}`}>{item.status}</span>
          <span className="queue-action">
            {["Queued", "Transferring"].includes(item.status) ? (
              <button className="icon-button danger" type="button" title="Cancel transfer" onClick={() => onCancel(item)}>
                <X size={15} />
              </button>
            ) : null}
          </span>
        </div>
      ))}
    </div>
  );
}

function LiveLog({ events }) {
  return (
    <section className="live-log" aria-label="Live operation log">
      <div className="live-log-header">
        <h2>Live Log</h2>
        <span>{events.length} events</span>
      </div>
      <div className="live-log-list">
        {events.map((event) => (
          <div className={`live-log-row ${event.level}`} key={event.id}>
            <time>{formatTime(event.createdAt)}</time>
            <strong>{event.level}</strong>
            <span title={event.details ? JSON.stringify(event.details) : ""}>{event.message}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function prepareUploadJobs(files) {
  const createdAt = Date.now();
  const isoEntries = files.filter((entry) => isPs3IsoFile(entry.name));
  const isoByBase = new Map(isoEntries.map((entry) => [baseNameWithoutExtension(entry.name), entry]));

  return files.map((entry, index) => {
    let remoteName = entry.name;
    let note = "";

    if (isPs3IsoKeyFile(entry.name)) {
      const keyBase = baseNameWithoutExtension(entry.name);
      if (isoByBase.has(keyBase)) {
        note = "Spelling OK";
      }
    }

    return {
      entry,
      id: `${createdAt}-${index}-${entry.name}`,
      remoteName,
      note
    };
  });
}

function getIsoKeyPairPrompt(files) {
  const isoEntries = files.filter((entry) => isPs3IsoFile(entry.name));
  const keyEntries = files.filter((entry) => isPs3IsoKeyFile(entry.name));

  if (isoEntries.length !== 1) return null;
  if (keyEntries.length === 0) return { isoEntry: isoEntries[0], keyEntry: null };
  if (keyEntries.length === 1 && !isIsoKeyMatch(isoEntries[0], keyEntries[0])) {
    return { isoEntry: isoEntries[0], keyEntry: keyEntries[0] };
  }
  return null;
}

function StatusBar({ connection, activeTransfer, status, lastProgressAt, nowMs, onCancel }) {
  const secondsSinceProgress = lastProgressAt ? Math.floor((nowMs - lastProgressAt) / 1000) : null;
  const isMoving = activeTransfer?.status === "Transferring" && secondsSinceProgress !== null && secondsSinceProgress < 15;
  const isProblem = activeTransfer?.status === "Failed" || (!connection.connected && activeTransfer?.status === "Transferring");
  const canCancel = activeTransfer && ["Queued", "Transferring"].includes(activeTransfer.status);
  const mode = isProblem ? "error" : isMoving ? "moving" : connection.connected ? "ready" : "offline";
  const activeName = activeTransfer ? fileNameFromPath(activeTransfer.source) : "No active transfer";
  const copiedText = activeTransfer?.bytesTransferred
    ? `${formatBytes(activeTransfer.bytesTransferred)} / ${formatBytes(activeTransfer.size)}`
    : activeTransfer?.size
      ? `0 B / ${formatBytes(activeTransfer.size)}`
      : "--";
  const speedText = activeTransfer?.bytesPerSecond ? `${formatBytes(activeTransfer.bytesPerSecond)}/s` : "--";
  const etaText = activeTransfer?.remainingMs ? formatDuration(activeTransfer.remainingMs) : "--";
  const freshnessText = secondsSinceProgress === null ? "No progress yet" : `Updated ${formatDuration(secondsSinceProgress * 1000)} ago`;

  return (
    <footer className={`bottom-status ${mode}`}>
      <div className="bottom-status-main">
        <span className="status-pulse" />
        <strong>{isProblem ? "Needs attention" : isMoving ? "Moving" : connection.connected ? "Connected" : "Disconnected"}</strong>
        <span title={activeTransfer?.source || status}>{activeName}</span>
      </div>
      <div className="bottom-status-progress">
        <span className="mini-progress">
          <span style={{ width: `${activeTransfer?.progress || 0}%` }} />
        </span>
        <strong>{activeTransfer ? `${activeTransfer.progress}%` : "--"}</strong>
      </div>
      <div className="bottom-status-stats">
        <span>{copiedText}</span>
        <span>{speedText}</span>
        <span>{etaText}</span>
        <span>{freshnessText}</span>
        {canCancel ? (
          <button className="status-cancel" type="button" onClick={() => onCancel(activeTransfer)}>
            <X size={14} />
            Cancel
          </button>
        ) : null}
      </div>
    </footer>
  );
}

function ConfirmDeleteDialog({ entry, onCancel, onConfirm }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title">
        <div className="confirm-icon">
          <Trash2 size={22} />
        </div>
        <div className="confirm-copy">
          <h2 id="delete-title">Delete from PS3?</h2>
          <p>This removes the selected {entry.isDirectory ? "folder and its contents" : "file"} from your PS3 over FTP.</p>
          <code>{entry.path}</code>
        </div>
        <div className="confirm-actions">
          <button className="button secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="button danger-action" type="button" onClick={onConfirm}>
            <Trash2 size={16} />
            Delete
          </button>
        </div>
      </section>
    </div>
  );
}

function KeyPairDialog({ candidate, onChooseKey, onUploadIsoOnly, onCancel, onConfirm }) {
  const expectedNames = expectedKeyNamesForIso(candidate.isoEntry.name);
  const selectedKeyName = candidate.keyEntry?.name || "";
  const hasKey = Boolean(candidate.keyEntry);
  const matches = isIsoKeyMatch(candidate.isoEntry, candidate.keyEntry);

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirm-dialog key-dialog" role="dialog" aria-modal="true" aria-labelledby="key-pair-title">
        <div className={matches ? "confirm-icon key-ok" : "confirm-icon key-warn"}>
          {matches ? <Check size={22} /> : <ShieldCheck size={22} />}
        </div>
        <div className="confirm-copy">
          <h2 id="key-pair-title">Pair PS3 ISO Key</h2>
          <p>
            {candidate.autoMatched
              ? "A matching key was found beside the ISO. Confirm the pair before upload."
              : "Select the matching `.key` or `.dkey` file. The key name must match the ISO spelling exactly."}
          </p>
          <div className="pair-check">
            <span>ISO</span>
            <code>{candidate.isoEntry.name}</code>
            <span>Expected key</span>
            <code>{expectedNames.join(" or ")}</code>
            <span>Selected key</span>
            <code className={hasKey && !matches ? "mismatch" : ""}>{selectedKeyName || "No key selected"}</code>
          </div>
          <div className={matches ? "pair-result ok" : "pair-result warn"}>
            {matches ? "Spelling check passed. This key will upload beside the ISO." : "Spelling check waiting for an exact filename match."}
          </div>
        </div>
        <div className="confirm-actions key-actions">
          <button className="button secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="button secondary" type="button" onClick={onUploadIsoOnly}>
            Upload ISO Only
          </button>
          <button className="button secondary" type="button" onClick={onChooseKey}>
            <FileUp size={16} />
            Select Key
          </button>
          <button className="button primary" type="button" onClick={onConfirm} disabled={!matches}>
            <Check size={16} />
            Upload Pair
          </button>
        </div>
      </section>
    </div>
  );
}

function applyFilter(entries, filter) {
  const term = filter.trim().toLowerCase();
  if (!term) return entries;
  return entries.filter((entry) => `${entry.name} ${entry.type}`.toLowerCase().includes(term));
}

function fileTypeFromName(fileName) {
  const ext = fileName.split(".").pop()?.toLowerCase();
  const labels = {
    iso: "ISO",
    bin: "BIN",
    cue: "CUE",
    pkg: "PKG",
    rap: "RAP",
    key: "KEY",
    dkey: "DKEY",
    sprx: "SPRX",
    self: "SELF"
  };
  return labels[ext] || "File";
}

function extensionFromName(fileName) {
  const match = fileName.match(/(\.[^.]+)$/u);
  return match ? match[1] : "";
}

function baseNameWithoutExtension(fileName) {
  return fileName.replace(/\.[^.]+$/u, "");
}

function isPs3IsoFile(fileName) {
  return extensionFromName(fileName).toLowerCase() === ".iso";
}

function isPs3IsoKeyFile(fileName) {
  return [".key", ".dkey"].includes(extensionFromName(fileName).toLowerCase());
}

function expectedKeyNamesForIso(isoName) {
  const baseName = baseNameWithoutExtension(isoName);
  return [`${baseName}.key`, `${baseName}.dkey`];
}

function isIsoKeyMatch(isoEntry, keyEntry) {
  if (!isoEntry || !keyEntry) return false;
  return expectedKeyNamesForIso(isoEntry.name).includes(keyEntry.name);
}

function findMatchingKeyInEntries(isoEntry, entries) {
  if (!isoEntry || !isPs3IsoFile(isoEntry.name)) return null;
  const expectedNames = expectedKeyNamesForIso(isoEntry.name);
  return entries.find((entry) => !entry.isDirectory && expectedNames.includes(entry.name)) || null;
}

function isPs3IsoTarget(remotePath) {
  return normalizeRemotePathText(remotePath).toLowerCase() === "/dev_hdd0/ps3iso/";
}

function normalizeRemotePathText(remotePath) {
  if (!remotePath) return "/";
  const normalized = remotePath.replace(/\\/g, "/").replace(/\/+/g, "/");
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

function remoteParentPath(remotePath) {
  const normalized = normalizeRemotePathText(remotePath);
  if (normalized === "/") return null;
  const trimmed = normalized.slice(0, -1);
  const slashIndex = trimmed.lastIndexOf("/");
  if (slashIndex <= 0) return "/";
  return `${trimmed.slice(0, slashIndex)}/`;
}

function isLikelyIsoKeySize(size) {
  return Number(size) > 0 && Number(size) <= 64;
}

function buildVaultDoctorReport({ localEntries, remoteEntries, remotePath, selectedLocalEntry, queue }) {
  const issues = [];
  const readyItems = new Set();
  const localFiles = localEntries.filter((entry) => !entry.isDirectory);
  const remoteFiles = remoteEntries.filter((entry) => !entry.isDirectory);
  const remoteByName = new Map(remoteFiles.map((entry) => [entry.name, entry]));
  const localByName = new Map(localFiles.map((entry) => [entry.name, entry]));
  const ps3Target = isPs3IsoTarget(remotePath);

  const addIssue = (severity, title, detail) => {
    issues.push({
      id: `${severity}-${issues.length}-${title}`,
      severity,
      title,
      detail
    });
  };

  for (const localFile of localFiles) {
    const remoteFile = remoteByName.get(localFile.name);
    if (!remoteFile) continue;
    if (localFile.size && remoteFile.size && localFile.size !== remoteFile.size) {
      addIssue("warn", "Size mismatch", `${localFile.name} exists locally and on the PS3, but the sizes differ.`);
    } else {
      readyItems.add(localFile.name);
      addIssue("ok", "Already on PS3", `${localFile.name} is present locally and remotely with a matching size.`);
    }
  }

  if (ps3Target) {
    const remoteIsos = remoteFiles.filter((entry) => isPs3IsoFile(entry.name));
    const remoteKeys = remoteFiles.filter((entry) => isPs3IsoKeyFile(entry.name));
    const localIsos = localFiles.filter((entry) => isPs3IsoFile(entry.name));
    const localKeys = localFiles.filter((entry) => isPs3IsoKeyFile(entry.name));

    for (const iso of remoteIsos) {
      const key = findMatchingKeyInEntries(iso, remoteFiles);
      if (!key) {
        addIssue("error", "Remote PS3 ISO missing key", `${iso.name} needs ${expectedKeyNamesForIso(iso.name).join(" or ")} beside it.`);
      } else if (!isLikelyIsoKeySize(key.size)) {
        addIssue("warn", "Unusual key size", `${key.name} is ${formatBytes(key.size) || "0 B"}; PS3 ISO keys are usually tiny.`);
      } else {
        readyItems.add(iso.name);
        addIssue("ok", "Remote ISO/key ready", `${iso.name} has ${key.name} in the PS3ISO folder.`);
      }
    }

    for (const key of remoteKeys) {
      const isoName = `${baseNameWithoutExtension(key.name)}.iso`;
      if (!remoteByName.has(isoName)) {
        addIssue("warn", "Remote key without ISO", `${key.name} has no matching ${isoName} in this PS3 folder.`);
      }
    }

    for (const iso of localIsos) {
      const key = findMatchingKeyInEntries(iso, localFiles);
      if (!key) {
        addIssue("warn", "Local PS3 ISO missing key", `${iso.name} has no same-name .key or .dkey in the local folder.`);
      } else if (!isLikelyIsoKeySize(key.size)) {
        addIssue("warn", "Local key size looks odd", `${key.name} is ${formatBytes(key.size) || "0 B"}; check that it is the disc key.`);
      }
    }

    for (const key of localKeys) {
      const isoName = `${baseNameWithoutExtension(key.name)}.iso`;
      if (!localByName.has(isoName)) {
        addIssue("warn", "Local key without ISO", `${key.name} has no matching local ${isoName}.`);
      }
    }
  } else {
    const selectedHasPs3Key = selectedLocalEntry && (
      isPs3IsoKeyFile(selectedLocalEntry.name) ||
      (isPs3IsoFile(selectedLocalEntry.name) && Boolean(findMatchingKeyInEntries(selectedLocalEntry, localFiles)))
    );
    if (selectedHasPs3Key) {
      addIssue("warn", "Wrong target folder risk", `${selectedLocalEntry.name} looks like PS3 ISO/key work, but the active PS3 folder is ${remotePath}.`);
    }
  }

  for (const item of queue) {
    if (item.status === "Failed") {
      addIssue("error", "Failed queue item", `${fileNameFromPath(item.source)} failed: ${item.error || "check the live log"}.`);
    }
  }

  if (issues.length === 0) {
    addIssue("ok", "Current view looks clean", "No obvious key, duplicate, size, or target-folder problems found.");
  }

  const needsAttention = issues.filter((issue) => issue.severity !== "ok").length;
  const summary = needsAttention
    ? `${needsAttention} thing${needsAttention === 1 ? "" : "s"} need attention in this local/remote view.`
    : "No obvious vault problems in this local/remote view.";

  return {
    issues: issues.sort((a, b) => severityRank(b.severity) - severityRank(a.severity)),
    needsAttention,
    ready: readyItems.size,
    summary
  };
}

function severityRank(severity) {
  return { error: 3, warn: 2, ok: 1 }[severity] || 0;
}

function readStoredProfiles() {
  if (typeof window.localStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PROFILE_STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item?.id && item?.host)
      .map((item) => ({
        id: String(item.id),
        name: String(item.name || item.host),
        host: String(item.host),
        port: String(item.port || "21"),
        username: String(item.username || "anonymous"),
        password: String(item.password || "")
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

function writeStoredProfiles(profiles) {
  if (typeof window.localStorage === "undefined") return;
  window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profiles));
}

function readStoredSettings() {
  if (typeof window.localStorage === "undefined") return DEFAULT_SETTINGS;
  try {
    return {
      ...DEFAULT_SETTINGS,
      ...JSON.parse(window.localStorage.getItem(SETTINGS_STORAGE_KEY) || "{}")
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeStoredSettings(settings) {
  if (typeof window.localStorage === "undefined") return;
  window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

function fileNameFromPath(value) {
  if (!value) return "";
  const parts = value.split(/[\\/]/);
  return parts[parts.length - 1] || value;
}

function formatBytes(value) {
  if (!value) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = value;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  return `${amount >= 10 || unitIndex === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unitIndex]}`;
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "--";
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

createRoot(document.getElementById("root")).render(<App />);
