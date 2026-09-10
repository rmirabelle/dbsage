# AGENTS.md

Guidance for Codex and other coding agents working in the DB Sage repository.
This file is based on the established xSage `CLAUDE.md` protocol and DB Sage's
actual project scripts and architecture.

## Instruction bootstrap rule

- Before doing project work, look for repository guidance in this order:
  `AGENTS.md`, then `CLAUDE.md` (case-insensitive).
- If a repository has `CLAUDE.md` but no `AGENTS.md`, first create an
  `AGENTS.md` derived from that exact repository's `CLAUDE.md`. Preserve every
  project command, architecture note, convention, warning, security constraint,
  installer rule, and release rule; adapt only agent-specific wording.
- Never ignore an existing `CLAUDE.md` merely because the active agent is not
  Claude. It is project documentation and remains authoritative.

## Build and development

```powershell
npm install

# Dev mode: Vite hot reload plus Rust rebuilds
npm run tauri dev

# Frontend type-check and production Vite build
npm run build

# TypeScript-only validation
npm exec tsc -- --noEmit

# Rust-only validation
Set-Location src-tauri
cargo check
```

- The user explicitly authorized local builds and publishing outside Codex's
  sandbox on September 7, 2026. Run development, build, test, npm, Cargo, Tauri,
  and publish commands through approved outside-sandbox execution under the
  user's normal Windows account. This supersedes the earlier sandbox-only rule.
- For publishing, use the approved entry point directly, without wrapping it
  in a different compound command:
  `& 'C:\Users\rmira\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe' -NoProfile -File 'D:\Code\DBSage\publish.ps1'`.
  Use `sandbox_permissions: "require_escalated"` and the scoped saved approval
  for that executable/script. Outside-sandbox execution does not require
  Windows administrator elevation or `Start-Process -Verb RunAs`.
- Keep the preferred `elevated` implementation for commands that still run in
  the sandbox. Do not switch to the `unelevated` fallback to troubleshoot builds.
- Do not ask for a Codex restart as routine troubleshooting. Diagnose the
  actual failure and use supported repair/reload controls where available.
  A restart request requires concrete evidence that the affected running
  process cannot adopt the repair, and an explanation of that limitation.
  Preserve progress and consult `docs/windows-build-runtime.md` first.
- After stopping `npm run tauri dev`, run `./kill-dev.ps1`. It tree-kills
  `dbsage.exe` and frees Vite port `14210`.
- Use `npm run tauri dev` for normal UI iteration so frontend and backend changes
  are exercised together.
- For Windows `spawn EPERM` failures, read `docs/windows-build-runtime.md` and
  check the recorded execution identity first. A build accidentally running as
  `CodexSandboxOffline` or `CodexSandboxOnline` must be relaunched through the
  approved outside-sandbox entry point; do not restart the sandbox diagnostic
  loop. The publisher runs `node scripts/check-build-runtime.mjs` in its own
  execution context. Use the project npm Tauri CLI, not the global Cargo CLI.

## What this app does

DB Sage is a Windows MySQL desktop client built with Tauri 2, React 19,
TypeScript, Tailwind CSS 4, Zustand, and Rust. It combines connection and server
management, a virtualized data grid, SQL querying, schema design and comparison,
custom relations, related-row peeks, backups, state transfer, and local MySQL
administration.

## Architecture

### Backend (`src-tauri/src/`)

- **`lib.rs`** — Tauri setup, window/tray wiring, plugins, managed state, and IPC
  command registration.
- **`commands/`** — IPC operations for profiles, connections, queries, schema
  and DDL, backup/restore, folders, relations, presets, state transfer,
  monitoring, local administration, and updates.
- **`store/`** — persistent profiles, secrets, folders, relations, column
  setups, and table-view presets. Passwords belong in Windows Credential Manager,
  never plaintext settings.
- **`db/`** — MySQL pools, query execution, metadata, and row serialization.
- **`crypto.rs`** — passphrase-based state-file encryption.
- **`updater.rs`** — public GitHub release updater.

### Frontend (`src/`)

