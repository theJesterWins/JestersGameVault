import { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Cable,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
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
      return [];
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
  const [deleteCandidate, setDeleteCandidate] = useState(null);
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
                status: "Transferring"
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
      queue.find((item) => item.status === "Queued" || item.status === "Deleting") ||
      queue.find((item) => item.status === "Failed") ||
      queue.find((item) => item.status === "Completed") ||
      null
    );
  }, [queue]);

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

  async function chooseLocalFolder() {
    const folderPath = await api.pickLocalFolder();
    if (folderPath) refreshLocal(folderPath);
  }

  async function chooseAndUploadFiles() {
    const pickedFiles = await api.pickLocalFiles();
    await uploadEntries(pickedFiles);
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

    await uploadEntries(entries);
  }

  async function transferSelected() {
    if (!selectedLocalEntry || selectedLocalEntry.isDirectory) {
      setStatus("Select a file from Local Files before transferring, or use Choose files.");
      return;
    }

    await uploadEntries([selectedLocalEntry]);
  }

  async function uploadEntries(entries) {
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

    const queuedFiles = prepareUploadJobs(files);
    const uploadedJobs = [];
    const shouldVerifyIsoKeys = queuedFiles.some((job) => isPs3IsoKeyFile(job.remoteName));

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
      setStatus(`Uploading ${entry.name} to ${remote.path}${remoteName}`);
      try {
        const result = await api.uploadToRemote({
          id,
          localPath: entry.path,
          remoteDir: remote.path,
          remoteName
        });
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
    setQueue((items) => items.filter((item) => item.status !== "Completed"));
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
          onOpen={(entry) => entry.isDirectory && refreshRemote(entry.path)}
          onUp={() => remote.parent && refreshRemote(remote.parent)}
          onRefresh={() => refreshRemote(remote.path)}
          onHome={() => refreshRemote("/dev_hdd0/")}
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
                  onClick={() => refreshRemote(item.path)}
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
        <QueueTable items={queue} />
        <LiveLog events={events} />
      </section>

      <StatusBar
        connection={connection}
        activeTransfer={activeTransfer}
        status={status}
        lastProgressAt={lastProgressAt}
        nowMs={nowMs}
      />

      {deleteCandidate ? (
        <ConfirmDeleteDialog
          entry={deleteCandidate}
          onCancel={() => setDeleteCandidate(null)}
          onConfirm={confirmDeleteRemote}
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

function QueueTable({ items }) {
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
  const keyEntries = files.filter((entry) => isPs3IsoKeyFile(entry.name));
  const isoByBase = new Map(isoEntries.map((entry) => [baseNameWithoutExtension(entry.name), entry]));

  return files.map((entry, index) => {
    let remoteName = entry.name;
    let note = "";

    if (isPs3IsoKeyFile(entry.name)) {
      const keyExt = extensionFromName(entry.name);
      const keyBase = baseNameWithoutExtension(entry.name);
      const keyBaseWithoutCopySuffix = keyBase.replace(/ \(\d+\)$/u, "");

      if (!isoByBase.has(keyBase) && isoByBase.has(keyBaseWithoutCopySuffix)) {
        remoteName = `${keyBaseWithoutCopySuffix}${keyExt}`;
        note = `Pairs as ${remoteName}`;
      } else if (!isoByBase.has(keyBase) && isoEntries.length === 1 && keyEntries.length === 1) {
        remoteName = `${baseNameWithoutExtension(isoEntries[0].name)}${keyExt}`;
        note = `Pairs as ${remoteName}`;
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

function StatusBar({ connection, activeTransfer, status, lastProgressAt, nowMs }) {
  const secondsSinceProgress = lastProgressAt ? Math.floor((nowMs - lastProgressAt) / 1000) : null;
  const isMoving = activeTransfer?.status === "Transferring" && secondsSinceProgress !== null && secondsSinceProgress < 15;
  const isProblem = activeTransfer?.status === "Failed" || (!connection.connected && activeTransfer?.status === "Transferring");
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
