/// The vehicle domain model: one `vehicle_fleet` row, decoded once.
///
/// Ported from the field set `mobile/app/(app)/vehicles.tsx` actually reads -
/// `id, asset_no, fleet_number, make, model, vehicle_type, site, status,
/// operator_name, tyre_size, current_km, country, department, region,
/// registration_no, year` - sixteen columns, no more. AGENTS.md rule 4: never
/// select a wider column list than what is consumed.
///
/// This file is deliberately free of `BuildContext` and `AppLocalizations`.
/// Where the production screen falls back to a translated placeholder (its
/// own `t('modules.vehicles.unknown')` for a row with neither an asset number
/// nor a fleet number), that fallback belongs to the PRESENTATION layer,
/// which has a `BuildContext` to resolve it with - a domain model choosing
/// its own English string would bake an untranslated word into a decoder
/// that has no way to translate it.
library;

import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';

/// One row of `vehicle_fleet`.
///
/// Every field except [id] is nullable, and stays nullable rather than
/// defaulting to an empty string or a zero - a fabricated "0 km" reads as a
/// real odometer, and `cache_tables.dart`'s own comment on `currentKm` names
/// that trap directly: "`current_km` is set on a minority of assets, and a
/// fabricated 0 would read as a real odometer."
final class VehicleAsset {
  const VehicleAsset({
    required this.id,
    this.assetNo,
    this.fleetNumber,
    this.make,
    this.model,
    this.vehicleType,
    this.site,
    this.status,
    this.operatorName,
    this.tyreSize,
    this.currentKm,
    this.country,
    this.department,
    this.region,
    this.registrationNo,
    this.year,
    this.serialNo,
    this.engineNo,
    this.capacity,
    this.opsStatus,
  });

  /// Decodes a raw PostgREST row, whether it came from the live
  /// `vehicle_fleet` read or from the offline `cached_assets` copy re-shaped
  /// to the same keys by the repository.
  ///
  /// Throws an [AppError] of kind [AppErrorKind.validation] when the row
  /// carries no usable `id`. Mirrors `WorkspaceProfile.fromRow`'s own rule in
  /// `lib/core/workspace/workspace_context.dart`: a row with no identity
  /// cannot be the subject of anything a person does next - tapping it,
  /// starting an inspection against it, caching it under its own key - so
  /// continuing with a fabricated or empty id would produce actions that
  /// silently target the wrong record, or none at all.
  factory VehicleAsset.fromRow(Map<String, dynamic> row) {
    final Object? rawId = row['id'];
    if (rawId is! String || rawId.isEmpty) {
      throw const AppError(
        kind: AppErrorKind.validation,
        message: 'A vehicle record could not be read. Try again, and '
            'contact your administrator if this keeps happening.',
        technical: 'vehicle_fleet row has no usable id column',
      );
    }

    return VehicleAsset(
      id: rawId,
      assetNo: _stringOrNull(row['asset_no']),
      fleetNumber: _stringOrNull(row['fleet_number']),
      make: _stringOrNull(row['make']),
      model: _stringOrNull(row['model']),
      vehicleType: _stringOrNull(row['vehicle_type']),
      site: _stringOrNull(row['site']),
      status: _stringOrNull(row['status']),
      operatorName: _stringOrNull(row['operator_name']),
      tyreSize: _stringOrNull(row['tyre_size']),
      currentKm: _intOrNull(row['current_km']),
      country: _stringOrNull(row['country']),
      department: _stringOrNull(row['department']),
      region: _stringOrNull(row['region']),
      registrationNo: _stringOrNull(row['registration_no']),
      year: _intOrNull(row['year']),
      serialNo: _stringOrNull(row['serial_no']),
      engineNo: _stringOrNull(row['engine_no']),
      capacity: _stringOrNull(row['capacity']),
      opsStatus: _stringOrNull(row['ops_status']),
    );
  }

  /// `vehicle_fleet.id`. The one field this model guarantees is present.
  final String id;

  /// `vehicle_fleet.asset_no`. A business code such as `TM514`, unique per
  /// `(organisation_id, country, asset_no)` rather than globally - see the
  /// warning on `AssetNo` in `lib/app/router/routes.dart`.
  final String? assetNo;

  final String? fleetNumber;
  final String? make;
  final String? model;
  final String? vehicleType;
  final String? site;

  /// Active / Inactive: is this machine on the current fleet.
  final String? status;

  final String? operatorName;
  final String? tyreSize;

  /// Nullable, and it must stay nullable. See the class comment.
  final int? currentKm;

  final String? country;
  final String? department;
  final String? region;

  /// The plate. `vehicle_fleet.registration_no`.
  final String? registrationNo;

  final int? year;

  /// Manufacturer / equipment serial stored by the fleet master. This is
  /// intentionally distinct from a tyre serial number.
  final String? serialNo;

  final String? engineNo;
  final String? capacity;

  /// Operational availability recorded by fleet operations. This is not the
  /// same field as [status], which represents the master-record lifecycle.
  final String? opsStatus;

