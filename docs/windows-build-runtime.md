# Windows build-runtime diagnosis

## Current policy: approved local builds outside the sandbox

On September 7, 2026, the user explicitly authorized leaving the Codex sandbox
for local builds and publishing. This supersedes the earlier sandbox-only build
and release prohibitions recorded below. Keep the normal sandbox configuration
in `elevated` mode for other work; do not switch sandbox implementations.

Use this direct publisher entrypoint with `sandbox_permissions` set to
`require_escalated` and a matching scoped saved approval:

```powershell
& 'C:\Users\rmira\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe' -NoProfile -File 'D:\Code\DBSage\publish.ps1'
```

Run source checks in the same approved execution context, then run the publisher
once. It builds both installers; do not run a separate full Tauri build first.
Confirm the recorded Windows identity is the signed-in user, not a
`CodexSandboxOffline` or `CodexSandboxOnline` account. Validate both installers
and the public GitHub release before reporting publishing success.

This is an explicitly approved operational workaround, not a repair to Codex's
native sandbox. Do not restart the old sandbox troubleshooting loop during
publishing: no sandbox-mode changes, speculative ACL edits, repeated Node/MSI
probes, CI migration, or Codex restart requests. If the approved publisher
fails, inspect its actual execution identity and failing operation in that
context. Revisit native sandbox compatibility only when the user requests it.

The following sections preserve historical evidence. Earlier restrictions on
outside-sandbox builds and publication are superseded by this policy; their
successful probes still do not establish a native sandbox fix.

### Verified full publication: v0.38.2

On September 7, 2026, the canonical approved publisher ran as
`Office\rmirabelle` and exited successfully without a Codex restart. TypeScript
and Cargo source checks passed in the approved execution context. The publisher
passed Node's child-process checks, frontend and Rust compilation, WiX MSI
validation/packaging, NSIS packaging, and both GitHub uploads.

GitHub's `releases/latest` returned public, non-draft, non-prerelease `v0.38.2`
with both assets in the `uploaded` state. Both GitHub SHA-256 digests matched
the local files: `DBSage_0.38.2_x64-setup.exe` (19,534,031 bytes) and
`DBSage_0.38.2_x64_en-US.msi` (22,929,408 bytes).

Codex saved an allow rule for the exact PowerShell command above in the user
rules file; `codex execpolicy check` confirmed `decision: allow`. Preserve that
invocation rather than changing its shell wrapper. The publisher now rejects
dedicated Codex sandbox accounts before starting build tools and requires both
installers before changing releases. This is the verified working release path.

## Execution-context audit: September 7, 2026

Before treating any compiler error as a new root cause, compare how the
successful and failed commands were launched. The recovered command records
show:

| Release / command | Recorded execution request | Result |
| --- | --- | --- |
| v0.27.0 publisher, August 27 local time | Explicit `require_escalated` | Both installers and GitHub publication passed |
| v0.28.0 publisher, August 28 | Explicit `require_escalated` | Both installers and GitHub publication passed |
| v0.29.0 publisher, August 28 | Explicit `require_escalated` | Both installers and GitHub publication passed |
| v0.30.0 publisher, August 29 | Explicit `require_escalated` | Both installers and GitHub publication passed |
| v0.38.0 `npm run tauri build`, September 7 | Command matches saved outside-sandbox allow rule | Both installers passed |
| v0.38.0 publisher, seconds afterward | Default sandbox request; compound command does not match that rule | Node `EPERM` |
| v0.38.1 publisher, new task after mode repair | Default sandbox; printed identity `office\codexsandboxoffline` | Compilation passed; MSI validation failed |

The installed Codex `execpolicy check` confirms the saved allow-rule match
for `npm run tauri build` and no match for `./publish.ps1`. An allow rule on
a standalone build is not applied as a fresh permission decision to each
child command inside the publisher.

The historical successful publishers did not print their Windows identity.
Their explicit outside-sandbox request is recorded; do not invent a measured
account identity for those runs. Likewise, the rule check establishes the
standalone command's policy match, not a captured historical process token.

No complete publish found in the August/September local records establishes
success followed by failure under identical sandbox conditions. This does not
disprove the user's observed restart pattern; it means that earlier claims
of a repaired sandbox were based on uncontrolled comparisons. A successful
Node or frontend probe cannot establish full publishing compatibility.

At the time of this audit, outside-sandbox publishing was prohibited. That
restriction is superseded by the user's explicit authorization above. The audit
remains evidence of inconsistent execution contexts, not a native sandbox fix.

### Native launcher review and controlled profile test

