const { packager } = require("@electron/packager");
const fs = require("node:fs/promises");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const artifactsRoot = path.join(projectRoot, "artifacts");
const appName = "Jester's Game Vault";

async function main() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const outputRoot = path.join(artifactsRoot, `packaged-${stamp}`);
  await fs.mkdir(artifactsRoot, { recursive: true });
  await fs.mkdir(outputRoot, { recursive: true });

  const appPaths = await packager({
    dir: projectRoot,
    name: appName,
    platform: "win32",
    arch: "x64",
    out: outputRoot,
    overwrite: true,
    prune: true,
    asar: true,
    icon: path.join(projectRoot, "build", "icon.ico"),
    appCopyright: "Copyright (c) 2026 theJesterWins",
    win32metadata: {
      CompanyName: "theJesterWins",
      FileDescription: "Jester's Game Vault",
      InternalName: "JestersGameVault",
      OriginalFilename: "Jester's Game Vault.exe",
      ProductName: "Jester's Game Vault"
    },
    ignore: [
      /^\/\.git($|\/)/,
      /^\/artifacts.*($|\/)/,
      /^\/release($|\/)/,
      /^\/releases($|\/)/,
      /^\/coraline-upload\..*\.log$/,
      /^\/dev-server.*\.log$/,
      /^\/.*\.(iso|bin|cue|pkg|rap|sprx|self|pfx|p12|key|pem)$/i
    ]
  });

  await fs.writeFile(path.join(artifactsRoot, "latest-package-path.txt"), appPaths[0], "utf8");
  console.log(`Packaged Windows app: ${appPaths[0]}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
