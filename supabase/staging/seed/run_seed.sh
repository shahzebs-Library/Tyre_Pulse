#!/usr/bin/env bash
# Load reference rows, then the synthetic companies, into the LOCAL staging database.
# For a hosted staging project run the two steps by hand with its DSN (see ../README.md).
source "$(dirname "${BASH_SOURCE[0]}")/../local/env.sh"
PY="$(pick_python)"
ACCOUNTS="${STAGING_ACCOUNTS_FILE:-$STAGING_ROOT/../staging_test_accounts.txt}"
psqls -d "$STAGING_DB" -f "$STAGING_DIR/seed/00_reference.sql"
"$PY" "$STAGING_DIR/seed/generate_seed.py" --dsn "$STAGING_DSN" --accounts-out "$ACCOUNTS"