  /// The identifier to show and to navigate with: [assetNo] when present,
  /// falling back to [fleetNumber]. Null when the row carries neither -
  /// callers must render an explicit "unknown vehicle" label rather than an
  /// empty string, and must not treat this row as navigable. See
  /// [hasNavigableAssetNo].
  String? get displayIdentity =>
      _stringOrNull(assetNo) ?? _stringOrNull(fleetNumber);

  /// Whether this row can be resolved again by [assetNo] alone.
  ///
  /// A detail screen and a "Start Inspection" deep link are both keyed on
  /// `asset_no`, because that is the only identifier the remote read (and the
  /// checklist/inspection screens elsewhere in the app) are scoped by - never
  /// the internal `id`. A row with a blank `asset_no` therefore has no usable
  /// destination even when [fleetNumber] is present, and must be rendered as
  /// non-interactive rather than silently routed by a value that cannot be
  /// re-fetched.
  bool get hasNavigableAssetNo => _stringOrNull(assetNo) != null;

  static String? _stringOrNull(Object? raw) {
    if (raw is! String) {
      return null;
    }
    final String trimmed = raw.trim();
    return trimmed.isEmpty ? null : trimmed;
  }

  static int? _intOrNull(Object? raw) {
    if (raw is int) {
      return raw;
    }
    if (raw is num) {
      return raw.toInt();
    }
    return null;
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is VehicleAsset &&
          other.id == id &&
          other.assetNo == assetNo &&
          other.fleetNumber == fleetNumber &&
          other.make == make &&
          other.model == model &&
          other.vehicleType == vehicleType &&
          other.site == site &&
          other.status == status &&
          other.operatorName == operatorName &&
          other.tyreSize == tyreSize &&
          other.currentKm == currentKm &&
          other.country == country &&
          other.department == department &&
          other.region == region &&
          other.registrationNo == registrationNo &&
          other.year == year &&
          other.serialNo == serialNo &&
          other.engineNo == engineNo &&
          other.capacity == capacity &&
          other.opsStatus == opsStatus);

  @override
  int get hashCode => Object.hash(
        id,
        assetNo,
        fleetNumber,
        make,
        model,
        vehicleType,
        site,
        status,
        operatorName,
        tyreSize,
        currentKm,
        country,
        department,
        region,
        registrationNo,
        year,
        serialNo,
        engineNo,
        capacity,
        opsStatus,
      );

  @override
  String toString() => 'VehicleAsset(id: $id, assetNo: $assetNo, '
      'fleetNumber: $fleetNumber)';
}

/// Fleet status -> design-system status tone.
///
/// Ported from `STATUS_KIND` in `mobile/app/(app)/vehicles.tsx`, compared
/// lower-cased so `Active`, `active` and `ACTIVE` all resolve the same way. A
/// status this application has never seen resolves to [TpStatus.unknown],
/// never to [TpStatus.neutral] - the production map's own default was
/// `neutral`, but this port draws the distinction spec section 32 asks for: a
/// status word nobody has catalogued is a gap in the mapping, not a
/// considered "no judgement" answer about the machine.
TpStatus vehicleStatusTone(String? status) {
  final String? normalised = status?.trim().toLowerCase();
  if (normalised == null || normalised.isEmpty) {
    return TpStatus.unknown;
  }
  switch (normalised) {
    case 'active':
    case 'operational':
    case 'running':
      return TpStatus.ok;
    case 'maintenance':
    case 'idle':
    case 'reallocation':
      return TpStatus.warning;
    case 'repair':
    case 'breakdown':
      return TpStatus.critical;
    case 'inactive':
    case 'retired':
    case 'sold':
    case 'planned_scrap':
      return TpStatus.neutral;
    default:
      return TpStatus.unknown;
  }
}

/// Formats an odometer reading with thousands separators - `128000` becomes
/// `128,000`.
///
/// A hand-written grouping rather than `intl`'s `NumberFormat`: this project
/// has no Flutter SDK installed to confirm `intl`'s number-formatting data is
/// available without a separate initialisation call the way its date
/// symbols are documented to need, and a reading is a plain digit grouping
/// with no currency or locale-specific decimal convention riding on it -
/// exactly the kind of five-line problem spec section 64 says not to reach
/// for a package dependency to solve.
String formatVehicleOdometer(int km) {
  final String digits = km.abs().toString();
  final StringBuffer grouped = StringBuffer();
  for (int i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) {
      grouped.write(',');
    }
    grouped.write(digits[i]);
  }
  return km < 0 ? '-$grouped' : grouped.toString();
}

/// Whether [error] should be shown as "the server could not be reached"
/// rather than as a generic failure.
///
/// A network-classified [AppError] already carries reassuring, retry-minded
/// wording (see `AppError.network`); everything else - a schema mismatch, a
/// server-side raise, an unrecognised failure - gets the plain error state
/// instead, because telling a person their work is safely queued when the
/// real problem is a stale app build invites the wrong next action.
bool isBackendUnavailableError(AppError error) =>
    error.kind == AppErrorKind.network;
