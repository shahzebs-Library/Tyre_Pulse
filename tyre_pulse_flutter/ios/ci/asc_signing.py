#!/usr/bin/env python3
"""Per-run manual signing for the iOS TestFlight workflow, via the App Store Connect API.

Why this exists: Xcode's cloud/automatic signing at export fails on the runner with
"No Accounts with App Store Connect Access" (exit 70). Manual signing needs no Xcode
account at all: we create our own Apple Distribution certificate and App Store profile
through the API, sign with them, and revoke/delete both at the end of the run.

Subcommands
  setup    Look up the bundle id (writes team id), remove stale per-run material,
           create a DISTRIBUTION certificate from CSR_PATH and an IOS_APP_STORE profile.
  cleanup  Delete this run's profile and revoke this run's certificate (idempotent).

Env (both):  ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH, BUNDLE_ID, RUN_MARKER, STATE_DIR
Env (setup): CSR_PATH
Files written to STATE_DIR (setup): team_id, profile_name, profile_uuid,
  profile.mobileprovision, cert.der, cert_id, profile_id.

Naming: certificate names are computed by Apple and cannot be set, so the per-run
marker (gha-<run_id>-<attempt>) is the PROFILE name; a run's certificate is found
through its profile's certificates relationship. Never prints the key, the token or
any secret.
"""
import base64
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

import jwt  # PyJWT with the crypto extra (ES256), same as asc_preflight.py

API = "https://api.appstoreconnect.apple.com/v1"
MARKER_PREFIX = "gha-"
_MARKER_RE = re.compile(r"^gha-(\d+)(?:-(\d+))?$")


def fail(msg):
    print(f"::error::{msg}")
    sys.exit(1)


def token():
    with open(os.environ["ASC_KEY_PATH"], "r", encoding="utf-8") as fh:
        key = fh.read()
    now = int(time.time())
    return jwt.encode(
        {"iss": os.environ["ASC_ISSUER_ID"], "iat": now, "exp": now + 900, "aud": "appstoreconnect-v1"},
        key,
        algorithm="ES256",
        headers={"kid": os.environ["ASC_KEY_ID"], "typ": "JWT"},
    )


def call(tok, method, path, params=None, body=None):
    url = path if path.startswith("http") else f"{API}/{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Authorization": f"Bearer {tok}"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as err:
        try:
            parsed = json.loads(err.read() or b"{}")
        except ValueError:
            parsed = {}
        return err.code, parsed


def detail(body):
    errs = (body or {}).get("errors") or []
    return "; ".join(f"{e.get('status')} {e.get('code')}: {e.get('detail') or e.get('title')}" for e in errs) or "no detail"


def state_path(name):
    return os.path.join(os.environ["STATE_DIR"], name)


def write_state(name, value, mode="w"):
    with open(state_path(name), mode) as fh:
        fh.write(value)


def read_state(name):
    try:
        with open(state_path(name), "r", encoding="utf-8") as fh:
            return fh.read().strip()
    except OSError:
        return ""


def marker_run(name):
    """(run_id, attempt) for a gha- marker, else None."""
    m = _MARKER_RE.match(name or "")
    if not m:
        return None
    return int(m.group(1)), int(m.group(2) or 0)


def is_stale(name, current):
    """A gha- profile from an EARLIER run (or earlier attempt of this run)."""
    mine = marker_run(current)
    theirs = marker_run(name)
    if theirs is None or mine is None or name == current:
        return False
    return theirs < mine


def find_bundle_id(tok, identifier):
    status, body = call(tok, "GET", "bundleIds", {"filter[identifier]": identifier, "limit": 200})
    if status != 200:
        fail(f"Could not look up the bundle id ({status}). " + detail(body))
    # filter[identifier] is a prefix-style match; pick the exact IOS one.
    for item in body.get("data") or []:
        attrs = item.get("attributes") or {}
        if attrs.get("identifier") == identifier and attrs.get("platform") in ("IOS", "UNIVERSAL"):
            return item["id"], attrs.get("seedId") or ""
    fail(f"No iOS App ID {identifier} in Certificates, Identifiers & Profiles. Register it first.")


def check_push_capability(tok, bundle_resource_id):
    status, body = call(tok, "GET", f"bundleIds/{bundle_resource_id}/bundleIdCapabilities", {"limit": 200})
    if status != 200:
        print(f"::warning::Could not read the App ID capabilities ({status}); continuing. " + detail(body))
        return
    caps = {(c.get("attributes") or {}).get("capabilityType") for c in body.get("data") or []}
    if "PUSH_NOTIFICATIONS" not in caps:
        fail("Runner.entitlements asks for aps-environment, but the App ID has no Push Notifications capability, "
             "so the App Store profile cannot cover it. Enable Push Notifications on the App ID in "
             "developer.apple.com > Identifiers, then re-run.")


