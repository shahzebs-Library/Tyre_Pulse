#!/usr/bin/env bash
# Build-time injection of Firebase's GoogleService-Info.plist for iOS push.
# The plist is NEVER committed (see tyre_pulse_flutter/.gitignore). CI passes its
# content through the GOOGLE_SERVICE_INFO_PLIST secret (raw XML or base64).
#
# Usage (from tyre_pulse_flutter/): GOOGLE_SERVICE_INFO_PLIST="$SECRET" \
#   EXPECTED_BUNDLE_ID=com.shahzebrahman.tyrepulseinspector ios/ci/inject_google_service_info.sh
#
# Exit codes: 0 injected, 3 secret absent (caller decides if that is fatal), 1 invalid.
set -euo pipefail

TARGET="ios/Runner/GoogleService-Info.plist"
EXPECTED_BUNDLE_ID="${EXPECTED_BUNDLE_ID:-com.shahzebrahman.tyrepulseinspector}"
RAW="${GOOGLE_SERVICE_INFO_PLIST:-}"

if [ -z "${RAW// /}" ]; then
  echo "GOOGLE_SERVICE_INFO_PLIST secret is not set; Firebase push cannot work on this iOS build." >&2
  exit 3
fi

# Accept either raw plist XML or base64 of it. Never echo the content.
if printf '%s' "$RAW" | grep -q "<plist"; then
  printf '%s\n' "$RAW" > "$TARGET"
else
  if ! printf '%s' "$RAW" | base64 --decode > "$TARGET" 2>/dev/null; then
    echo "::error::GOOGLE_SERVICE_INFO_PLIST is neither plist XML nor valid base64." >&2
    rm -f "$TARGET"; exit 1
  fi
fi

fail() { echo "::error::$1" >&2; rm -f "$TARGET"; exit 1; }

command -v plutil >/dev/null 2>&1 && { plutil -lint "$TARGET" >/dev/null || fail "GoogleService-Info.plist is not a valid property list."; }

bundle=$(/usr/libexec/PlistBuddy -c 'Print :BUNDLE_ID' "$TARGET" 2>/dev/null || true)
[ "$bundle" = "$EXPECTED_BUNDLE_ID" ] || fail "GoogleService-Info.plist BUNDLE_ID '$bundle' does not match '$EXPECTED_BUNDLE_ID'. Download the plist of the iOS app registered with that bundle id."
for key in GOOGLE_APP_ID GCM_SENDER_ID PROJECT_ID API_KEY; do
  /usr/libexec/PlistBuddy -c "Print :$key" "$TARGET" >/dev/null 2>&1 || fail "GoogleService-Info.plist is missing $key."
done

# The file must be a Runner resource or it is not bundled. Add it to the target once.
ruby -e '
require "xcodeproj"
proj = Xcodeproj::Project.open("ios/Runner.xcodeproj")
target = proj.targets.find { |t| t.name == "Runner" } or abort("Runner target not found")
group = proj.main_group.find_subpath("Runner", true)
ref = group.files.find { |f| f.path == "GoogleService-Info.plist" } || group.new_file("GoogleService-Info.plist")
unless target.resources_build_phase.files_references.include?(ref)
  target.resources_build_phase.add_file_reference(ref)
end
proj.save
puts "GoogleService-Info.plist registered as a Runner resource"
'
# Push also needs the aps-environment entitlement and the remote-notification background
# mode; neither is committed. Add both here (only for builds that carry the Firebase plist).
APS_ENVIRONMENT="${APS_ENVIRONMENT:-production}"
ENT="ios/Runner/Runner.entitlements"
if [ ! -f "$ENT" ]; then
  cat > "$ENT" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>aps-environment</key><string>${APS_ENVIRONMENT}</string></dict></plist>
PLIST
fi
INFO="ios/Runner/Info.plist"
if ! /usr/libexec/PlistBuddy -c 'Print :UIBackgroundModes' "$INFO" 2>/dev/null | grep -q remote-notification; then
  /usr/libexec/PlistBuddy -c 'Add :UIBackgroundModes array' "$INFO" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c 'Add :UIBackgroundModes: string remote-notification' "$INFO"
fi
ruby -e '
require "xcodeproj"
proj = Xcodeproj::Project.open("ios/Runner.xcodeproj")
target = proj.targets.find { |t| t.name == "Runner" } or abort("Runner target not found")
group = proj.main_group.find_subpath("Runner", true)
group.files.find { |f| f.path == "Runner.entitlements" } || group.new_file("Runner.entitlements")
target.build_configurations.each { |c| c.build_settings["CODE_SIGN_ENTITLEMENTS"] = "Runner/Runner.entitlements" }
proj.save
puts "Push entitlement (aps-environment) and remote-notification background mode configured"
'
echo "GoogleService-Info.plist injected for $bundle (project $(/usr/libexec/PlistBuddy -c 'Print :PROJECT_ID' "$TARGET"))."
