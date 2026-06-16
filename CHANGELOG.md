# Changelog

All notable beta changes for Jester's Game Vault are tracked here.

## 0.1.8 - 2026-06-16

- Added folder upload by expanding selected folders into resilient queue rows.
- Added PS3-to-PC download for selected remote files and folders.
- Added safe `.part` transfers so unfinished uploads/downloads do not masquerade as complete files.
- Added size verification after transfer and visible `Verified` queue status.
- Added preflight checks for destination folders, existing files, and leftover `.part` files.
- Added auto reconnect/retry for failed file attempts before a row is marked `Failed`.
- Added speed history for uploads, downloads, and FTP speed tests.
- Added a Direct LAN wizard with preset and speed-test controls.
- Updated the transfer controls to support non-ISO files and folders, not only ISO backups.
- Added File > About plus visible header version text.
- Unblocked PS3 folder browsing during active transfers by using dedicated FTP clients for long uploads/downloads.
- Added adjustable layout sliders for local/remote pane width, queue height, and live-log height.

Validation:

- `npm run lint`
- `npm run build`
- `npm run pack:linux`
- `npm run release:beta`
- Browser mock upload verification check
- Browser mock PS3-to-PC download check
- Browser mock folder upload expansion check
- Browser Direct LAN modal check
- Browser About/version panel check with no new console warnings
- Packaged Windows EXE mount, version, About, and layout slider checks

## 0.1.7 - 2026-06-15

- Added a resilient upload queue runner so newly selected games wait behind the active batch instead of racing it.
- Kept the queue moving after a single transfer fails, while marking only the bad row as `Failed`.
- Added per-batch completion summaries with completed, failed, and canceled counts.
- Let successful uploads still trigger the optional webMAN MOD XML refresh even when another queued item failed.
- Kept ISO/key verification tied to the PS3 folder that was queued, even if the user browses somewhere else while transfers run.

Validation:

- `npm run lint`
- `npm run build`
- `npm run pack:linux`
- `npm run release:beta`
- Browser mock failure queue check: completed, failed, completed
- Packaged Windows EXE mount check

## 0.1.6 - 2026-06-15

- Added cancel controls for queued transfers in the queue table.
- Added active FTP upload abort from the queue row or bottom status bar.
- Mark canceled transfers clearly and keep them visible for review.
- Leave partial PS3 files visible after an aborted upload so they can be deleted or retried intentionally.
- Updated Clear Completed so it also clears canceled rows.
- Kept PS3 key pairing, Vault Doctor, saved profiles, Direct LAN notes, and Linux packaging from earlier beta builds.

Validation:

- `npm run lint`
- `npm run build`
- `npm run pack:linux`
- `npm run release:beta`
- Browser mock transfer cancel check
- Packaged Windows EXE mount check

## 0.1.5 - 2026-06-15

- Added Vault Doctor checks for missing keys, orphan keys, duplicate files, size mismatches, and wrong PS3 target folders.
- Added saved PS3 connection profiles.
- Added optional webMAN MOD XML refresh after successful uploads.
- Added GitHub Actions Linux Flatpak and tarball publishing.
- Added Linux and Direct LAN documentation.

## 0.1.4 - 2026-06-15

- Added live transfer status improvements.
- Added stronger packaged app startup checks.
- Improved beta packaging and release asset handling.

## 0.1.3 - 2026-06-15

- Added PS3 ISO key pairing flow.
- Added same-name `.key` / `.dkey` upload support for PS3 ISO backups.
- Added spelling checks so key filenames match the selected ISO name before paired upload.

## 0.1.2 - 2026-06-15

- Fixed packaged app asset loading so the Windows EXE opens to the app instead of a blank screen.

## 0.1.1 - 2026-06-15

- Added early beta packaging for Windows.
- Improved startup behavior for portable builds.

## 0.1.0 - 2026-06-15

- Initial beta for Jester's Game Vault.
- Added WinSCP-style local and PS3 FTP panes.
- Added webMAN MOD FTP defaults for jailbroken PS3 file transfer.
- Added PS3 target path buttons for PS3, PS2, PSX, and PSP ISO folders.
- Added upload queue, delete support, refresh XML, restart PS3, Direct LAN preset, and FTP speed test.
