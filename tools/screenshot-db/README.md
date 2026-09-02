# Screenshot database

This kit starts a second, isolated MySQL 8 instance on port 3307. It reuses the
installed MySQL binaries but has its own configuration and data directory under
`.codex-tmp/screenshot-mysql/`. It does not install, stop, restart, reconfigure,
or write to the existing `MySQL80` service on port 3306.

From the repository root:

```powershell
.\tools\screenshot-db\Start-ScreenshotDatabase.ps1
```

For automatic startup at Windows boot, install the isolated instance as the
separately named `MySQL3307` service from an Administrator PowerShell:

```powershell
.\tools\screenshot-db\Install-ScreenshotDatabaseService.ps1
```

The installer refuses to proceed unless the configuration uses port `3307`,
binds to `127.0.0.1`, and points at this kit's isolated data directory. It does
not modify the existing MySQL service on port `3306`.

Create this DB Sage connection:

| Setting | Value |
|---|---|
| Name | `Demo MySQL` |
| Host | `127.0.0.1` |
| Port | `3307` |
| Username | `dbsage_help` |
| Password | `dbsage-demo` |

Restore the standard invented data at any time:

```powershell
.\tools\screenshot-db\Reset-ScreenshotDatabase.ps1
```

Stop only the screenshot server:

```powershell
.\tools\screenshot-db\Stop-ScreenshotDatabase.ps1
```

The connection is intended for all screenshots involving databases, tables,
queries, relations, peeks, schema design, backup, or restore. The Server Admin
window discovers the registered Windows MySQL service, so that one screenshot
should use the existing service in a read-only state. Do not press its service
controls or save its configuration while preparing screenshots.

Every reset, seed, and shutdown operation first reads `@@datadir` from the
server on port 3307. It aborts unless that value exactly matches
`.codex-tmp/screenshot-mysql/data`. The seeded schemas are uniquely named
`dbsage_screenshot_demo` and `dbsage_screenshot_compare`. The latter contains
deliberate added, missing, and changed objects for comparison screenshots.
