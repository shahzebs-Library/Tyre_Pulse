/// "Verify on site" rules, pure Dart.
///
/// MIRRORS `supabase/migrations/20261127180000_fleet_onsite_verification.sql`
/// (normalize_plate / plate_key / normalize_chassis /
/// chassis_has_invalid_vin_chars and the classification inside
/// submit_fleet_verification) and the web copy in
/// `src/lib/fleetVerification.js`. Change all three together.
///
/// The server decides. [previewVerification] only tells the supervisor,
/// before they save, what is filled now and what waits for a manager.
library;

import 'package:tyre_pulse/core/permissions/roles.dart';

enum FleetVerificationOutcome {
  present('present'),
  notFound('not_found'),
  otherCountry('other_country');

  const FleetVerificationOutcome(this.wire);
  final String wire;
}

/// Only these may submit. Enforced again server-side.
bool canVerifyOnSite(UserRole role, {required bool isSuperAdmin}) =>
    isSuperAdmin ||
    role.id == RoleId.admin ||
    role.id == RoleId.fleetSupervisor ||
    role.id == RoleId.fleetIncharge;

const String _cyrillic = 'АВЕКМНОРСТХУІЈ';
const String _latin = 'ABEKMHOPCTXYIJ';

/// Upper case, whitespace runs collapsed, trimmed; null when blank.
String? normalizePlate(String? v) {
  final String s =
      (v ?? '').toUpperCase().replaceAll(RegExp(r'\s+'), ' ').trim();
  return s.isEmpty ? null : s;
}

/// Every space removed; characters never reordered.
String? plateKey(String? v) {
  final String s = (v ?? '').toUpperCase().replaceAll(RegExp(r'\s+'), '');
  return s.isEmpty ? null : s;
}

/// Upper case, spaces/dashes/dots removed, Cyrillic lookalikes to Latin.
String? normalizeChassis(String? v) {
  final String s = (v ?? '').toUpperCase().replaceAll(RegExp(r'[\s\-.]+'), '');
  final StringBuffer out = StringBuffer();
  for (final int rune in s.runes) {
    final String ch = String.fromCharCode(rune);
    final int i = _cyrillic.indexOf(ch);
    out.write(i >= 0 ? _latin[i] : ch);
  }
  final String r = out.toString();
  return r.isEmpty ? null : r;
}

/// A real VIN never contains I, O or Q. A flag, never a refusal.
bool chassisHasInvalidVinChars(String? v) {
  final String? s = normalizeChassis(v);
  return s != null && RegExp('[IOQ]').hasMatch(s);
}

String? assetKey(String? v) {
  final String s = (v ?? '').toUpperCase().replaceAll(RegExp(r'\s+'), '');
  return s.isEmpty ? null : s;
}

String _segment(String? v, String fallback) {
  final String s = (v ?? '')
      .trim()
      .replaceAll(RegExp('[^a-zA-Z0-9_-]'), '_')
      .replaceAll(RegExp(r'^_+|_+$'), '');
  return s.isEmpty ? fallback : s;
}

/// `<org>/<COUNTRY>/<ASSET>/verify/<verificationId>.<ext>` - unique per
/// verification, so a new check never overwrites an earlier photo.
String verificationPhotoPath({
  required String? orgId,
  required String? country,
  required String? assetNo,
  required String verificationId,
  String ext = 'jpg',
}) =>
    <String>[
      _segment(orgId, 'no-org').toLowerCase(),
      _segment(country, 'NO-COUNTRY').toUpperCase(),
      _segment(assetNo, 'NO-ASSET').toUpperCase(),
      'verify',
      '${_segment(verificationId, 'no-id').toLowerCase()}.${_segment(ext, 'jpg').toLowerCase()}',
    ].join('/');

final class VerificationPreview {
  const VerificationPreview(this.status, this.flags, this.applyNow);

  /// `auto_applied`, `pending` or `invalid`.
  final String status;
  final List<String> flags;

  /// vehicle_fleet columns filled at once.
  final List<String> applyNow;
}

/// The vehicle as the preview needs it.
final class VerificationVehicle {
  const VerificationVehicle({
    required this.id,
    this.assetNo,
    this.registrationNo,
    this.chassisNo,
  });

  final String id;
  final String? assetNo;
  final String? registrationNo;
  final String? chassisNo;
}

VerificationPreview previewVerification({
  required VerificationVehicle vehicle,
  required FleetVerificationOutcome outcome,
  String? observedAssetNo,
  String? observedPlate,
  String? observedChassis,
  bool hasPhoto = false,
  List<VerificationVehicle> others = const <VerificationVehicle>[],
}) {
  if (outcome != FleetVerificationOutcome.present) {
    return VerificationPreview(
      'pending',
      <String>[outcome.wire],
      const <String>[],
    );
  }
  final List<String> flags = <String>[];
  final List<String> applyNow = <String>[];
  final String? plate = normalizePlate(observedPlate);
  final String? chassis = normalizeChassis(observedChassis);
  final String? obsAsset = assetKey(observedAssetNo);

  if (obsAsset != null && obsAsset != assetKey(vehicle.assetNo)) {
    flags.add('asset_code_mismatch');
  }
  if (chassis != null && chassisHasInvalidVinChars(chassis)) {
    flags.add('chassis_invalid_chars');
  }
  final Iterable<VerificationVehicle> rest =
      others.where((VerificationVehicle o) => o.id != vehicle.id);
  final bool dupPlate = plate != null &&
      rest.any(
        (VerificationVehicle o) =>
            plateKey(o.registrationNo) == plateKey(plate),
      );
  final bool dupChassis = chassis != null &&
      rest.any(
        (VerificationVehicle o) => normalizeChassis(o.chassisNo) == chassis,
      );

  if (plate != null) {
    if (dupPlate) flags.add('duplicate_plate');
    final String? onFile = plateKey(vehicle.registrationNo);
    if (onFile != null && onFile != plateKey(plate)) flags.add('plate_changed');
  }
  if (chassis != null) {
    if (dupChassis) flags.add('duplicate_chassis');
    final String? onFile = normalizeChassis(vehicle.chassisNo);
    if (onFile != null && onFile != chassis) flags.add('chassis_changed');
  }
  final String status = flags.isEmpty ? 'auto_applied' : 'pending';
  if (plate != null && plateKey(vehicle.registrationNo) == null && !dupPlate) {
    applyNow.add('registration_no');
  }
  if (chassis != null &&
      normalizeChassis(vehicle.chassisNo) == null &&
      !dupChassis) {
    applyNow.add('chassis_no');
  }
  if (status == 'auto_applied' && hasPhoto) applyNow.add('image_path');
  return VerificationPreview(status, flags, applyNow);
}
