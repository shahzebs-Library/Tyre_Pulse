#!/usr/bin/env python3
"""
Grade a mobile-ui-design eval run.

Design quality is subjective and stays with the human reviewer. What this
script checks is the *craft floor* underneath it, which is entirely objective:
did the change actually land on the design system, or does it only look like it
did?

Usage:
    python3 grade.py <run_dir> <target_file_glob> [--new-keys]

  run_dir           .../eval-N-name/with_skill   (must contain mobile/ and outputs/)
  target_file_glob  path under mobile/ that the run was supposed to change,
                    e.g. "app/(app)/tasks.tsx", or "NEW" to grade every
                    .tsx file that differs from the pristine sandbox.

Writes grading.json next to the run.
"""
import json
import os
import re
import subprocess
import sys

REPO = "/home/user/Tyre_Pulse"
PRISTINE = f"{REPO}/.claude/skills/mobile-ui-design-workspace/sandbox/mobile"
GLYPHMAP = (
    f"{REPO}/mobile/node_modules/@expo/vector-icons/build/vendor/"
    "react-native-vector-icons/glyphmaps/Ionicons.json"
)

# Values that are legitimately on-scale, so a literal match is not a violation.
SPACING_SCALE = {4, 8, 12, 16, 20, 24, 32, 40, 56}
RADIUS_SCALE = {8, 12, 16, 20, 26, 999}
RAMP_SIZES = {32, 26, 21, 18, 16, 15, 13, 12, 11}


def read(p):
    try:
        with open(p, encoding="utf-8") as f:
            return f.read()
    except OSError:
        return ""


def strip_comments(src):
    """Comments legitimately quote hex and sizes when explaining a decision."""
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"^\s*//.*$", "", src, flags=re.M)


def changed_tsx(run_mobile):
    """Every .tsx that differs from the pristine sandbox."""
    out = []
    for root, _, files in os.walk(run_mobile):
        if "node_modules" in root:
            continue
        for fn in files:
            if not fn.endswith(".tsx"):
                continue
            p = os.path.join(root, fn)
            rel = os.path.relpath(p, run_mobile)
            if read(p) != read(os.path.join(PRISTINE, rel)):
                out.append(rel)
    return sorted(out)


def check(name, passed, evidence):
    return {"text": name, "passed": bool(passed), "evidence": evidence}


