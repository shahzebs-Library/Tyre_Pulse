# MCP: codebase-memory

The repo's `.mcp.json` registers a `codebase-memory` MCP server
(https://github.com/DeusData/codebase-memory-mcp). The config only points Claude
Code at the `codebase-memory-mcp` command — **each developer must install the
binary once on their own machine** for the server to start.

## Install the binary (one-time, per machine)

macOS / Linux:
```bash
# --skip-config: install the binary only; do NOT let it auto-rewrite configs for
# other agents. Our .mcp.json already wires it into this project.
curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash -s -- --skip-config
```
The binary lands in `~/.local/bin/codebase-memory-mcp`. Ensure `~/.local/bin` is
on your `PATH` (most shells already have it).

Windows (PowerShell): see the project README.

## Activate
MCP servers load at Claude Code **startup** — restart Claude Code after
installing. Approve the server when prompted (project-scoped servers require
per-user approval before they run).

## Notes
- The config uses the bare command name (`codebase-memory-mcp`), not an absolute
  path, so it resolves per-machine via `PATH` rather than hardcoding one user's
  home directory.
- Optional env vars (set in your shell or the `.mcp.json` `env` block if desired):
  `CBM_CACHE_DIR` (db location, default `~/.cache/codebase-memory-mcp`),
  `CBM_LOG_LEVEL`, `CBM_DIAGNOSTICS=1`.
- If you don't install the binary, Claude Code simply reports the server failed
  to start — it does not affect anything else in the project.