def delete_profile_and_certs(tok, profile_id, label):
    """Delete one profile and revoke every certificate attached to it."""
    status, body = call(tok, "GET", f"profiles/{profile_id}/certificates", {"limit": 50})
    cert_ids = [c["id"] for c in body.get("data") or []] if status == 200 else []
    st, bd = call(tok, "DELETE", f"profiles/{profile_id}")
    if st in (200, 204, 404):
        print(f"Deleted profile {label}.")
    else:
        print(f"::warning::Could not delete profile {label} ({st}). " + detail(bd))
    for cid in cert_ids:
        revoke_cert(tok, cid, f"attached to {label}")


def revoke_cert(tok, cert_id, label):
    st, bd = call(tok, "DELETE", f"certificates/{cert_id}")
    if st in (200, 204, 404):
        print(f"Revoked certificate {label}.")
        return True
    print(f"::warning::Could not revoke certificate {label} ({st}). " + detail(bd))
    return False


def list_marker_profiles(tok):
    out = []
    status, body = call(tok, "GET", "profiles", {"limit": 200, "fields[profiles]": "name,profileType"})
    while status == 200:
        for p in body.get("data") or []:
            name = (p.get("attributes") or {}).get("name") or ""
            if name.startswith(MARKER_PREFIX):
                out.append((p["id"], name))
        nxt = (body.get("links") or {}).get("next")
        if not nxt:
            break
        status, body = call(tok, "GET", nxt)
    if status != 200:
        print(f"::warning::Could not list profiles ({status}). " + detail(body))
    return out


def setup():
    tok = token()
    bundle = os.environ["BUNDLE_ID"]
    marker = os.environ["RUN_MARKER"]
    if marker_run(marker) is None:
        fail("RUN_MARKER must look like gha-<run_id>-<attempt>.")

    bundle_resource_id, team = find_bundle_id(tok, bundle)
    if not team:
        fail("The App ID has no team prefix (seedId) in the API response; cannot verify the team.")
    write_state("team_id", team)
    print(f"App ID {bundle} found.")
    check_push_capability(tok, bundle_resource_id)

    # Remove material left behind by earlier runs (crashed cleanup, cancelled job).
    for pid, name in list_marker_profiles(tok):
        if is_stale(name, marker) or name == marker:
            delete_profile_and_certs(tok, pid, name)

    with open(os.environ["CSR_PATH"], "r", encoding="utf-8") as fh:
        csr = fh.read()
    status, body = call(tok, "POST", "certificates", body={"data": {
        "type": "certificates",
        "attributes": {"certificateType": "DISTRIBUTION", "csrContent": csr},
    }})
    if status != 201:
        hint = ""
        if status == 409:
            hint = (" The team is at its Apple Distribution certificate limit. In developer.apple.com > "
                    "Certificates, revoke an unused Apple Distribution certificate (one left by an old CI run is "
                    "safe to revoke), then re-run.")
        fail(f"Could not create the distribution certificate ({status}). " + detail(body) + hint)
    cert = body["data"]
    cert_id = cert["id"]
    write_state("cert_id", cert_id)  # written first so cleanup can revoke it even if the profile fails
    with open(state_path("cert.der"), "wb") as fh:
        fh.write(base64.b64decode(cert["attributes"]["certificateContent"]))
    print("Created a per-run Apple Distribution certificate.")

    status, body = call(tok, "POST", "profiles", body={"data": {
        "type": "profiles",
        "attributes": {"name": marker, "profileType": "IOS_APP_STORE"},
        "relationships": {
            "bundleId": {"data": {"type": "bundleIds", "id": bundle_resource_id}},
            "certificates": {"data": [{"type": "certificates", "id": cert_id}]},
        },
    }})
    if status != 201:
        fail(f"Could not create the App Store provisioning profile ({status}). " + detail(body))
    prof = body["data"]
    attrs = prof["attributes"]
    write_state("profile_id", prof["id"])
    write_state("profile_name", attrs["name"])
    write_state("profile_uuid", attrs["uuid"])
    with open(state_path("profile.mobileprovision"), "wb") as fh:
        fh.write(base64.b64decode(attrs["profileContent"]))
    print(f"Created App Store profile {attrs['name']}.")


def cleanup():
    tok = token()
    marker = os.environ.get("RUN_MARKER", "")
    profile_id = read_state("profile_id")
    cert_id = read_state("cert_id")
    ok = True
    if profile_id:
        delete_profile_and_certs(tok, profile_id, marker or profile_id)
    else:
        # Profile id not recorded (setup died mid-way): find it by name.
        for pid, name in list_marker_profiles(tok):
            if name == marker:
                delete_profile_and_certs(tok, pid, name)
    if cert_id:
        # Revoking an already-revoked certificate returns 404, which counts as done.
        ok = revoke_cert(tok, cert_id, "of this run") and ok
    if not ok:
        print("::warning::A per-run signing certificate may still exist. Revoke it in developer.apple.com > "
              "Certificates; the next run also removes material from earlier runs by profile name.")


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "setup":
        setup()
    elif cmd == "cleanup":
        cleanup()
    else:
        fail("usage: asc_signing.py setup|cleanup")


if __name__ == "__main__":
    main()
