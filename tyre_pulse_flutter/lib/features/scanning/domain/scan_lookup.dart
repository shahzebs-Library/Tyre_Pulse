/// The asset-before-tyre resolution chain, and the small data shapes it
/// needs.
///
/// Ported from `mobile/lib/scanRouter.ts` (`resolveScan`),
/// `mobile/lib/assetLookup.ts` (`lookupAssetByCode`) and
/// `mobile/lib/tyreLookup.ts` (`lookupTyreBySerial`). A scanned or typed code
/// is resolved in this order, and the order is the whole point of the file:
///
///   1. an EXACT `asset_no` match
///   2. a CASE-INSENSITIVE `asset_no` match
///   3. a CASE-INSENSITIVE `fleet_number` match
///   4. only once none of the above matched anything: a tyre serial match
///
/// # Deliberately this feature's own copy
///
/// `lib/features/assets/` and `lib/features/tyres/` are being built by other
/// agents concurrently and are not stable dependencies yet - phase 3's own
/// package boundary keeps scanning self-contained rather than coupled to
/// work in flight elsewhere. [AssetLookupRecord] and [TyreLookupRecord] here
/// are therefore narrow, scanning-specific shapes, not the fleet's eventual
/// domain model; a later phase that gives assets and tyres a shared model
/// can fold this file's read paths into it without changing how scanning
/// resolves a code.
///
/// # Why LIKE escaping is the repository's job, not the caller's
///
/// [ScanLookupSource] methods all take the SAME plain code - never a
/// pre-escaped pattern - because escaping (`%` and `_` -> `\%` and `\_`) is
/// NOT idempotent: applying it twice would double-escape a literal
/// backslash the first pass introduced and silently stop matching the very
/// row it was meant to find. Keeping escaping entirely inside
/// [ScanLookupRepository]'s ILIKE methods means there is exactly one place
/// it can happen, so it can never happen twice.
library;

import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/features/scanning/domain/scan_payload.dart';

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

/// A `vehicle_fleet` row, shaped for the scan result card and its typed
/// destination routes.
///
/// Column set mirrors `assetLookup.ts`'s `ASSET_COLS` exactly. The four
/// beyond `id`/`site`/`asset_no`/`vehicle_type` - `registration_no`,
/// `chassis_no`, `current_km` and `make`/`model` - are sparse in the live
/// fleet (populated on well under half of assets across the countries this
/// application serves), which is exactly why every field beyond [id] and
/// [assetNo] is nullable rather than defaulted to something that would look
/// like a real, empty measurement.
@immutable
final class AssetLookupRecord {
  const AssetLookupRecord({
    required this.id,
    required this.assetNo,
    this.site,
    this.vehicleType,
    this.make,
    this.model,
    this.fleetNumber,
    this.registrationNo,
    this.chassisNo,
    this.currentKm,
  });

  /// Decodes one `vehicle_fleet` row.
  ///
  /// Throws a [FormatException] when the row has no usable `id` - a row a
  /// caller cannot identify cannot safely be routed to (view, inspect), so
  /// surfacing that as a decode failure the orchestrator turns into a
  /// [ScanLookupFailed] is safer than handing back a record nothing can act
  /// on. Mirrors the same choice `WorkspaceProfile.fromRow` and this
  /// project's own `tyres` feature already make for a missing row id.
  factory AssetLookupRecord.fromRow(Map<String, dynamic> row) {
    final String id = _stringOrNull(row['id']) ?? '';
    if (id.isEmpty) {
      throw const FormatException('vehicle_fleet row has no usable id');
    }
    return AssetLookupRecord(
      id: id,
      assetNo: _stringOrNull(row['asset_no']) ?? '',
      site: _stringOrNull(row['site']),
      vehicleType: _stringOrNull(row['vehicle_type']),
      make: _stringOrNull(row['make']),
      model: _stringOrNull(row['model']),
      fleetNumber: _stringOrNull(row['fleet_number']),
      registrationNo: _stringOrNull(row['registration_no']),
      chassisNo: _stringOrNull(row['chassis_no']),
      currentKm: _numOrNull(row['current_km']),
    );
  }

  /// `vehicle_fleet.id`.
  final String id;

