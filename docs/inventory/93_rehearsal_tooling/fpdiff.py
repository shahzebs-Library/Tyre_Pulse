"""fpdiff.py a.tsv b.tsv [--ignore-bak] : compare two catalog fingerprints."""
import sys
def load(p):
    d = {}
    for line in open(p):
        parts = line.rstrip('\n').split('\t')
        if len(parts) == 3:
            d[(parts[0], parts[1])] = parts[2]
    return d
a, b = load(sys.argv[1]), load(sys.argv[2])
ign = '--ignore-bak' in sys.argv
f = (lambda k: not k[1].startswith('_bak.')) if ign else (lambda k: True)
only_a = sorted(k for k in a if k not in b and f(k))
only_b = sorted(k for k in b if k not in a and f(k))
diff = sorted(k for k in a if k in b and a[k] != b[k] and f(k))
bak_b = sorted(k for k in b if k not in a and k[1].startswith('_bak.'))
print(f"objects: {len(a)} vs {len(b)}; only in first: {len(only_a)}; only in second: {len(only_b)}; changed: {len(diff)}")
for k in only_a[:40]: print('  -', *k)
for k in only_b[:40]: print('  +', *k)
for k in diff[:60]: print('  ~', *k)
if ign: print(f"_bak objects only in second (rollback residue): {len(bak_b)}", [k[1] for k in bak_b])