The installed Codex 0.153.4 launcher intentionally calls
`CreateProcessWithLogonW` without `LOGON_WITH_PROFILE`, then starts commands
with a restricted token. The same profile-loading behavior and token flags
are present in 0.148.0, before the recent Windows hardening changes. Do not
attribute these behaviors to a new update without a version comparison.

On September 7, a controlled comparison tested whether the unloaded sandbox
account profile caused the MSI failure. An explicitly approved administrator
helper temporarily loaded the existing `CodexSandboxOffline` profile using
`LoadUserProfileW`. Both validation probes remained inside the original
sandbox, with unchanged restricted tokens. No build or installation ran in
the administrator helper.

| Probe | Profile unloaded | Profile loaded |
| --- | --- | --- |
| `MsiOpenPackageExW`, flags 0 | 0 (success) | 0 (success) |
| `MsiDoActionW`, ICE01 | 1603, underlying 1601/1719 | Same failure |

Node child-process and pipe checks also passed with the profile loaded.
The helper successfully called `UnloadUserProfile`; a subsequent check
confirmed the account hive was absent again. This rules out loading the
profile alone as a repair. Do not repeat this experiment as a proposed fix.
The local reproduction and separate before/after logs are under
`.codex-tmp/profile-loading-experiment-2/`; they are not release artifacts.

Recent Codex hardening includes failing sandbox preflight when ACL updates
fail instead of ignoring those errors. That can explain newly visible setup
failures, but does not establish the cause of MSI validation failing after
successful sandbox setup and compilation. No permanent native MSI repair
has been verified.

## Confirmed on September 7, 2026

In the restricted execution environment, a minimal Node process launching
`node --version` produced:

| Child stdio | Result |
| --- | --- |
| `inherit` | Passed |
| `ignore` | Passed |
| `pipe` | `spawn EPERM` |

The piped test failed with both the installed Node 25.2.1 and the bundled Node
24.19.0. This reproduces the failure without Vite, Tauri, Cargo, application code,
or network access. It isolates the problem to piped child-process creation in
this execution environment. The exact Windows permission failure is not yet
identified, but switching to the preferred sandbox was verified to resolve it
in a fresh sandbox process (details below).

esbuild 0.27.7 starts its service with `stdio: ['pipe', 'pipe', 'inherit']`.
Vite uses that service while loading its config. The resulting stack trace is a
runtime failure, not a TypeScript or application compilation error.

## Why seemingly identical builds behaved differently

The configured Codex Windows sandbox was `unelevated`, with
`sandbox_private_desktop = false`. Saved allow rules included
`npm run tauri build`; the compound PowerShell publish command did not match
that rule. Codex allow rules can execute matching commands outside the sandbox
without another prompt. Therefore a successful allow-listed build does not
demonstrate that the same build can run under sandbox restrictions.

There was also a launcher mismatch: publishing used global `cargo tauri`
2.10.1, while `npm run tauri` used the project dependency 2.11.2. Publishing now
uses the project CLI. That removes version drift, but does not repair piped
process creation by itself.

## Historical sandbox reproduction

Use this only when specifically investigating native sandbox compatibility,
not as a reason to retry an approved local release inside the sandbox. Run it
from the workspace under the sandbox being evaluated:

```powershell
node scripts/check-build-runtime.mjs
```

An outside-sandbox diagnostic cannot establish sandbox compatibility. All tests
and the complete build would have to pass in the intended sandbox before
claiming a native sandbox repair. The currently approved outside-sandbox
publisher is a separate operational workaround.

The diagnostic reports the working directory and Windows execution identity,
tests synchronous child creation, and tests a hidden asynchronous child with
bidirectional pipes. Each child test has a five-second timeout. The asynchronous
test covers pipe communication as well as process startup, matching the kind of
communication esbuild needs. The publisher already runs this diagnostic before
building.

## Recovered history: why previous fixes did not last

The September 1 task record explicitly shows an assistant switching the global
sandbox from `elevated` to `unelevated` to work around CapSage metadata ACL
refresh failures. The September 1 sandbox log records repeated
`SetNamedSecurityInfoW` error 5 on `D:\Code\CapSage\.codex`. These are setup
failures, distinct from Node's later pipe-creation failure.

The same task then reported Node/esbuild `EPERM` under `unelevated`, changed
private-desktop configuration, and ultimately used command-specific unrestricted
exceptions. Its claims of a durable repair were not supported by successful
sandboxed frontend builds. Do not reuse that fallback/exception recipe as a
verified solution.

