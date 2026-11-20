#!/bin/bash
# apply.sh <db> <forward|rollback> -> applies the 16 pending files as role postgres (non-superuser, as production)
DB=$1; MODE=$2
PM=${PM:-$(git -C "$(dirname "$0")" rev-parse --show-toplevel)/supabase/pending_migrations}
FILES=$(ls $PM/202611201*.sql | grep -v ROLLBACK | sort)
if [ "$MODE" = rollback ]; then FILES=$(ls $PM/202611201*_ROLLBACK.sql | sort -r); fi
for f in $FILES; do
  s=$(date +%s.%N)
  out=$(psql -h localhost -p 54417 -U postgres -d $DB -v ON_ERROR_STOP=1 -q -X -f $f 2>&1)
  rc=$?
  e=$(date +%s.%N)
  printf "%s\t%s\t%s\t%.2fs\t%s\n" "$(basename $f)" "$(sha256sum $f | cut -c1-64)" "$([ $rc = 0 ] && echo OK || echo FAIL)" "$(echo "$e - $s" | bc)" "$(echo "$out" | grep -E 'ERROR|FATAL' | head -3 | tr '\n' ' ')"
  [ $rc = 0 ] || exit 1
done
