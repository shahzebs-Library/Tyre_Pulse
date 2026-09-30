#!/usr/bin/env bash
# Installs the third-party Claude Code skills this project relies on into
# ~/.claude/skills (reusable, per machine). Project-specific skills live in
# .claude/skills and are committed; they need no install step.
#
# Every source is pinned to a commit so an upstream change cannot silently
# alter what the agent is told to do. Bump a pin only after reading the diff.
#
#   bash scripts/install-claude-skills.sh          install / refresh
#   bash scripts/install-claude-skills.sh --check  report what is installed, change nothing
#
# Exit code is non-zero when any skill failed, and the failure is printed by
# name. Nothing is substituted for a skill that could not be fetched.
set -uo pipefail

DEST="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

# repo | pinned commit | path in repo | installed name | kind (dir = SKILL.md folder, md = single file to wrap)
SOURCES=(
  "anthropics/claude-code|732e167ee9d71296b4b63d6f529ac1334513826a|plugins/frontend-design/skills/frontend-design|frontend-design|dir"
  "daymade/claude-code-skills|81244b6b870f3e126ab9731e7ff402d4c4975c5c|frontend-visual-qa|frontend-visual-qa|dir"
  "ShadmanSakibRahman/claude-skills-hub|b90edd9c9bea064ea47a3b5a5364af9742816414|skills/frontend/responsive-design.md|responsive-design|md"
  "ShadmanSakibRahman/claude-skills-hub|b90edd9c9bea064ea47a3b5a5364af9742816414|skills/frontend/accessibility-audit.md|accessibility-audit|md"
  "ShadmanSakibRahman/claude-skills-hub|b90edd9c9bea064ea47a3b5a5364af9742816414|skills/frontend/performance-audit.md|performance-audit|md"
  "ShadmanSakibRahman/claude-skills-hub|b90edd9c9bea064ea47a3b5a5364af9742816414|skills/frontend/design-system.md|design-system|md"
  "ShadmanSakibRahman/claude-skills-hub|b90edd9c9bea064ea47a3b5a5364af9742816414|skills/frontend/react-component.md|react-component|md"
  "ShadmanSakibRahman/claude-skills-hub|b90edd9c9bea064ea47a3b5a5364af9742816414|skills/frontend/nextjs-app.md|nextjs-app|md"
  "ShadmanSakibRahman/claude-skills-hub|b90edd9c9bea064ea47a3b5a5364af9742816414|skills/frontend/form-builder.md|form-builder|md"
  "ShadmanSakibRahman/claude-skills-hub|b90edd9c9bea064ea47a3b5a5364af9742816414|skills/frontend/state-management.md|state-management|md"
  "jojojobring/claude-skills|ff6978997b09ccb8ea62398012c3785359e889c4|full-review|full-review|dir"
  "jojojobring/claude-skills|ff6978997b09ccb8ea62398012c3785359e889c4|owasp-security|owasp-security|dir"
  "jojojobring/claude-skills|ff6978997b09ccb8ea62398012c3785359e889c4|webapp-testing|webapp-testing|dir"
)
for s in secure-storage-audit crypto-review auth-assessment network-security-check platform-interaction-review \
         code-quality-scan resilience-assessment privacy-audit mobile-threat-model masvs-checklist \
         secure-mobile-dev-guide mobile-pentest-plan; do
  SOURCES+=("dweinstein/mobile-security-skills|cb7ce51801057a52a91e883c80ce28f33bba73af|skills/$s|$s|dir")
done

ok=(); failed=()

if [ "$CHECK_ONLY" = 1 ]; then
  for entry in "${SOURCES[@]}"; do
    IFS='|' read -r _ _ _ name _ <<<"$entry"
    if [ -f "$DEST/$name/SKILL.md" ]; then ok+=("$name"); else failed+=("$name (not installed)"); fi
  done
else
  mkdir -p "$DEST"
  declare -A fetched
  for entry in "${SOURCES[@]}"; do
    IFS='|' read -r repo sha path name kind <<<"$entry"
    dir="$WORK/${repo//\//_}"
    if [ -z "${fetched[$repo]:-}" ]; then
      if git clone -q --filter=blob:none --no-checkout "https://github.com/$repo" "$dir" 2>"$WORK/err" \
         && git -C "$dir" checkout -q "$sha" 2>>"$WORK/err"; then
        fetched[$repo]=1
      else
        fetched[$repo]=fail
        echo "FETCH FAILED $repo@$sha: $(tr '\n' ' ' <"$WORK/err")" >&2
      fi
    fi
    if [ "${fetched[$repo]}" = fail ]; then failed+=("$name (repo fetch failed)"); continue; fi
    src="$dir/$path"
    tmp="$WORK/out-$name"; rm -rf "$tmp"; mkdir -p "$tmp"
    if [ "$kind" = dir ]; then
      if [ ! -f "$src/SKILL.md" ]; then failed+=("$name (no SKILL.md at $path)"); continue; fi
      cp -R "$src/." "$tmp/"
    else
      if [ ! -f "$src" ]; then failed+=("$name (missing $path)"); continue; fi
      # Upstream ships these as bare .md files whose frontmatter has no name.
      # Add the name so Claude Code can register it; the body is unchanged.
      if head -1 "$src" | grep -q '^---$'; then
        { echo '---'; echo "name: $name"; tail -n +2 "$src"; } >"$tmp/SKILL.md"
      else
        { echo '---'; echo "name: $name"; echo "description: $name (from $repo)"; echo '---'; cat "$src"; } >"$tmp/SKILL.md"
      fi
    fi
    printf '%s\n' "source: https://github.com/$repo/tree/$sha/$path" >"$tmp/.source"
    rm -rf "${DEST:?}/$name" && mv "$tmp" "$DEST/$name" && ok+=("$name") || failed+=("$name (copy failed)")
  done
fi

echo "Installed in $DEST: ${#ok[@]}"
printf '  ok      %s\n' "${ok[@]}"
if [ "${#failed[@]}" -gt 0 ]; then
  printf '  FAILED  %s\n' "${failed[@]}"
  exit 1
fi
