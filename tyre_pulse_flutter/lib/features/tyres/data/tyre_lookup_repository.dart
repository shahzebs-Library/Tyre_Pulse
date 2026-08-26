/// Serial lookup, and scrap / undo-scrap as single-RPC actions.
///
/// # The defect this file exists to make impossible
///
/// A prior implementation elsewhere in this project once split "mark this
/// tyre scrapped" into two client writes: a `tyre_status_marks` insert (which
/// any approved user may make) followed by a separate `tyre_records.status`
/// update (which needs a stronger role). The second write was silently
/// refused by row-level security while the first one landed, so the tyre
/// read Scrapped in the register while it was still fitted, active, in the
/// pool. That is a real, documented production defect class, not a
/// hypothetical one.
///
/// The fix ported here from `mobile/lib/tyreScrap.ts` is structural, not a
/// discipline to remember: [scrapBySerial] and [unscrapBySerial] make
/// EXACTLY ONE mutating call each, to [SupabaseRpcs.scrapTyreBySerial] and
/// [SupabaseRpcs.unscrapTyreBySerial] respectively - both DEFINER functions
/// that write every affected row inside one server-side transaction, so the
/// two facts (the mark, the status) can never disagree. Neither method here
/// contains any other code path that touches `tyre_status_marks` or
/// `tyre_records` directly, so there is no way for a future edit to
/// reintroduce the two-write shape without deleting this comment along with
/// it.
///
/// # The precondition is asked, never inferred
///
/// Before either mutating call, this file asks the server whether the
/// caller may make it at all - [SupabaseRpcs.tyreScrapAllowed] or
/// [SupabaseRpcs.tyreUnscrapAllowed] - and refuses LOCALLY with a plain
/// [AppError.authorization] when the answer is anything other than an
/// explicit `true`. The mutating RPC is never attempted in that case. This
/// mirrors `mobile/lib/tyreScrap.ts`'s own reasoning: the phone cannot tell a
/// role from a role string (`normaliseRole` silently downgrades an unknown
/// one), and a per-user capability grant is invisible to the client unless
/// it is asked for directly - so the server is asked, not guessed.
///
/// One honest trade-off, carried from the production behaviour rather than
/// invented here: [canScrap] and [canUnscrap] answer `false` on ANY failure
/// to confirm - a genuine "no", a dropped connection, an unexpected reply
/// all look the same from here, because "never show, or attempt, an action
/// we cannot confirm" is safer than distinguishing them. So a scrap refused
/// by [scrapBySerial] under a flaky connection reads as a permission
/// refusal rather than a network one. That is deliberate, not a bug.
///
/// # Why the RPC mechanism is injected
///
/// [SupabaseTyreLookupRepository] takes its RPC caller through [RpcCaller]
/// rather than calling `SupabaseClient.rpc` inline, so the "ask, then make
/// exactly one write" policy above is directly unit-testable - asserting the
/// exact sequence and content of server calls - without depending on the
/// precise `supabase_flutter` query-builder generics, which cannot be
/// verified against the SDK in this environment (no Flutter toolchain or pub
/// cache is available here; see `supabase_gateway_test.dart`'s own note on
/// the same limitation). [SupabaseTyreLookupRepository.new] wires the real
/// mechanism; [SupabaseTyreLookupRepository.withRpcCaller] is the test seam.
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/features/tyres/domain/tyre_lookup_record.dart';
import 'package:tyre_pulse/features/tyres/domain/tyre_scrap_mark.dart';
import 'package:tyre_pulse/features/tyres/domain/tyre_serial_code.dart';

/// One RPC round trip: a function name and its parameters in, whatever the
/// server decoded the response as - not yet interpreted - out.
///
/// Extracted as its own type so a test can substitute exactly how an RPC is
/// invoked, without needing a real or mocked [SupabaseClient]. See the
/// library comment.
typedef RpcCaller = Future<Object?> Function(
  String function,
  Map<String, Object?> params,
);

