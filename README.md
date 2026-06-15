# Jester's Game Vault

A PS3-focused desktop FTP client with a WinSCP-style two-pane workflow.

Jester's Game Vault is free and open source software under the [MIT license](LICENSE).

Release history and beta revision notes are tracked in [CHANGELOG.md](CHANGELOG.md).

This app is intended for legally owned disc backups, homebrew, and console maintenance on a jailbroken PS3 running Evilnat CFW, Cobra, and webMAN MOD.

The main workflow is simple: dump or preserve a disc you own, select the correct PS3 ISO folder, transfer the backup, then refresh webMAN MOD so the game appears on the XMB.

## PS3 connection defaults

- Host: your PS3 IP address
- Port: `21`
- Username: `anonymous`
- Password: blank

## Built-in PS3 target folders

- `/dev_hdd0/PS3ISO/` for PS3 ISO backups
- `/dev_hdd0/PS2ISO/` for PS2 ISO backups
- `/dev_hdd0/PSXISO/` for PS1 BIN/CUE or ISO backups
- `/dev_hdd0/PSPISO/` for PSP ISO backups

## Run from source

```powershell
cd D:\Projects\JestersGameVault
npm install
npm run dev
```

## Build a Windows beta EXE

```powershell
npm install
npm run release:beta
```

The GitHub beta zip is written to `artifacts/github-beta/`. It contains a portable app folder with `Jester's Game Vault.exe` inside. It does not install anything system-wide.

For Windows trust and publisher identity, see [docs/windows-signing.md](docs/windows-signing.md).

## Install Linux release

Download the `.flatpak` bundle from the latest GitHub release, then run:

```bash
flatpak install --user ./JestersGameVault-Beta-0.1.6-linux-x86_64.flatpak
flatpak run io.github.thejesterwins.JestersGameVault
```

On Arch Linux or EndeavourOS, install Flatpak first:

```bash
sudo pacman -S flatpak
flatpak remote-add --user --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
```

## Build Linux Flatpak and tarball

Linux builds are intended to work across distributions, including Arch Linux, through Flatpak. See [docs/linux-flatpak.md](docs/linux-flatpak.md).

```bash
npm ci
npm run release:linux
```

Linux artifacts are written to `artifacts/github-beta/` as a `.flatpak` bundle and a portable `.tar.gz`.

## Faster wired transfers

For a steadier connection, use Ethernet instead of Wi-Fi. See [docs/direct-ethernet-ps3.md](docs/direct-ethernet-ps3.md) for router-wired and direct PC-to-PS3 setup.

## Current features

- Dual-pane local and PS3 FTP browser
- Connect to the PS3 by IP address using the webMAN MOD FTP defaults
- Save multiple PS3 connection profiles for quick switching
- Upload selected local files, picked files, or dropped files to the active PS3 folder
- Select a PS3 ISO, then choose its `.key` / `.dkey` in a pairing popup before upload
- Auto-detect a same-folder PS3 ISO key and prefill the pairing popup
- Check that the key filename spelling exactly matches the ISO filename before paired upload
- Verify after upload that a PS3 ISO and matching same-name key are present on the PS3
- Vault Doctor checks for missing keys, orphan keys, duplicates, size mismatches, and wrong target folders
- Optional webMAN MOD XML refresh after successful uploads
- Cancel queued transfers or abort the active FTP upload; partial files remain visible for review
- Delete selected files or folders from `/dev_hdd0/...` after confirmation
- Transfer queue with upload and delete status from Electron
- webMAN MOD `refresh.ps3` and `restart.ps3` utility buttons
- Direct LAN preset and FTP speed test for later Ethernet experiments
- Browser-preview fallback when Electron APIs are unavailable

## Notes

Delete is intentionally limited to `/dev_hdd0/...` paths and requires confirmation. The first version still avoids broader destructive actions such as local deletes, remote rename, and overwrite management.
