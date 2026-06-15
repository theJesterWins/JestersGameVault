const ftp = require("basic-ftp");
const fs = require("node:fs");
const path = require("node:path");

const [host, localPath, remoteDir] = process.argv.slice(2);

if (!host || !localPath || !remoteDir) {
  console.error("Usage: node scripts/upload-single.cjs <host> <localPath> <remoteDir>");
  process.exit(2);
}

const client = new ftp.Client(30000);
const startedAt = Date.now();
let lastPercent = -1;

function formatBytes(value) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = value;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  return `${amount >= 10 || unitIndex === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unitIndex]}`;
}

function formatElapsed(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

(async () => {
  const stat = fs.statSync(localPath);
  const remotePath = path.posix.join(remoteDir.replace(/\\/g, "/"), path.basename(localPath));

  console.log(`Connecting to ${host}:21`);
  await client.access({
    host,
    port: 21,
    user: "anonymous",
    password: "",
    secure: false
  });

  console.log(`Uploading ${localPath}`);
  console.log(`Destination ${remotePath}`);
  console.log(`Size ${formatBytes(stat.size)}`);

  client.trackProgress((info) => {
    const percent = stat.size ? Math.floor((info.bytesOverall / stat.size) * 100) : 0;
    if (percent !== lastPercent && (percent % 1 === 0 || percent === 100)) {
      lastPercent = percent;
      console.log(`${percent}% ${formatBytes(info.bytesOverall)} / ${formatBytes(stat.size)} elapsed ${formatElapsed(Date.now() - startedAt)}`);
    }
  });

  await client.ensureDir(remoteDir);
  await client.uploadFrom(localPath, remotePath);
  client.trackProgress();
  console.log(`DONE ${remotePath} elapsed ${formatElapsed(Date.now() - startedAt)}`);
})()
  .catch((error) => {
    console.error(`FAILED ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    client.close();
  });
