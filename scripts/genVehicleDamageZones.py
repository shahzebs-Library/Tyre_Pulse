"""Generate the web damage-zone catalog from the Flutter source.

Run from the repo root:
  python scripts/genVehicleDamageZones.py
"""
import json
import os
import re
import sys

FLUTTER = 'tyre_pulse_flutter/lib/features/accidents'
MAP_DART = f'{FLUTTER}/domain/accident_damage_map.dart'
LABEL_KEY_DART = f'{FLUTTER}/presentation/accident_damage_copy.dart'
COPY_DART = f'{FLUTTER}/presentation/accident_copy.dart'
ARB_EN = 'tyre_pulse_flutter/lib/l10n/app_en.arb'
OUT = 'src/lib/vehicleDamageZones.js'

src = open(sys.argv[1] if len(sys.argv) > 1 else MAP_DART, encoding='utf-8').read()
out_path = sys.argv[2] if len(sys.argv) > 2 else OUT

zone_re = re.compile(
    r"AccidentDamageZone\(\s*"
    r"id:\s*'([^']+)',\s*"
    r"view:\s*AccidentDamageView\.(\w+),\s*"
    r"left:\s*([-\d.]+),\s*"
    r"top:\s*([-\d.]+),\s*"
    r"width:\s*([-\d.]+),\s*"
    r"height:\s*([-\d.]+),?\s*"
    r"\)"
)
list_re = re.compile(
    r"const\s+List<AccidentDamageZone>\s+(\w+)\s*=\s*<AccidentDamageZone>\[(.*?)\n\];",
    re.S,
)
switch_re = re.compile(r"AccidentDamageAssetClass\.(\w+)\s*=>\s*(\w+),")

catalogs = {}
for name, body in list_re.findall(src):
    catalogs[name] = [
        {
            'id': zid,
            'view': view,
            'left': float(left),
            'top': float(top),
            'width': float(width),
            'height': float(height),
        }
        for zid, view, left, top, width, height in zone_re.findall(body)
    ]

mapping = dict(switch_re.findall(src))
if not mapping:
    raise SystemExit('asset class -> catalog mapping not found')

missing = [v for v in mapping.values() if v not in catalogs]
if missing:
    raise SystemExit(f'catalog(s) referenced but not parsed: {missing}')

total = sum(len(catalogs[v]) for v in mapping.values())
if total < 100:
    raise SystemExit(f'only {total} zones parsed - the Dart shape changed')


def num(v):
    s = f'{v:.4f}'.rstrip('0').rstrip('.')
    return s if s else '0'


lines = []
lines.append('// GENERATED FILE - DO NOT EDIT BY HAND.')
lines.append('//')
lines.append('// Every rectangle here is the audited position of one body')
lines.append('// component on the vehicle artwork, in the view\'s own 0..1 space.')
lines.append('// It is generated from the Flutter catalog')
lines.append('// (tyre_pulse_flutter/lib/features/accidents/domain/accident_damage_map.dart)')
lines.append('// so a mark placed on the phone lands on the same component here.')
lines.append('// Regenerate with scripts/genVehicleDamageZones.py after changing that file.')
lines.append('')
lines.append('/** Every zone, grouped by the asset class its geometry was drawn for. */')
lines.append('export const ZONE_CATALOGS = Object.freeze({')
for cls, listname in mapping.items():
    lines.append(f'  {cls}: Object.freeze([')
    for z in catalogs[listname]:
        lines.append(
            "    { id: '%s', view: '%s', left: %s, top: %s, width: %s, height: %s },"
            % (z['id'], z['view'], num(z['left']), num(z['top']), num(z['width']), num(z['height']))
        )
    lines.append('  ]),')
lines.append('})')
lines.append('')

# ---- component labels -------------------------------------------------
# zone id -> copy key (a Dart switch where several ids share one key), then
# copy key -> the English string. Several ids deliberately collapse onto one
# label ('front_equipment_panel' reads "Equipment panel", not "Front
# equipment panel"), so the mapping is ported rather than humanised.
label_src = open(LABEL_KEY_DART, encoding='utf-8').read()
copy_src = open(COPY_DART, encoding='utf-8').read()

case_re = re.compile(r"((?:'[a-z0-9_]+'\s*\|\|\s*)*'[a-z0-9_]+')\s*=>\s*\n?\s*'(\w+)',")
id_to_key = {}
for ids_blob, key in case_re.findall(label_src):
    for zid in re.findall(r"'([a-z0-9_]+)'", ids_blob):
        id_to_key[zid] = key

# English lives in two places and BOTH are needed: the plant/equipment zones
# sit in the Dart copy map's 'en' block, while the road-vehicle zones sit in
# the ARB catalog string as key=value pairs joined by '~'. Reading the whole
# Dart file unscoped would silently pick up the Urdu block instead, because a
# later duplicate key wins.
en_start = copy_src.find("'en': <String, String>{")
if en_start < 0:
    raise SystemExit("the 'en' copy block was not found - the Dart shape changed")
en_end = copy_src.find("'ar':", en_start)
en_block = copy_src[en_start:en_end if en_end > 0 else len(copy_src)]
key_to_en = dict(re.findall(r"'(zone[A-Za-z]+)':\s*'([^']+)',", en_block))

with open(ARB_EN, encoding='utf-8-sig') as fh:
    arb = json.load(fh)
for pair in arb.get('accidentCopyCatalog', '').split('~'):
    if '=' in pair:
        k, _, v = pair.partition('=')
        if k.startswith('zone') and k not in key_to_en:
            key_to_en[k] = v

all_ids = sorted({z['id'] for zs in catalogs.values() for z in zs})


def humanise(zid):
    return zid.replace('_', ' ').capitalize()


labels = {}
unmapped = []
for zid in all_ids:
    key = id_to_key.get(zid)
    en = key_to_en.get(key) if key else None
    if not en:
        unmapped.append(zid)
        en = humanise(zid)
    labels[zid] = en

lines.append('/** The component name shown for a zone, as the phone words it. */')
lines.append('export const ZONE_LABELS = Object.freeze({')
for zid in all_ids:
    lines.append(f"  {zid}: '{labels[zid]}',")
lines.append('})')
lines.append('')
open(out_path, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines))
print(f'labels: {len(labels)} ids, {len(unmapped)} fell back to humanised')
if unmapped:
    print('  unmapped:', ', '.join(unmapped[:12]))
print(f'wrote {out_path}: {total} zones across {len(mapping)} asset classes')
for cls, listname in mapping.items():
    print(f'  {cls}: {len(catalogs[listname])}')