  /// `vehicle_fleet.asset_no`. A business code such as `TM514`, unique per
  /// `(organisation_id, country, asset_no)` rather than globally - see the
  /// `AssetNo` doc comment in `app/router/routes.dart` for why the active
  /// country, never a value carried on this record, is what any caller must
  /// resolve a code against.
  final String assetNo;

  final String? site;
  final String? vehicleType;
  final String? make;
  final String? model;
  final String? fleetNumber;
  final String? registrationNo;
  final String? chassisNo;

  /// Carried as a plain `num` because Postgres numeric columns decode as
  /// either `int` or `double` depending on the value, and nothing here
  /// computes with it - display-only.
  final num? currentKm;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is AssetLookupRecord &&
          other.id == id &&
          other.assetNo == assetNo &&
          other.site == site &&
          other.vehicleType == vehicleType &&
          other.make == make &&
          other.model == model &&
          other.fleetNumber == fleetNumber &&
          other.registrationNo == registrationNo &&
          other.chassisNo == chassisNo &&
          other.currentKm == currentKm;

  @override
  int get hashCode => Object.hash(
        id,
        assetNo,
        site,
        vehicleType,
        make,
        model,
        fleetNumber,
        registrationNo,
        chassisNo,
        currentKm,
      );

  @override
  String toString() => 'AssetLookupRecord(assetNo: $assetNo, site: $site)';
}

/// A `tyre_records` row, shaped for the scan result card.
///
/// Column set mirrors `tyreLookup.ts`'s select list exactly, including the
/// legacy free-text [position] column kept only because the reference
/// implementation reads both it and [tyrePosition] and falls back to the
/// former.
@immutable
final class TyreLookupRecord {
  const TyreLookupRecord({
    required this.id,
    this.brand,
    this.size,
    this.position,
    this.tyrePosition,
    this.assetNo,
    this.site,
    this.treadDepth,
    this.pressureReading,
  });

  /// Decodes one `tyre_records` row. Throws a [FormatException] for a
  /// missing `id` - see [AssetLookupRecord.fromRow]'s note; the same reason
  /// applies here.
  factory TyreLookupRecord.fromRow(Map<String, dynamic> row) {
    final String id = _stringOrNull(row['id']) ?? '';
    if (id.isEmpty) {
      throw const FormatException('tyre_records row has no usable id');
    }
    return TyreLookupRecord(
      id: id,
      brand: _stringOrNull(row['brand']),
      size: _stringOrNull(row['size']),
      position: _stringOrNull(row['position']),
      tyrePosition: _stringOrNull(row['tyre_position']),
      assetNo: _stringOrNull(row['asset_no']),
      site: _stringOrNull(row['site']),
      treadDepth: _displayOrNull(row['tread_depth']),
      pressureReading: _displayOrNull(row['pressure_reading']),
    );
  }

  /// `tyre_records.id`.
  final String id;

  final String? brand;
  final String? size;

  /// The legacy free-text position column. Prefer [tyrePosition].
  final String? position;

  /// The canonical position code, for example `LHF1` or `RHCO`. Never
  /// reordered under a right-to-left locale and never renamed once
  /// assigned - see `TpIdentifierText` and the `TyrePosition` identifier in
  /// `app/router/routes.dart`.
  final String? tyrePosition;

  /// `vehicle_fleet.asset_no`. Null when this tyre is not currently fitted
  /// to any asset, which is a real state, not a data gap.
  final String? assetNo;

  final String? site;

  /// Rendered as text on purpose: the source column has been imported as
  /// either a number or free text depending on the row's history, and
  /// nothing here computes with the value.
  final String? treadDepth;
  final String? pressureReading;

  /// The best available position label: the canonical code, else the legacy
  /// free-text column, else null when neither was recorded.
  String? get bestPosition => tyrePosition ?? position;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is TyreLookupRecord &&
          other.id == id &&
          other.brand == brand &&
          other.size == size &&
          other.position == position &&
          other.tyrePosition == tyrePosition &&
          other.assetNo == assetNo &&
          other.site == site &&
          other.treadDepth == treadDepth &&
          other.pressureReading == pressureReading;

  @override
  int get hashCode => Object.hash(
        id,
        brand,
        size,
        position,
        tyrePosition,
        assetNo,
        site,
        treadDepth,
        pressureReading,
      );

  @override
  String toString() =>
      'TyreLookupRecord(id: $id, assetNo: $assetNo, position: $bestPosition)';
}