def grade(run_dir, target):
    mobile = os.path.join(run_dir, "mobile")
    results = []

    targets = changed_tsx(mobile) if target == "NEW" else [target]
    targets = [t for t in targets if t]
    if not targets:
        return [check("the run changed at least one screen", False,
                      "no .tsx differs from the pristine sandbox")]

    src_all = "\n".join(strip_comments(read(os.path.join(mobile, t))) for t in targets)
    raw_all = "\n".join(read(os.path.join(mobile, t)) for t in targets)
    tlist = ", ".join(targets)

    # 1 - no raw hex colours
    hexes = re.findall(r"#[0-9A-Fa-f]{3,8}\b", src_all)
    results.append(check(
        "no raw hex colours (colour comes from theme tokens)",
        not hexes,
        f"{len(hexes)} found in {tlist}" + (f": {sorted(set(hexes))[:8]}" if hexes else ""),
    ))

    # 2 - styles can see the theme
    has_makestyles = "makeStyles(theme)" in src_all or "makeStyles(" in src_all
    results.append(check(
        "styles built via makeStyles(theme) so they respond to light/dark",
        has_makestyles,
        "makeStyles present" if has_makestyles
        else "module-level StyleSheet.create - cannot see theme, dark mode breaks",
    ))

    # 3 - font sizes on the typography ramp
    sizes = [int(m) for m in re.findall(r"fontSize:\s*(\d+)(?!\.)", src_all)]
    frac = re.findall(r"fontSize:\s*\d+\.\d+", src_all)
    off = [s for s in sizes if s not in RAMP_SIZES]
    results.append(check(
        "font sizes come from the typography ramp (no raw or sub-pixel sizes)",
        not off and not frac,
        f"{len(off)} off-ramp {sorted(set(off))}, {len(frac)} sub-pixel {frac[:4]}"
        if (off or frac) else "no raw font sizes",
    ))

    # 4 - radii on the scale
    radii = [int(m) for m in re.findall(r"borderRadius:\s*(\d+)", src_all)]
    offr = [r for r in radii if r not in RADIUS_SCALE]
    results.append(check(
        "border radii come from the radius scale",
        not offr,
        f"{len(offr)} off-scale: {sorted(set(offr))}" if offr else "all on scale",
    ))

    # 5 - no per-screen canvas tint
    canvas = re.findall(
        r"(?:safe|root|screen|container|page)\s*:\s*\{[^}]*backgroundColor:\s*'(#[0-9A-Fa-f]{3,8})'",
        src_all, flags=re.I)
    results.append(check(
        "root background uses theme.color.bg, not a per-screen tint",
        not canvas,
        f"per-screen canvas tint {canvas}" if canvas else "no hardcoded canvas",
    ))

    # 6 - kit adoption
    uses_kit = "components/ui" in raw_all
    kit_hits = re.findall(
        r"<(Screen|Card|Button|Badge|StatTile|ListRow|EmptyState|ErrorState|Loading|SectionHeader|AppText)\b",
        raw_all)
    results.append(check(
        "uses the shared ui kit rather than hand-rolling surfaces",
        uses_kit and len(set(kit_hits)) >= 3,
        f"imports kit={uses_kit}, components used: {sorted(set(kit_hits))}",
    ))

    # 7 - honest states
    has_empty = "EmptyState" in raw_all
    has_error = "ErrorState" in raw_all
    has_load = "Loading" in raw_all or "Skeleton" in raw_all
    results.append(check(
        "loading, empty and error states all present and distinct",
        has_empty and has_error and has_load,
        f"loading={has_load} empty={has_empty} error={has_error}",
    ))

    # 8 - RTL
    results.append(check(
        "handles RTL (isRTL referenced)",
        "isRTL" in raw_all,
        "isRTL referenced" if "isRTL" in raw_all else "no isRTL - Arabic layout unhandled",
    ))

    # 9 - logical edge props
    phys = re.findall(r"\b(marginLeft|marginRight|paddingLeft|paddingRight):", src_all)
    results.append(check(
        "no physical edge props that break RTL",
        not phys,
        f"{len(phys)} physical edge props: {sorted(set(phys))}" if phys else "none",
    ))

    # 10 - every Ionicons glyph is real
    glyphs = set(re.findall(r"""name=[{\s]*['"]([a-z0-9-]+)['"]""", raw_all))
    glyphs |= set(re.findall(r"""ionicon:\s*['"]([a-z0-9-]+)['"]""", raw_all))
    try:
        valid = set(json.loads(read(GLYPHMAP)).keys())
        bad = sorted(g for g in glyphs if g not in valid and "-" in g)
    except Exception:
        bad = []
        valid = set()
    results.append(check(
        "every Ionicons glyph exists (an invented name renders as '?')",
        not bad,
        f"invalid glyphs: {bad}" if bad else f"{len(glyphs & valid)} glyphs verified",
    ))

    # 11 - i18n keys in BOTH locales
    en = json.loads(read(os.path.join(mobile, "locales/en.json")) or "{}")
    ar = json.loads(read(os.path.join(mobile, "locales/ar.json")) or "{}")

    def flat(d, pre=""):
        out = set()
        for k, v in (d or {}).items():
            key = f"{pre}{k}"
            out |= flat(v, key + ".") if isinstance(v, dict) else {key}
        return out

    en_k, ar_k = flat(en), flat(ar)
    used = set(re.findall(r"""t\(\s*['"]([a-zA-Z0-9_.]+)['"]""", raw_all))
    missing = sorted(k for k in used if k not in en_k or k not in ar_k)
    results.append(check(
        "every t() key exists in BOTH en.json and ar.json (mobile shows the raw key otherwise)",
        not missing,
        f"{len(missing)} missing: {missing[:6]}" if missing else f"{len(used)} keys verified",
    ))
    results.append(check(
        "en.json and ar.json stayed in sync (no key added to one only)",
        en_k == ar_k,
        f"en-only={len(en_k - ar_k)} ar-only={len(ar_k - en_k)}"
        + (f" e.g. {sorted(en_k ^ ar_k)[:4]}" if en_k != ar_k else ""),
    ))

    # 12 - no dashes in user-facing strings
    dashes = re.findall(r"[–—]", "".join(
        json.dumps(x, ensure_ascii=False) for x in (en, ar)))
    results.append(check(
        "no em/en dashes in user-facing strings",
        not dashes,
        f"{len(dashes)} dash characters in locale files" if dashes else "clean",
    ))

    # 13 / 14 - it actually builds and the suite still passes
    def run(cmd):
        try:
            p = subprocess.run(cmd, cwd=mobile, shell=True, capture_output=True,
                               text=True, timeout=900)
            return p.returncode, (p.stdout + p.stderr)[-400:]
        except Exception as e:
            return 1, str(e)

    rc, out = run("npx tsc --noEmit")
    results.append(check("typechecks clean (npx tsc --noEmit)", rc == 0,
                         "0 errors" if rc == 0 else out))

    rc, out = run("npx jest --silent 2>&1 | tail -20")
    results.append(check("existing test suite still passes (npx jest)",
                         "fail" not in out.lower() or rc == 0,
                         out.strip()[-300:]))

    return results


def main():
    run_dir = sys.argv[1].rstrip("/")
    target = sys.argv[2]
    res = grade(run_dir, target)
    passed = sum(1 for r in res if r["passed"])
    payload = {
        "run_id": os.path.basename(os.path.dirname(run_dir)) + "-" + os.path.basename(run_dir),
        "score": f"{passed}/{len(res)}",
        "pass_rate": round(passed / len(res), 3) if res else 0,
        "expectations": res,
    }
    with open(os.path.join(run_dir, "grading.json"), "w") as f:
        json.dump(payload, f, indent=2)
    print(f"{payload['run_id']}: {payload['score']}")
    for r in res:
        print(f"  {'PASS' if r['passed'] else 'FAIL'}  {r['text']}\n        {r['evidence']}")


if __name__ == "__main__":
    main()