/// The columns [TyreLookupRecord.fromRow] reads. Kept as one constant so the
/// query and the decoder cannot silently drift apart.
const String _lookupColumns =
    'id, brand, size, position, tyre_position, '
    'asset_no, site, tread_depth, pressure_reading';

/// The columns [ScrapMark.fromRow] reads.
const String _scrapMarkColumns = 'serial, reason, created_at';

/// The narrow surface the serial search screen needs.
abstract interface class TyreLookupRepository {
  /// Resolves [rawSerial] to its canonical tyre record, or null when no row
  /// matches. [rawSerial] may be a bare serial, or a scanned payload it
  /// still needs unwrapping - see `tyre_serial_code.dart`.
  Future<TyreLookupRecord?> lookupBySerial(String rawSerial);

  /// The active 'scrap' mark for [rawSerial], or null when it is not
  /// scrapped.
  Future<ScrapMark?> getScrapMark(String rawSerial);

  /// Whether the signed-in user may mark a tyre scrapped. Fails CLOSED - see
  /// the library comment.
  Future<bool> canScrap();

  /// Whether the signed-in user may undo a scrap. A separate, narrower right
  /// from [canScrap]: marking a scrap is a field observation available to
  /// the tyre-handling roles; undoing one is a correction to the record and
  /// is reserved for administrators. Asking separately is what lets a field
  /// role see the Mark-as-scrap button without the Undo button, rather than
  /// getting both or neither from one combined flag.
  Future<bool> canUnscrap();

  /// Marks the tyre with serial [rawSerial] scrapped, recording [reason].
  ///
  /// Returns how many lifecycle rows the server flagged. Throws
  /// [AppError.authorization] locally, without contacting the mutating RPC
  /// at all, when the precondition in [canScrap] does not answer `true`.
  Future<int> scrapBySerial(String rawSerial, {String? reason});

  /// Reverses a scrap mark for [rawSerial], restoring each affected row to
  /// the status it held BEFORE it was scrapped - never a blanket "Active".
  ///
  /// Throws [AppError.authorization] locally, without contacting the
  /// mutating RPC at all, when the precondition in [canUnscrap] does not
  /// answer `true`.
  Future<void> unscrapBySerial(String rawSerial);
}

