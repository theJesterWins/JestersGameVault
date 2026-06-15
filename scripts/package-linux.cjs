const { packager } = require("@electron/packager");
const fs = require("node:fs/promises");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const artifactsRoot = path.join(projectRoot, "artifacts");
const appName = "Jester's Game Vault";
const executableName = "jesters-game-vault";

async function main() {
  const arch = process.env.JGV_LINUX_ARCH || "x64";
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const outputRoot = path.join(artifactsRoot, `linux-packaged-${stamp}`);
  await fs.mkdir(artifactsRoot, { recursive: true });
  await fs.mkdir(outputRoot, { recursive: true });

  const appPaths = await packager({
    dir: projectRoot,
    name: appName,
    executableName,
    platform: "linux",
    arch,
    out: outputRoot,
    overwrite: true,
    prune: true,
    asar: true,
    icon: path.join(projectRoot, "build", "icon-256.png"),
    appCopyright: "Copyright (c) 2026 theJesterWins",
    ignore: [
      /^\/\.git($|\/)/,
      /^\/\.github($|\/)/,
      /^\/artifacts.*($|\/)/,
      /^\/packaging($|\/)/,
      /^\/release($|\/)/,
      /^\/releases($|\/)/,
      /^\/coraline-upload\..*\.log$/,
      /^\/dev-server.*\.log$/,
      /^\/preview.*\.(log|pid)$/,
      /^\/.*\.(iso|bin|cue|pkg|rap|sprx|self|pfx|p12|key|pem)$/i
    ]
  });

  await fs.writeFile(path.join(artifactsRoot, "latest-linux-package-path.txt"), appPaths[0], "utf8");
  console.log(`Packaged Linux app: ${appPaths[0]}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
