#!/bin/bash
# gate3.sh : copy A forward; copy B forward -> reverse rollback -> compare with snapshot -> forward again -> compare with A
cd "$(dirname "$0")"
S="psql -h localhost -p 54417 -U supabase_admin -q -X"
FP() { $S -d $1 -f catalog_fp.sql > fp_$2.tsv; }
$S -d postgres -c "create database rh_a template snap_base owner postgres"
$S -d postgres -c "create database rh_b template snap_base owner postgres"
FP snap_base snap
echo "== copy A forward"; ./apply.sh rh_a forward | tee apply_a.log
FP rh_a A
echo "== copy B forward"; ./apply.sh rh_b forward > apply_b_fwd.log; cut -f1,3,4 apply_b_fwd.log
FP rh_b B_applied
echo "== copy B reverse rollback"; ./apply.sh rh_b rollback | tee apply_b_rb.log
FP rh_b B_rolledback
echo "== snapshot vs B after rollback (excluding _bak residue)"; python3 fpdiff.py fp_snap.tsv fp_B_rolledback.tsv --ignore-bak
echo "== copy B forward again"; ./apply.sh rh_b forward > apply_b_fwd2.log; cut -f1,3,4,5 apply_b_fwd2.log
FP rh_b B_reapplied
echo "== A vs B re-applied"; python3 fpdiff.py fp_A.tsv fp_B_reapplied.tsv --ignore-bak
echo "== A vs B first apply"; python3 fpdiff.py fp_A.tsv fp_B_applied.tsv