/// The real implementation: Supabase PostgREST reads plus the two guarded
/// RPC actions.
final class SupabaseTyreLookupRepository
    with SupabaseGateway
    implements TyreLookupRepository {
  /// The production constructor. Reads go through [client]; RPC calls go
  /// through the caller [_defaultRpcCaller] builds from the same client.
  SupabaseTyreLookupRepository(SupabaseClient client)
    : _client = client,
      _rpc = _defaultRpcCaller(client);

  /// For tests only.
  ///
  /// Substitutes how an RPC is actually invoked, so the "ask permission,
  /// then make exactly one write" policy in [scrapBySerial] and
  /// [unscrapBySerial] is verifiable without constructing a real
  /// [SupabaseClient] and without depending on the exact `supabase_flutter`
  /// query-builder chain - see the library comment. [client] is reached only
  /// by [lookupBySerial] and [getScrapMark]; a test that exercises only
  /// scrap/unscrap may omit it, and those two methods will simply never be
  /// called in that test.
  SupabaseTyreLookupRepository.withRpcCaller(
    this._rpc, {
    SupabaseClient? client,
  }) : _client = client;

  final SupabaseClient? _client;
  final RpcCaller _rpc;

  static RpcCaller _defaultRpcCaller(SupabaseClient client) {
    return (String function, Map<String, Object?> params) async {
      return await client.rpc(function, params: params);
    };
  }

  SupabaseClient _requireClient(String forMethod) {
    final SupabaseClient? client = _client;
    if (client == null) {
      throw StateError(
        '$forMethod needs a SupabaseClient, but this repository was built '
        'with .withRpcCaller and no client was supplied.',
      );
    }
    return client;
  }

  @override
  Future<TyreLookupRecord?> lookupBySerial(String rawSerial) async {
    final String code = sanitizeSerial(extractScanCode(rawSerial));
    if (code.isEmpty) return null;

    final SupabaseClient client = _requireClient('lookupBySerial');
    final List<Map<String, dynamic>>
    rows = await guard<List<Map<String, dynamic>>>(() async {
      final List<Map<String, dynamic>> result = await client
          .from(SupabaseTables.tyreRecords)
          .select(_lookupColumns)
          .or('serial_no.eq.$code,serial_number.eq.$code,tyre_serial.eq.$code')
          .limit(1);
      return result;
    });

    if (rows.isEmpty) return null;
    return TyreLookupRecord.fromRow(rows.first);
  }

  @override
  Future<ScrapMark?> getScrapMark(String rawSerial) async {
    final String code = sanitizeSerial(extractScanCode(rawSerial));
    if (code.isEmpty) return null;

    final SupabaseClient client = _requireClient('getScrapMark');
    final Map<String, dynamic>? row = await guard<Map<String, dynamic>?>(
      () async {
        final Map<String, dynamic>? result = await client
            .from(SupabaseTables.tyreStatusMarks)
            .select(_scrapMarkColumns)
            .eq('serial', code)
            .eq('mark_type', 'scrap')
            .maybeSingle();
        return result;
      },
    );

    if (row == null) return null;
    return ScrapMark.fromRow(row);
  }

  @override
  Future<bool> canScrap() => _askAllowed(SupabaseRpcs.tyreScrapAllowed);

  @override
  Future<bool> canUnscrap() => _askAllowed(SupabaseRpcs.tyreUnscrapAllowed);

  /// Never throws. Any failure to confirm - refused, unreachable, an
  /// unrecognised reply - answers `false`. See the library comment.
  Future<bool> _askAllowed(String rpcName) async {
    try {
      final Object? data = await _rpc(rpcName, const <String, Object?>{});
      return data == true;
    } on Object {
      return false;
    }
  }

  @override
  Future<int> scrapBySerial(String rawSerial, {String? reason}) async {
    final String code = _requireSerial(rawSerial, forMethod: 'scrapBySerial');

    if (!await canScrap()) {
      throw const AppError(
        kind: AppErrorKind.authorization,
        message: 'You do not have permission to mark a tyre as scrapped.',
        technical:
            'tyre_scrap_allowed did not answer true before '
            'scrap_tyre_by_serial was attempted',
      );
    }

    final Object? data = await guard<Object?>(
      () => _rpc(SupabaseRpcs.scrapTyreBySerial, <String, Object?>{
        'p_serial': code,
        'p_reason': _normalisedReason(reason),
        'p_country': null,
      }),
    );
    return _updatedCount(data);
  }

  @override
  Future<void> unscrapBySerial(String rawSerial) async {
    final String code = _requireSerial(rawSerial, forMethod: 'unscrapBySerial');

    if (!await canUnscrap()) {
      throw const AppError(
        kind: AppErrorKind.authorization,
        message: 'You do not have permission to undo a scrap.',
        technical:
            'tyre_unscrap_allowed did not answer true before '
            'unscrap_tyre_by_serial was attempted',
      );
    }

    await guard<Object?>(
      () => _rpc(SupabaseRpcs.unscrapTyreBySerial, <String, Object?>{
        'p_serial': code,
      }),
    );
  }

  String _requireSerial(String rawSerial, {required String forMethod}) {
    final String code = sanitizeSerial(extractScanCode(rawSerial));
    if (code.isEmpty) {
      throw AppError(
        kind: AppErrorKind.validation,
        message: 'Enter or scan a serial number first.',
        technical: '$forMethod called with a blank serial',
      );
    }
    return code;
  }

  String? _normalisedReason(String? reason) {
    final String? trimmed = reason?.trim();
    return (trimmed == null || trimmed.isEmpty) ? null : trimmed;
  }

  static int _updatedCount(Object? data) {
    if (data is Map) {
      final Object? updated = data['updated'];
      if (updated is num) return updated.round();
    }
    return 0;
  }
}
