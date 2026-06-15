const ftp = require("basic-ftp");

const [host, remoteDir, fileName, totalBytesText] = process.argv.slice(2);

if (!host || !remoteDir || !fileName) {
  console.error("Usage: node scripts/check-remote-file.cjs <host> <remoteDir> <fileName> [totalBytes]");
  process.exit(2);
}

const totalBytes = Number(totalBytesText || 0);
const client = new ftp.Client(10000);

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

(async () => {
  await client.access({
    host,
    port: 21,
    user: "anonymous",
    password: "",
    secure: false
  });

  const list = await client.list(remoteDir);
  const remoteFile = list.find((entry) => entry.name === fileName);
  if (!remoteFile) {
    console.log("Remote file not visible yet.");
    return;
  }

  const percent = totalBytes ? Math.floor((remoteFile.size / totalBytes) * 100) : null;
  console.log(
    `${remoteFile.name}: ${formatBytes(remoteFile.size)}${percent === null ? "" : ` / ${formatBytes(totalBytes)} (${percent}%)`}`
  );
})()
  .catch((error) => {
    console.error(`CHECK_FAILED ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    client.close();
  });
