#!/usr/bin/env python3
"""App Store Connect preflight for the iOS TestFlight workflow.

Runs BEFORE the (slow) build so a key problem fails in seconds with a plain
reason instead of "exportArchive No Accounts with App Store Connect Access"
after 12 minutes. It also picks a build number that is higher than every
build Apple already holds for this app (another build of the same bundle id
may already be installed on testers' phones), so the upload is never refused
as a repeated or lower build number.

Reads env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH, BUNDLE_ID, MIN_BUILD.
Writes to $GITHUB_OUTPUT: build_number, latest_version.
Never prints the key or the token.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

import jwt  # PyJWT with the crypto extra (ES256)

API = "https://api.appstoreconnect.apple.com/v1"


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


def get(tok, path, params=None):
    url = f"{API}/{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {tok}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as err:
        try:
            body = json.loads(err.read() or b"{}")
        except ValueError:
            body = {}
        return err.code, body


def detail(body):
    errs = body.get("errors") or []
    return "; ".join(f"{e.get('status')} {e.get('code')}: {e.get('detail') or e.get('title')}" for e in errs) or "no detail"


def main():
    tok = token()
    bundle = os.environ["BUNDLE_ID"]

    status, body = get(tok, "apps", {"filter[bundleId]": bundle, "limit": 1})
    if status == 401:
        fail("App Store Connect refused the API key (401). Check APPSTORE_KEY_ID and APPSTORE_ISSUER_ID match the "
             "key in App Store Connect > Users and Access > Integrations, and that the key is not revoked. " + detail(body))
    if status == 403 and "AGREEMENT" in json.dumps(body).upper():
        fail("Apple refuses every API call until the Account Holder accepts the latest agreement "
             "(App Store Connect > Business, and developer.apple.com > Account > Agreements). Xcode reports this as "
             "'No Accounts with App Store Connect Access'. Accept it, then re-run this workflow. " + detail(body))
    if status != 200:
        fail(f"Could not read the app record ({status}). " + detail(body))
    apps = body.get("data") or []
    if not apps:
        fail(f"No App Store Connect app with bundle id {bundle} is visible to this key. Give the key access to the app "
             "(or create the app record).")
    app_id = apps[0]["id"]
    print(f"App record found for {bundle}.")

    # Cloud-managed signing (the export step) needs a key that may manage certificates and profiles.
    status, body = get(tok, "certificates", {"limit": 1})
    if status in (401, 403):
        fail("This API key may not manage signing certificates (" + str(status) + "). Xcode reports this as "
             "'No Accounts with App Store Connect Access'. In App Store Connect > Users and Access > Integrations > "
             "Team Keys, create a key with the Admin role (or grant access to Certificates, Identifiers and Profiles "
             "and cloud-managed distribution certificates), then update APPSTORE_KEY_ID / APPSTORE_KEY_P8. " + detail(body))
    if status != 200:
        fail(f"Could not read certificates ({status}). " + detail(body))
    print("Key can read signing certificates.")

    highest = 0
    latest_version = ""
    status, body = get(tok, "builds", {"filter[app]": app_id, "sort": "-uploadedDate", "limit": 200,
                                       "fields[builds]": "version,preReleaseVersion", "include": "preReleaseVersion",
                                       "fields[preReleaseVersions]": "version"})
    if status == 200:
        for b in body.get("data") or []:
            try:
                highest = max(highest, int(str(b["attributes"]["version"]).split(".")[0]))
            except (KeyError, ValueError):
                pass
        for inc in body.get("included") or []:
            if inc.get("type") == "preReleaseVersions" and not latest_version:
                latest_version = inc.get("attributes", {}).get("version") or ""
        print(f"Highest build number already uploaded: {highest or 'none'}; latest version train: {latest_version or 'none'}.")
    else:
        print(f"::warning::Could not list existing builds ({status}); using the minimum build number. " + detail(body))

    build = max(highest + 1, int(os.environ.get("MIN_BUILD") or "1"))
    print(f"Build number for this upload: {build}")
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as out:
        out.write(f"build_number={build}\nlatest_version={latest_version}\n")


if __name__ == "__main__":
    main()
