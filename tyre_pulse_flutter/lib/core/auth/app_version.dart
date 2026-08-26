/// The minimum supported app version gate (spec section 60).
///
/// Pure Dart. No Flutter, no Supabase, no clock. Ported from
/// `mobile/lib/appVersion.ts`, which is itself deliberately separated from its
/// I/O half for the same reason: the rule that decides whether a build is too
/// old must be testable without a device.
///
/// ## Why the gate exists
///
/// Testers are spread across builds. Play Console shows crashes still arriving
/// from build 28 while 34 is current, and a fix shipped in a later build does
/// nothing for somebody who never updated. An administrator names a minimum;
/// anything older is asked to update.
///
/// ## Two rules that are not negotiable
///
/// **1. Segments compare as NUMBERS.** A text compare puts `1.10.0` below
/// `1.9.0`, so an old build would silently pass a gate that was supposed to
/// stop it. That is a gate that reports success and does nothing.
///
/// **2. It FAILS OPEN.** A blank, missing or unparseable minimum allows the
/// build through. A typo in the admin console must never lock an entire field
/// fleet out of an app they cannot reinstall from a yard, and there is no
/// version of this product where refusing everybody is the safer default.
/// Every failure path in this file - no value, no digits, unreadable config,
/// no signal - resolves to [VersionGateResult.allows] being true.
///
/// The only way a person is blocked is an administrator explicitly setting a
/// minimum this build is below.
///
/// ## The gate is checked AFTER sign-in, and that is on purpose
///
/// `mobile_min_version` lives in `system_config`, and V281 revoked every anon
/// table grant, so an unauthenticated device cannot read it. The production
/// Expo app checks it in the app shell, after authentication, for exactly that
/// reason. Spec section 60 requires a safe sign-out from the blocked screen,
/// which is what makes a post-authentication gate acceptable: the person is
/// never trapped.
///
/// ## It must not destroy anything
///
/// Spec section 60: "Do not destroy unsynced local data during version
/// gating." Nothing in this file writes, deletes or clears. The gate is a
/// decision, and the screen that renders it offers sign-out, which itself
/// preserves pending field work. See `auth_controller.dart`.
library;

/// The `system_config` key an administrator sets. Absent means no minimum.
const String minVersionConfigKey = 'mobile_min_version';

/// Matches the leading integer of a version segment, the way JavaScript's
/// `parseInt(segment, 10)` does.
///
/// This is deliberately parseInt-compatible rather than "correct". The
/// production rule is `parseInt`, so `1.2.3-beta` yields `[1, 2, 3]` there;
/// a plain `int.tryParse` would yield `[1, 2, 0]` and quietly disagree with
/// the app this is replacing. Two version comparators that disagree about a
/// pre-release suffix is precisely the class of drift this port exists to
/// avoid.
final RegExp _leadingInteger = RegExp(r'^[+-]?\d+');

/// True when [value] contains at least one digit anywhere.
///
/// Mirrors the `/\d/.test(m)` guard in `appVersion.ts`. A configured minimum
/// with no digit at all is a typo, not a version, and it must not block.
final RegExp _anyDigit = RegExp(r'\d');

int _segmentValue(String segment) {
  final Match? match = _leadingInteger.firstMatch(segment.trimLeft());
  if (match == null) {
    return 0;
  }
  // A digit run too large for a 64-bit int returns null here and becomes 0.
  // JavaScript would produce a double. Nobody ships a version segment with 19
  // digits; the divergence is recorded rather than defended against.
  return int.tryParse(match.group(0)!) ?? 0;
}

List<int> _segments(String version) =>
    version.trim().split('.').map(_segmentValue).toList(growable: false);

/// Compares two dotted numeric versions.
///
/// Returns a negative number when [a] is older than [b], zero when they are
/// equal, and a positive number when [a] is newer.
///
/// Missing segments count as zero, so `1.3` and `1.3.0` are equal. A
/// non-numeric segment becomes zero rather than throwing: a version string
/// this function cannot read must not crash the app that is trying to start.
int compareVersions(String a, String b) {
  final List<int> left = _segments(a);
  final List<int> right = _segments(b);
  final int length = left.length > right.length ? left.length : right.length;
  for (int i = 0; i < length; i++) {
    final int difference =
        (i < left.length ? left[i] : 0) - (i < right.length ? right[i] : 0);
    if (difference != 0) {
      return difference < 0 ? -1 : 1;
    }
  }
  return 0;
}

/// True when [currentVersion] is older than [minimumVersion].
///
/// FAILS OPEN on a null, blank or digit-free minimum. See the library comment.
bool isUpdateRequired({
  required String currentVersion,
  String? minimumVersion,
}) {
  final String minimum = (minimumVersion ?? '').trim();
  if (minimum.isEmpty) {
    return false;
  }
  if (!_anyDigit.hasMatch(minimum)) {
    return false;
  }
  return compareVersions(currentVersion, minimum) < 0;
}

