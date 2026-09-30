---
name: git-safety
description: Mandatory Git discipline for Tyre Pulse. Use before changing files, before any commit, push, merge, rebase or branch reset, and whenever the working tree may contain another session's work. Triggers on "commit", "push", "merge", "go live", "clean up the repo", "reset the branch".
---

# Git safety (Tyre Pulse)

This repository is worked on by several sessions at once, and **every push to `main` starts a production
build** of two Vercel projects (`tyre-pulse` = Vite app at the root, `tyre-pulse-eezl` = `marketing/`).
Owner rule (PROJECT_MEMORY): **push or merge only when the owner says so** ("push", "go live"). A stop-hook
"unpushed commits" message is not approval.

## 1. Before touching files
Run and read, every time:
```bash
git status --short
git branch --show-current
git log --oneline -5
git diff --stat            # unstaged
git diff --cached --stat   # staged
```
PASS: you can name every modified file and who changed it. FAIL: unknown modified files exist -> they may be
another session's in-flight work. Do not stage, stash, checkout, reset or format them.

## 2. Staging and committing
- Stage and commit **by explicit pathspec**: `git commit -- path/a path/b`. Never `git add -A` / `git add .`
  while anything else is dirty. `git add <path>` followed by a bare `git commit` still commits whatever a sibling
  staged in between.
- `.claude/` is gitignored. Project skills are tracked with `git add -f .claude/skills/<name>/SKILL.md`.
- Commit message ends with the attribution trailer the session provides. No model names in commits/PRs.
- Never commit: `.env*` (except `.env.example`), keystores, `*-service-account.json`, `local.properties`,
  scratch scripts, `test-results/`, generated PDFs under `audit/checklist-report-review/`.

## 3. Before pushing or merging
```bash
git fetch origin main
git log --oneline origin/main..HEAD        # what you are about to ship
git log --oneline HEAD..origin/main        # what you are missing
git diff --stat origin/main...HEAD         # the whole change
```
Then run the checks for every part the diff touches:

| Diff touches | Must pass locally |
|---|---|
| `src/` | `npm run lint`, `npm run test:run`, `npx vite build` |
| `marketing/` | `npm --prefix marketing run lint`, `npm --prefix marketing test`, `npm --prefix marketing run build` |
| `mobile/` | `npm --prefix mobile run typecheck`, `npm --prefix mobile test` |
| `tyre_pulse_flutter/` | see `flutter-qa` skill |
| `supabase/` or `MIGRATIONS_*.sql` | see `database-migration-safety` skill |

Also review the diff adversarially: secrets, debug flags, test endpoints, unintended files.

## 4. After a squash merge
The branch diverges from `main`. Realign: `git fetch origin main && git checkout -B <branch> origin/main`.
Before any `--force-with-lease` to your own working branch, prove it holds only merged content:
`git diff --stat origin/main origin/<branch>` must be empty, and `git log origin/main..origin/<branch>` must not
show a parallel session's commits.

## 5. Forbidden without explicit owner approval (say what you would run and why, then stop)
- `git reset --hard`, `git clean -fd`, `git clean -fdx`, `git checkout -- .`, `git stash` on a shared tree
- `git push --force` / `--force-with-lease` to `main` or to a branch you did not create
- amending or rebasing pushed commits, rewriting shared history, deleting branches or tags
- deleting more than a handful of files, or any directory, in one change
- mobile release tags (`mobile-v*`, `native-v*`) or running a release workflow (no mobile builds unless the owner asks)

## 6. Batching
One merge = one production build. Accumulate commits locally and push once at the end of a unit of work.

## Pass / fail
PASS only when: status is understood, only intended files are committed, checks for touched parts passed,
diff reviewed, and no forbidden command ran. Report the final `git status` and the commit list.
