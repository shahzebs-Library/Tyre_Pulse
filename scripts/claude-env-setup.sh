#!/usr/bin/env bash
# Tooling for Claude Code cloud sessions on this repo.
#
# Point the cloud environment's SETUP SCRIPT at this file (Environment -> Edit ->
# Setup script: `bash scripts/claude-env-setup.sh`) so it runs once and is cached,
# rather than on every session start.
#
# Installs:
#   1. ux-skill engine (Laith0003/ux-skill) - the Python core behind the
#      `ux@ux-skill` plugin enabled in .claude/settings.json. Installed from the
#      GitHub source because the PyPI `uxskill` package lags (2.0 alpha vs 3.1).
#   2. codebase-memory-mcp - the binary .mcp.json expects at
#      ~/.local/bin/codebase-memory-mcp. Built from source because the agent
#      proxy blocks GitHub release downloads (which both the npm and PyPI
#      wrappers rely on). The build takes ~4 minutes.
#
# Idempotent: skips anything already present.
set -euo pipefail

WORK="${TMPDIR:-/tmp}/claude-env-setup"
mkdir -p "$WORK" "$HOME/.local/bin"

if ! command -v ux >/dev/null 2>&1; then
  rm -rf "$WORK/ux-skill"
  git clone --depth 1 https://github.com/Laith0003/ux-skill.git "$WORK/ux-skill"
  pip install -q "$WORK/ux-skill"
fi

if [ ! -x "$HOME/.local/bin/codebase-memory-mcp" ]; then
  rm -rf "$WORK/cbm"
  git clone --depth 1 https://github.com/DeusData/codebase-memory-mcp.git "$WORK/cbm"
  (cd "$WORK/cbm" && scripts/build.sh)
  cp "$WORK/cbm/build/c/codebase-memory-mcp" "$HOME/.local/bin/"
fi

ux stats >/dev/null && echo "ux-skill ready"
"$HOME/.local/bin/codebase-memory-mcp" --version

# Reusable Claude Code skills (pinned). A failure is reported, not fatal, so one
# unreachable repo never blocks the rest of the environment.
bash "$(dirname "$0")/install-claude-skills.sh" || echo "WARNING: some Claude skills failed to install (see above)"

# Security + code-graph tools (owner request 2026-10-04). Non-fatal.
command -v uv >/dev/null || pip install --quiet uv || true
uv tool install --python 3.12 strix-agent >/dev/null 2>&1 || echo "WARNING: strix-agent install failed"
uv tool install graphifyy >/dev/null 2>&1 && "$HOME/.local/bin/graphify" install --platform claude >/dev/null 2>&1 || echo "WARNING: graphify install failed"
claude plugin marketplace add obra/superpowers-marketplace >/dev/null 2>&1 || true
claude plugin install superpowers@superpowers-marketplace >/dev/null 2>&1 || echo "WARNING: superpowers plugin install failed"
