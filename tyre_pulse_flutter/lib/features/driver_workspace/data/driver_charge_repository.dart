/// Reads and writes driver charge cases through the contract RPCs only:
/// `driver_charges_list`, `driver_charge_detail` and
/// `driver_workspace_command` with a `charge_*` action. Nothing touches a
/// charge table directly (they are SELECT-only for `authenticated`).
///
/// Responses and appeals are legal acts. They are sent ONLINE ONLY: there is
/// no offline queue here on purpose, so a signature is never replayed hours
/// later against a charge that changed in between. A network failure comes
/// back as [ChargeOfflineFailure] for the screen to say so plainly.
library;

import 'dart:async';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/features/driver_workspace/domain/driver_charge.dart';
import 'package:tyre_pulse/features/driver_workspace/domain/driver_workspace.dart';

final Provider<DriverChargeRepository> driverChargeRepositoryProvider =
    Provider<DriverChargeRepository>(
  (Ref ref) => SupabaseDriverChargeRepository(ref.watch(supabaseClientProvider)),
);

/// The request could not reach the server; nothing was recorded.
final class ChargeOfflineFailure implements Exception {
  const ChargeOfflineFailure();
}

/// One page of `driver_charges_list`.
final class DriverChargePage {
  const DriverChargePage({required this.rows, required this.hasMore});
  final List<DriverRow> rows;
  final bool hasMore;
}

abstract interface class DriverChargeRepository {
  Future<DriverChargePage> list({required String driverId, int offset = 0});
  Future<DriverChargeDetail> detail(String chargeId);
  Future<DriverRow> command(String action, DriverRow payload, String requestId);
}

final class SupabaseDriverChargeRepository implements DriverChargeRepository {
  SupabaseDriverChargeRepository(this._client);
  final SupabaseClient _client;

  /// The server returns up to 101 rows: 101 means there is another page.
  static const int pageSize = 100;

  Future<T> _call<T>(Future<T> Function() run) async {
    try {
      return await run();
    } on SocketException {
      throw const ChargeOfflineFailure();
    } on TimeoutException {
      throw const ChargeOfflineFailure();
    } on Object catch (error) {
      final AppError mapped = mapSupabaseError(error);
      if (mapped.kind == AppErrorKind.network) {
        throw const ChargeOfflineFailure();
      }
      throw mapped;
    }
  }

  @override
  Future<DriverChargePage> list({
    required String driverId,
    int offset = 0,
  }) =>
      _call(() async {
        final Object? result = await _client.rpc<Object?>(
          'driver_charges_list',
          params: <String, Object?>{
            'p_filters': <String, Object?>{'driver_id': driverId},
            'p_offset': offset,
          },
        );
        if (result is! Map || result['rows'] is! List) {
          throw const FormatException('Driver charges are unavailable.');
        }
        final List<DriverRow> rows = driverRows(result['rows']);
        return DriverChargePage(
          rows: rows.take(pageSize).toList(),
          hasMore: rows.length > pageSize,
        );
      });

  @override
  Future<DriverChargeDetail> detail(String chargeId) => _call(() async {
        final Object? result = await _client.rpc<Object?>(
          'driver_charge_detail',
          params: <String, Object?>{'p_charge_id': chargeId},
        );
        if (result is! Map || result['charge'] is! Map) {
          throw const FormatException('Charge details are unavailable.');
        }
        return DriverChargeDetail(Map<String, Object?>.from(result));
      });

  @override
  Future<DriverRow> command(
    String action,
    DriverRow payload,
    String requestId,
  ) {
    if (!action.startsWith('charge_') ||
        !driverChargeMobileActions.contains(action)) {
      throw ArgumentError.value(action, 'action', 'Not a phone charge action');
    }
    return _call(() async {
      final Object? result = await _client.rpc<Object?>(
        'driver_workspace_command',
        params: <String, Object?>{
          'p_action': action,
          'p_payload': payload,
          'p_request_id': requestId,
        },
      );
      return result is Map
          ? Map<String, Object?>.from(result)
          : <String, Object?>{};
    });
  }
}