In this follow-up investigation the saved global mode is `elevated`, both
repositories' `.git` directories are owned by `Office\rmirabelle`, and current
sandbox refreshes report `errors=[]`. The expanded asynchronous pipe test also
passes as `office\codexsandboxoffline`. Current logs still contain a failure to
hide `C:\Users\Default`; because the pipe tests and frontend build pass in this
state, that message alone does not establish the cause of Node `EPERM`.

The historical evidence establishes a sequence of different failures and
configuration changes, not that the same healthy sandbox spontaneously failed
five times. The exact Windows operation behind the earlier Node denial remains
unidentified. No current failure justifies another mode change or ACL rewrite.

The publish script checks this capability before starting its build. Run the
publish workflow once after source validation; a separate full Tauri build
before it only duplicates the work.

## Historical sandbox setup and partial verification

### Publishing verification, v0.38.1

The publisher passed its runtime checks, TypeScript/Vite build, and Rust release
compilation as `office\codexsandboxoffline`. MSI bundling failed in WiX 3.14.1:
verbose Tauri output identified `LGHT0217` during ICE validation, reporting that
the Windows Installer service could not be accessed. The service was running.
Direct linking with the inherited environment instead reported `LGHT0001`,
`E_ACCESSDENIED` in `CreateCabFinish`; a fresh output name and workspace-local
temporary directory did not resolve it. No validation checks were disabled.

The existing executable was packaged successfully with the project CLI's
NSIS-only bundle command, without recompiling or changing the NSIS template.
v0.38.1 was published with the NSIS asset only, as the publisher permitted at
that time when MSI was unavailable. GitHub access failed under the offline
sandbox and required
explicit approval for a separate upload/publication step containing no builds.
GitHub confirmed the release was public (`isDraft=false`). This is not a fully
sandboxed end-to-end publishing success: MSI packaging remains unresolved and
GitHub publication requires network permission.

### Follow-up session verification, September 7, 2026

The returning user's task ran `node scripts/check-build-runtime.mjs` through
the normal task shell with default sandbox permissions. Both uncaptured and
piped child-process tests passed on Node 25.2.1; `whoami` returned
`office\codexsandboxoffline`. `npm run build` then passed TypeScript and Vite
compilation in that task, with only the bundle-size warning. No sandbox
configuration changes, unrestricted retries, or restart were performed in
this follow-up session. This verifies current frontend build capability, not
a permanent fix for recurrence or successful installer packaging.

The earlier failure and repair history follows.

Official Codex documentation recommends the stronger Windows `elevated`
sandbox, which runs commands under dedicated lower-privilege users. Its name
refers to administrator-approved sandbox setup, not running builds as an
administrator or outside the sandbox. `unelevated` is a fallback implementation.

The September 1 config backup used `elevated`; historical setup logs contain
access-denied errors and the current setup-error marker says setup refresh had
errors. These are clues for repairing sandbox setup, not proof of the current
pipe failure's exact cause. Do not blindly change modes or Windows ACLs.

On September 7, the installed desktop CLI 0.153.4 successfully completed the
supported `windowsSandbox/setupStart` operation with mode `elevated` and cwd
`D:\Code\DBSage`. The original user config was backed up, and the supported
`config/value/write` operation saved `windows.sandbox = "elevated"`.

A fresh app-server then ran `command/exec` with an explicit `workspaceWrite`
sandbox policy and network access disabled. Verification results:

- `whoami`: `office\codexsandboxoffline`, confirming the dedicated sandbox user.
- Node 25.2.1 uncaptured and piped child processes: both passed.
- `npm run build`: TypeScript and Vite passed, including esbuild startup.

The already-running task's shell continued to fail the piped test after saving
the setting, while a fresh app-server passed. A restart was requested for this
specific session to reload the configuration; its result has not yet been
verified. This is historical context, not a standing instruction to restart.
The user explicitly prohibits switching to `unelevated` fallback mode and
rejects restarts as a routine workaround. The current policy above now directs
local builds and publishing through the approved outside-sandbox entrypoint.

There is no evidence from this investigation that an app update erased the
setting. The fallback change was present in September 1 configuration backups,
before the updated executable. Full installer building and GitHub publishing
have not yet been verified in the repaired sandbox.

The earlier `127.0.0.1:9` proxy refusal was a separate offline-sandbox network
restriction. The current policy authorizes the local publisher's build and
GitHub publication outside that sandbox; do not alter offline proxy settings.

References:
- https://learn.chatgpt.com/docs/windows/windows-sandbox
- https://learn.chatgpt.com/docs/agent-configuration/rules