- **`App.tsx`** — application shell, pane zoom, title bar, dialogs, and the main
  connection/tab workspace.
- **`components/`** — connection tree, database/table/query views, data grid,
  designer, comparisons, relations, monitor/admin windows, and dialogs.
- **`state/`** — Zustand stores for application data, UI layout, help text, and
  notifications.
- **`help/helpContent.ts`** — Help taxonomy, prose, screenshot registry, alt
  text, captions, and placement.
- **`components/HelpDialog.tsx`** — Help navigation, search, rendering, and
  physical-pixel-aware screenshot layout.
- **`ipc.ts`** — typed frontend wrappers over Tauri commands.

## Key patterns and non-negotiable behavior

- Tauri command names are `snake_case` in Rust. Frontend arguments are
  `camelCase`; keep Rust serde attributes and TypeScript types aligned.
- Saved database passwords use Windows Credential Manager. Never persist or log
  credentials in plaintext.
- DB Sage folders and custom relations are client-side organizational metadata;
  they must not silently mutate the MySQL schema.
- Normal minimize stays on the taskbar. Closing the main window offers Exit or
  Minimize to Tray. The tray icon exists only while the app is hidden and is
  removed when windows are restored; do not make it permanently visible.
- Destructive database operations require explicit confirmation and tightly
  resolved targets.
- Preserve cancellation and progress behavior for long queries, exports,
  backups, restores, and cross-database copies.
- Pane zoom is logical UI zoom. Do not use its CSS scaling assumptions for
  physical screenshot sizing.
- For explanatory multi-line code comments, use `/** */` blocks rather than two
  or more consecutive `//` lines.

## Help screenshots and CapSage masters

- PNG dimensions are physical image pixels, not WebView CSS pixels.
- A Help screenshot must never render larger than its original physical size.
- Convert physical PNG width to CSS width by dividing by the current WebView
  device scale (`window.devicePixelRatio` or the equivalent Tauri scale factor).
- Screenshots may shrink to fit available Help content, but may never be given
  `width: 100%`, a minimum display width, or any other rule that enlarges them.
- Keep manifest dimension names explicit (`physicalWidth` and
  `physicalHeight`). Never rename them to ambiguous `width` and `height`.
- Missing screenshots render nothing. Do not add reserved frames, placeholder
  titles, filenames, dimensions, or captions.
- `.capsage` files in `public/help/screenshots/` are source masters. Keep them
  tracked in Git, but never register or render them in Help; Help uses only PNGs.
- Incorporate screenshot batches by inspecting each PNG, placing it in the
  relevant article, and revising adjacent prose when context is missing.

## Updater and secrets

- DB Sage's GitHub repository is public. The updater uses the unauthenticated
  `releases/latest` API.
- Do not add an embedded GitHub PAT, API secret, obfuscation machinery, or a
  checked-in credential file to the updater.
- Treat any future change from public to private distribution as a deliberate
  security architecture change, not a small updater edit.

## Releases

- Before publishing, bump the version in all three locations:
  `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
- `./publish.ps1` builds the bundles, gives the NSIS and MSI artifacts clean
  `DBSage_<version>_...` names, removes older GitHub releases/tags, and publishes
  the current `v<version>` release.
- The updater depends on `releases/latest`; do not leave the intended current
  release as a draft.
- Do not run the publish workflow unless the user explicitly asks to publish.
- Run source checks, then the publish workflow once; it already builds both
  installers. Do not run a separate full Tauri build first just to rebuild the
  same source again during publishing.

## Installer

- `src-tauri/installer.nsi` is the shared xSage NSIS template and is referenced
  by `src-tauri/tauri.conf.json`.
- It contains the Public-folder shortcut-icon workaround. Do not replace it with
  Tauri's default NSIS template or remove its installer hooks.

## Working-tree discipline

- Preserve unrelated user changes in this frequently dirty worktree.
- Use `apply_patch` for hand-authored edits and keep changes scoped.
- Keep generated build output and temporary screenshot-database files out of
  commits. Keep PNG Help assets and their `.capsage` masters in commits.
