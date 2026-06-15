# Linux Flatpak support

Jester's Game Vault can be built for Linux as:

- a Flatpak bundle: `JestersGameVault-Beta-<version>-linux-x86_64.flatpak`
- a portable tarball: `JestersGameVault-Beta-<version>-linux-x64.tar.gz`

The Flatpak is the preferred Linux build because it works across distributions, including Arch, Fedora, Ubuntu, Debian, and Linux Mint.

## Install a release Flatpak

Download the `.flatpak` bundle from the GitHub release page, then run:

```bash
flatpak install --user ./JestersGameVault-Beta-0.1.4-linux-x86_64.flatpak
flatpak run io.github.thejesterwins.JestersGameVault
```

The app needs network access for PS3 FTP/webMAN and filesystem access so you can select ISO/key files from your home folder or mounted game drives.

## Arch Linux setup

On Arch or EndeavourOS:

```bash
sudo pacman -S flatpak flatpak-builder
flatpak remote-add --user --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
```

Then install the release bundle:

```bash
flatpak install --user ./JestersGameVault-Beta-0.1.4-linux-x86_64.flatpak
flatpak run io.github.thejesterwins.JestersGameVault
```

## Build locally on Linux

```bash
npm ci
npm run release:linux
```

Outputs are written to `artifacts/github-beta/`.

## Portable tarball fallback

The tarball is useful if someone does not want Flatpak. Extract it and run:

```bash
tar -xzf JestersGameVault-Beta-0.1.4-linux-x64.tar.gz
cd "Jester's Game Vault-linux-x64"
./jesters-game-vault
```

The tarball has less desktop integration than the Flatpak, but it is handy for quick testing.