/// Strict decode: accepts only a genuine [String] column value, trimmed, and
/// empty-collapsed to null. Used for every column this schema stores as
/// Postgres `text`.
String? _stringOrNull(Object? raw) {
  if (raw is! String) {
    return null;
  }
  final String trimmed = raw.trim();
  return trimmed.isEmpty ? null : trimmed;
}

/// Permissive decode for a column recorded inconsistently as text or as a
/// number across this table's import history (`tread_depth`,
/// `pressure_reading`). `Object?.toString()` is well-defined on Dart's
/// null-safe `Object?` without a cast, which is what makes this safe without
/// an `is` check first.
String? _displayOrNull(Object? raw) {
  if (raw == null) {
    return null;
  }
  final String text = raw.toString().trim();
  return text.isEmpty ? null : text;
}

/// Decodes a Postgres numeric column that may arrive as [int], [double], or
/// (rarely, from a text-typed source column) a numeric string.
num? _numOrNull(Object? raw) {
  if (raw is num) {
    return raw;
  }
  if (raw is String) {
    return num.tryParse(raw.trim());
  }
  return null;
}

// ---------------------------------------------------------------------------
// LIKE escaping
// ---------------------------------------------------------------------------

/// The two characters PostgreSQL's LIKE/ILIKE treats as wildcards.
final RegExp _likeWildcardPattern = RegExp(r'[%_]');

/// Escapes `%` and `_` in [value] so it matches only ITSELF in a pattern
/// query, never a wider set of rows. Ported verbatim from the inline
/// `code.replace(/[%_]/g, ...)` in `assetLookup.ts`.
///
/// NOT idempotent - see the library comment - and deliberately does not also
/// escape a literal backslash, matching the reference's own accepted risk
/// profile rather than introducing a new one. See
/// [ScanLookupRepository.findTyreBySerial] for the same reasoning applied to
/// the characters a raw `.or()` filter string is sensitive to.
String escapeLikeLiteral(String value) {
  return value.replaceAllMapped(
    _likeWildcardPattern,
    (Match match) => '\\${match[0]}',
  );
}

// ---------------------------------------------------------------------------
// The chain
// ---------------------------------------------------------------------------

/// The narrow surface [resolveScanLookup] needs from a data source.
///
/// Every method takes the SAME plain, already-extracted code - see
/// [extractScanCode] - so a caller never builds a query fragment itself.
/// This is what lets [resolveScanLookup] be unit-tested with a hand-written
/// fake that performs no I/O at all: the ORDERING of the chain is what that
/// function owns, and the ordering is fully expressible against this
/// interface with nothing Supabase-shaped in it.
abstract interface class ScanLookupSource {
  /// An exact `asset_no` match.
  Future<AssetLookupRecord?> findAssetByExactNumber(String code);

  /// A case-insensitive `asset_no` match, tried only when the exact match
  /// misses.
  Future<AssetLookupRecord?> findAssetByNumberIgnoringCase(String code);

  /// A case-insensitive `fleet_number` fallback, for a label printed with
  /// the fleet number rather than the asset number. Tried only when both
  /// `asset_no` steps miss.
  Future<AssetLookupRecord?> findAssetByFleetNumberIgnoringCase(String code);

  /// A tyre serial match. Tried only once no asset step matched anything at
  /// all - item 2 of this feature's ported algorithm.
  Future<TyreLookupRecord?> findTyreBySerial(String code);
}

/// What a scanned or typed code resolved to.
///
/// Every variant carries [rawInput] (exactly what was scanned or typed) and
/// [code] (what [extractScanCode] made of it), so a caller can always show
/// or reuse the code, including on a variant that carries no matched record.
@immutable
sealed class ScanLookupResult {
  const ScanLookupResult({required this.rawInput, required this.code});

  final String rawInput;
  final String code;
}

/// Resolved to a vehicle.
final class AssetScanMatch extends ScanLookupResult {
  const AssetScanMatch({
    required super.rawInput,
    required super.code,
    required this.asset,
  });

  final AssetLookupRecord asset;
}

/// Resolved to a tyre.
final class TyreScanMatch extends ScanLookupResult {
  const TyreScanMatch({
    required super.rawInput,
    required super.code,
    required this.tyre,
  });

  final TyreLookupRecord tyre;
}

