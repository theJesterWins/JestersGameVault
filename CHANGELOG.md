# Changelog

All notable beta changes for Jester's Game Vault are tracked here.

## 0.1.16 - 2026-06-16

- Added an optional **Support future projects** donation section to File > About.
- Added the Bitcoin wallet address with a Copy button in the About panel.
- Added an Electron clipboard bridge so About-copy actions work in the packaged desktop app.
- Added a Windows GitHub Actions release workflow so tagged releases can attach the Windows beta zip automatically.

Validation:

- `npm run lint`
- `npm run build`
- `node --check electron/main.cjs`
- `node --check electron/preload.cjs`
- Browser QA: About donation panel render, wallet visibility, Copy button state, and console health.
- `npm run release:beta`
- Packaged Windows EXE smoke test.

## 0.1.15 - 2026-06-16

- Added **Retry Failed** beside the queue controls to requeue failed upload/download transfer rows without reselecting files.
- Retry now preserves the original source, destination, size, transfer settings, reconnect/retry count, `.part` safety, and verification behavior.
- Failed destructive delete rows are intentionally left manual instead of being retried by the bulk transfer retry button.
- Updated browser-preview failure QA so the mock failed transfer can recover on retry.

Validation:

- `npm run lint`
- `npm run build`
- `node --check electron/main.cjs`
- `node --check electron/preload.cjs`
- Browser QA: mock failed queue row, Retry Failed recovery, retry button disabled after recovery, and console health.
- `npm run release:beta`
- Packaged Windows EXE smoke test.

## 0.1.14 - 2026-06-16

- Added **Clear Errors** beside the queue controls to remove failed queue rows plus warning/error log entries.
- Added **Clear Log** in the Live Log header for a full log reset.
- Kept active queued/transferring rows untouched when clearing errors.

Validation:

- `npm run lint`
- `npm run build`
- `node --check electron/main.cjs`
- `node --check electron/preload.cjs`
- Browser QA: mock failed queue row, Clear Errors, idle summary warning clear, Clear Log, and console health.
- `npm run release:beta`
- Packaged Windows EXE smoke test.

## 0.1.13 - 2026-06-16

- Added an **Ethernet Connect** button beside the PS3 IP field for the direct-cable flow.
- Added a **Connect Now** button inside Direct LAN so users no longer need to close the dialog and find the main Connect button.
- Added a compact Direct LAN walkthrough with cable, PS3, PC, and app steps.
- Updated the connection note to show when Ethernet FTP is ready.
- Stopped idle control-socket timeouts from flipping the app into a disconnected state while the PS3 FTP target is still known.

Validation:

- `npm run lint`
- `npm run build`
- `node --check electron/main.cjs`
- `node --check electron/preload.cjs`
- `npm run release:beta`
- Browser QA: main-bar Ethernet Connect, Direct LAN walkthrough, Connect Now, connected status, and console health.
- Packaged Windows EXE smoke test.

## 0.1.12 - 2026-06-16

- Rebuilt Direct LAN into a Direct LAN Builder for PC-to-PS3 Ethernet links.
- Added Ethernet adapter detection, current adapter IP reporting, PS3 MAC reporting, and FTP port probing.
- Added Windows auto-map support that requests admin rights, adds a temporary Ethernet IP, routes only the PS3 IP over Ethernet, and pins the PS3 MAC as a static neighbor when provided.
- Added Direct LAN restore support that removes the temporary route/IP/neighbor entries the app applied.
- Added copyable advanced Apply/Restore PowerShell scripts for manual troubleshooting.
- Updated the Direct LAN target flow so the app can fill the PS3 IP field from the builder.

Validation:

- `npm run lint`
- `npm run build`
- `node --check electron/main.cjs`
- `node --check electron/preload.cjs`
- `npm run release:beta`
- Browser QA: Direct LAN detection, mock auto-map, FTP-open state, and PS3 IP target fill.
- Packaged Windows EXE smoke test.

## 0.1.11 - 2026-06-16

- Added a toggleable Vault Library / Sync view that compares the current local folder with the active PS3 folder.
- Added library status rows for missing games, ready matches, size mismatches, missing PS3 ISO keys, orphan keys, remote-only items, and target-folder hints.
- Added summary counters and filters for needs-action, missing, ready, remote-only, and all library items.
- Added Library staging actions that select the local item and open the recommended PS3 target folder while reusing the existing transfer/key-pair flow.
- Added PS2/PSX/PSP target inference from the current PS3 folder and obvious filename hints.

Validation:

- `npm run lint`
- `npm run build`
- Browser QA: Library panel render, filter controls, scan refresh, and stage action.
- Packaged Windows EXE smoke test.

## 0.1.10 - 2026-06-16

- Fixed a transient Vault Doctor warning flash when switching quickly between PS2ISO/PS3ISO path buttons.
- Made Vault Doctor ignore stale remote rows from the previously viewed folder until the newly selected PS3 folder finishes loading.

Validation:

- `npm run lint`
- `npm run build`
- `npm run release:beta`
- Browser QA: PS2ISO -> PS3ISO path switching without a transient red Doctor banner.
- Packaged Windows EXE smoke test.

## 0.1.9 - 2026-06-16

- Reworked Vault Doctor into a compact warning banner that only appears for actionable warning/error items.
- Removed passive green "everything is OK" Doctor cards from the main workspace.
- Removed the passive `Wrong target folder risk` warning while browsing PS2/PSX/PSP folders with a local PS3 ISO selected.
- Fixed browser-preview path switching so QA no longer resets the mock PS3 folder after each path change.
- Added desktop-style resize handles for local/PS3 pane width, file area vs. queue height, and queue vs. live-log height.
- Kept the right-side rail contained with its own scroll area when the window is short or panels are resized.

Validation:

- `npm run lint`
- `npm run build`
- Browser QA: PS3ISO warning banner, PS2/PSX/PSP folder switching, no wrong-folder warning while browsing, resize handles, contained right rail, and no new console warnings/errors.

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