/// Cleans a raw `system_config.value`.
///
/// Values in that table are sometimes stored JSON-quoted (`"1.3.1"`) and
/// sometimes bare, because two different administration surfaces write it.
/// Returns null for anything that is not usable, which the caller must treat
/// as "no minimum configured" - never as "block".
String? normaliseMinimumVersion(Object? raw) {
  if (raw == null) {
    return null;
  }
  final String text = raw is String ? raw : raw.toString();
  final String stripped =
      text.trim().replaceAll(RegExp('^"+'), '').replaceAll(RegExp(r'"+$'), '');
  final String trimmed = stripped.trim();
  return trimmed.isEmpty ? null : trimmed;
}

/// Why the gate reached its answer.
///
/// A gate that can only say yes or no cannot be diagnosed. When an
/// administrator reports "it is not blocking old builds", the difference
/// between [noMinimumConfigured] and [minimumUnreadable] is the whole answer.
enum VersionGateReason {
  /// The gate has not run yet. Allows, because a check that has not happened
  /// is not evidence that a build is too old.
  notChecked(allows: true),

  /// No `mobile_min_version` row, or it is blank. The normal state.
  noMinimumConfigured(allows: true),

  /// A value is set but carries no digit, so it is a typo rather than a
  /// version. Allows. See the library comment.
  minimumUnparseable(allows: true),

  /// The configuration could not be read at all - no signal, RLS, or a server
  /// error. Allows, always.
  minimumUnreadable(allows: true),

  /// A minimum is set and this build meets it.
  buildMeetsMinimum(allows: true),

  /// A minimum is set and this build is below it. The ONLY blocking value.
  buildBelowMinimum(allows: false);

  const VersionGateReason({required this.allows});

  final bool allows;

  /// Safe to show a person. Only the blocking value has a user-facing
  /// sentence; the rest never reach a screen.
  String get message => switch (this) {
        VersionGateReason.buildBelowMinimum =>
          'This version of the app is no longer supported. Update to the '
              'latest version to carry on. Your saved work stays on this '
              'device.',
        _ => '',
      };
}

/// The gate's answer, with the reason and the two versions it compared.
final class VersionGateResult {
  const VersionGateResult({
    required this.reason,
    this.currentVersion = '',
    this.minimumVersion,
  });

  /// The state before any check has run. Allows.
  const VersionGateResult.notChecked()
      : reason = VersionGateReason.notChecked,
        currentVersion = '',
        minimumVersion = null;

  final VersionGateReason reason;

  /// This build's version.
  final String currentVersion;

  /// The configured minimum, or null when there is none or it was unreadable.
  final String? minimumVersion;

  bool get allows => reason.allows;

  bool get blocks => !reason.allows;

  /// Safe to display. Empty unless the gate blocks.
  String get userMessage => reason.message;

  /// Unsafe to display, safe to log. Carries no secret: two version numbers.
  String get technical =>
      'versionGate reason=${reason.name} current=$currentVersion '
      'minimum=${minimumVersion ?? 'none'}';

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is VersionGateResult &&
          other.reason == reason &&
          other.currentVersion == currentVersion &&
          other.minimumVersion == minimumVersion;

  @override
  int get hashCode => Object.hash(reason, currentVersion, minimumVersion);

  @override
  String toString() => 'VersionGateResult($technical)';
}

/// Decides the gate for a build and a configured minimum.
///
/// [minimumVersion] should already have been through [normaliseMinimumVersion].
/// Pass null when the configuration could not be read AND set
/// [configurationReadFailed] so the reason distinguishes "nothing configured"
/// from "we could not look". Both allow; only one is worth investigating.
VersionGateResult resolveVersionGate({
  required String currentVersion,
  String? minimumVersion,
  bool configurationReadFailed = false,
}) {
  if (configurationReadFailed) {
    return VersionGateResult(
      reason: VersionGateReason.minimumUnreadable,
      currentVersion: currentVersion,
    );
  }

  final String minimum = (minimumVersion ?? '').trim();
  if (minimum.isEmpty) {
    return VersionGateResult(
      reason: VersionGateReason.noMinimumConfigured,
      currentVersion: currentVersion,
    );
  }

  if (!_anyDigit.hasMatch(minimum)) {
    return VersionGateResult(
      reason: VersionGateReason.minimumUnparseable,
      currentVersion: currentVersion,
      minimumVersion: minimum,
    );
  }

  final bool blocked = compareVersions(currentVersion, minimum) < 0;
  return VersionGateResult(
    reason: blocked
        ? VersionGateReason.buildBelowMinimum
        : VersionGateReason.buildMeetsMinimum,
    currentVersion: currentVersion,
    minimumVersion: minimum,
  );
}