/// The chain ran to completion and matched nothing visible to this user.
final class ScanNoMatch extends ScanLookupResult {
  const ScanNoMatch({required super.rawInput, required super.code});
}

/// A step in the chain failed before it could report a match or a miss.
///
/// Deliberately its OWN variant rather than folded into [ScanNoMatch]. The
/// production `scanRouter.ts` this was ported from DOES fold a lookup
/// failure into its `'none'` result; this feature's own exit criterion -
/// "never a silent failure" - argues against silently repeating that here.
/// A field worker offline or hitting a server hiccup deserves to be told
/// that, not shown the identical screen a genuinely clean miss would
/// produce. Both variants still lead to the same manual-entry fallback -
/// see `scan_route_resolver.dart` - so nothing about that exit criterion is
/// weakened by telling the two apart.
final class ScanLookupFailed extends ScanLookupResult {
  const ScanLookupFailed({
    required super.rawInput,
    required super.code,
    required this.error,
  });

  final AppError error;
}

/// Resolves [raw] against [source]: asset before tyre, exact before fuzzy.
///
/// Ported from `scanRouter.ts`'s `resolveScan`, with one deliberate
/// simplification. The reference calls its own `extractScanCode` twice -
/// once directly, once again inside `lookupAssetByCode`, which is also
/// reached by callers that have not extracted yet. [extractScanCode] is
/// idempotent, so calling it once here and passing the result to every step
/// below produces the identical observable result without a redundant
/// re-parse.
///
/// Never throws. Any failure from [source] - a [SupabaseFailure] from a
/// real [ScanLookupRepository], or anything a test fake throws - is caught
/// and reported as [ScanLookupFailed] rather than propagating: a scan that
/// crashes the screen is exactly the outcome this feature's exit criterion
/// rules out.
Future<ScanLookupResult> resolveScanLookup(
  String raw,
  ScanLookupSource source,
) async {
  final String code = extractScanCode(raw);
  if (code.isEmpty) {
    return ScanNoMatch(rawInput: raw, code: code);
  }

  try {
    final AssetLookupRecord? asset = await _resolveAsset(code, source);
    if (asset != null) {
      final String resolvedCode =
          asset.assetNo.trim().isEmpty ? code : asset.assetNo;
      return AssetScanMatch(rawInput: raw, code: resolvedCode, asset: asset);
    }

    final TyreLookupRecord? tyre = await source.findTyreBySerial(code);
    if (tyre != null) {
      return TyreScanMatch(
        rawInput: raw,
        code: sanitizeScanCode(code),
        tyre: tyre,
      );
    }

    return ScanNoMatch(rawInput: raw, code: code);
  } on Object catch (error) {
    return ScanLookupFailed(
      rawInput: raw,
      code: code,
      error: _asAppError(error),
    );
  }
}

/// Item 2 of the ported algorithm: exact, then case-insensitive by number,
/// then case-insensitive by fleet number. Stops at the first hit -
/// [ScanLookupSource.findAssetByFleetNumberIgnoringCase] is never reached
/// once an earlier step already matched.
Future<AssetLookupRecord?> _resolveAsset(
  String code,
  ScanLookupSource source,
) async {
  final AssetLookupRecord? exact = await source.findAssetByExactNumber(code);
  if (exact != null) {
    return exact;
  }
  final AssetLookupRecord? byNumber =
      await source.findAssetByNumberIgnoringCase(code);
  if (byNumber != null) {
    return byNumber;
  }
  return source.findAssetByFleetNumberIgnoringCase(code);
}

/// Reclassifies anything a [ScanLookupSource] threw into a displayable
/// [AppError]. A real [ScanLookupRepository] can only ever throw a
/// [SupabaseFailure] - every one of its queries runs through
/// [SupabaseGateway.guard], which never throws anything else, and its row
/// decoders throw only a [FormatException] for an unusable id. Handling any
/// other [Object] besides is what lets a test fake throw a plain exception
/// without [resolveScanLookup] needing to know about it.
AppError _asAppError(Object error) {
  if (error is AppError) {
    return error;
  }
  if (error is SupabaseFailure) {
    return error.error;
  }
  return AppError(
    kind: AppErrorKind.unknown,
    message: 'That could not be looked up. Try again, or search for it below.',
    technical: error.toString(),
    cause: error,
    isRetryable: true,
  );
}

// ---------------------------------------------------------------------------
// The real implementation
// ---------------------------------------------------------------------------

/// The real, Supabase-backed [ScanLookupSource].
///
/// Reads only `vehicle_fleet` and `tyre_records`, mirroring
/// `assetLookup.ts` and `tyreLookup.ts` exactly - including
/// [findTyreBySerial]'s three-column `.or()` filter. That filter
/// interpolates its code into a raw PostgREST filter STRING rather than
/// binding it as a parameter (`.or()` has no bound-parameter form), so a
/// code containing a `.` could in principle confuse the mini-DSL it is
/// written in. The reference this was ported from accepts exactly the same
/// risk and defends only against the characters actually reachable through
/// this feature's own entry points - parentheses and commas, stripped by
/// [sanitizeScanCode] before any query is built. That is a faithful port of
/// an already-live risk profile, not a new gap introduced here.
final class ScanLookupRepository
    with SupabaseGateway
    implements ScanLookupSource {
  ScanLookupRepository(this._client);

  final SupabaseClient _client;

  /// Mirrors `assetLookup.ts`'s `ASSET_COLS` exactly.
  static const String _assetColumns = 'id, site, asset_no, vehicle_type, '
      'make, model, fleet_number, registration_no, chassis_no, current_km';

  /// Mirrors `tyreLookup.ts`'s select list exactly.
  static const String _tyreColumns = 'id, brand, size, position, '
      'tyre_position, asset_no, site, tread_depth, pressure_reading';

  @override
  Future<AssetLookupRecord?> findAssetByExactNumber(String code) async {
    final String clean = sanitizeScanCode(code);
    if (clean.isEmpty) {
      return null;
    }
    final List<Map<String, dynamic>> rows =
        await guard<List<Map<String, dynamic>>>(
      () => _client
          .from(SupabaseTables.vehicleFleet)
          .select(_assetColumns)
          .eq('asset_no', clean)
          .limit(1),
    );
    return rows.isEmpty ? null : AssetLookupRecord.fromRow(rows.first);
  }

  @override
  Future<AssetLookupRecord?> findAssetByNumberIgnoringCase(String code) async {
    final String literal = _likeLiteralFor(code);
    if (literal.isEmpty) {
      return null;
    }
    final List<Map<String, dynamic>> rows =
        await guard<List<Map<String, dynamic>>>(
      () => _client
          .from(SupabaseTables.vehicleFleet)
          .select(_assetColumns)
          .ilike('asset_no', literal)
          .limit(1),
    );
    return rows.isEmpty ? null : AssetLookupRecord.fromRow(rows.first);
  }

  @override
  Future<AssetLookupRecord?> findAssetByFleetNumberIgnoringCase(
    String code,
  ) async {
    final String literal = _likeLiteralFor(code);
    if (literal.isEmpty) {
      return null;
    }
    final List<Map<String, dynamic>> rows =
        await guard<List<Map<String, dynamic>>>(
      () => _client
          .from(SupabaseTables.vehicleFleet)
          .select(_assetColumns)
          .ilike('fleet_number', literal)
          .limit(1),
    );
    return rows.isEmpty ? null : AssetLookupRecord.fromRow(rows.first);
  }

  @override
  Future<TyreLookupRecord?> findTyreBySerial(String code) async {
    final String clean = sanitizeScanCode(code);
    if (clean.isEmpty) {
      return null;
    }
    final List<Map<String, dynamic>> rows =
        await guard<List<Map<String, dynamic>>>(
      () => _client
          .from(SupabaseTables.tyreRecords)
          .select(_tyreColumns)
          .or(
            'serial_no.eq.$clean,serial_number.eq.$clean,'
            'tyre_serial.eq.$clean',
          )
          .limit(1),
    );
    return rows.isEmpty ? null : TyreLookupRecord.fromRow(rows.first);
  }

  /// The whole chain in one call: asset before tyre, exact before fuzzy.
  Future<ScanLookupResult> resolve(String raw) => resolveScanLookup(raw, this);

  /// Sanitizes THEN escapes, so the two steps can never run out of order or
  /// run twice - see [escapeLikeLiteral]'s note on why escaping is not safe
  /// to repeat.
  String _likeLiteralFor(String code) =>
      escapeLikeLiteral(sanitizeScanCode(code));
}
