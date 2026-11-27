/// Reads and writes the shared driver pool through the server RPCs only.
///
/// Every write is ONLINE ONLY, on purpose. A vehicle assignment decides who is
/// liable for that vehicle from that moment, and a charge or fine is a legal
/// notice to a driver; neither may be replayed hours later against a team or a
/// vehicle that changed in between. A network failure comes back as
/// [FleetOfflineFailure] for the screen to say so plainly, and nothing is
/// queued. Each call carries a request id, so pressing Save twice records once.
library;

import 'dart:async';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/features/fleet_supervisor/domain/fleet_team.dart';

final Provider<FleetTeamRepository> fleetTeamRepositoryProvider =
    Provider<FleetTeamRepository>(
  (Ref ref) => SupabaseFleetTeamRepository(ref.watch(supabaseClientProvider)),
);

/// The request could not reach the server; nothing was recorded.
final class FleetOfflineFailure implements Exception {
  const FleetOfflineFailure();
}

abstract interface class FleetTeamRepository {
  Future<FleetTeamPage> drivers({
    required FleetTeamView view,
    String search = '',
    int offset = 0,
    String? category,
    String? region,
  });

  Future<FleetFilterOptions> filters();

  Future<List<FleetAssignment>> history(String driverId);

  Future<List<FleetVehicleOption>> vehicles({
    required String? country,
    String search = '',
  });

  Future<FleetCommandOutcome> command(
    String action,
    Map<String, Object?> payload,
    String requestId,
  );

  /// `charge_issue` through `driver_workspace_command`.
  Future<void> issueCharge(Map<String, Object?> payload, String requestId);

  /// `create_fine` through `driver_workspace_command`.
  Future<void> createFine(Map<String, Object?> payload, String requestId);

  /// Uploads a charge evidence photo and returns its `tp-storage://` reference
  /// (the path `private.driver_charge_claim_photo` accepts).
  Future<String> uploadChargePhoto({
    required String localPath,
    required String driverId,
  });
}

final class SupabaseFleetTeamRepository implements FleetTeamRepository {
  SupabaseFleetTeamRepository(this._client);

  final SupabaseClient _client;

  static const String photoBucket = 'tyre-photos';

  Future<T> _call<T>(Future<T> Function() run) async {
    try {
      return await run().timeout(const Duration(seconds: 25));
    } on SocketException {
      throw const FleetOfflineFailure();
    } on TimeoutException {
      throw const FleetOfflineFailure();
    } on FleetOfflineFailure {
      rethrow;
    } on FormatException {
      rethrow;
    } on Object catch (error) {
      final AppError mapped = mapSupabaseError(error);
      if (mapped.kind == AppErrorKind.network) {
        throw const FleetOfflineFailure();
      }
      throw mapped;
    }
  }

  @override
  Future<FleetTeamPage> drivers({
    required FleetTeamView view,
    String search = '',
    int offset = 0,
    String? category,
    String? region,
  }) =>
      _call(() async {
        final Object? result = await _client.rpc<Object?>(
          'fleet_supervisor_drivers',
          params: <String, Object?>{
            'p_view': view.wire,
            'p_search': search.trim(),
            'p_offset': offset,
            'p_category': category,
            'p_region': region,
          },
        );
        return FleetTeamPage.fromResult(result);
      });

  @override
  Future<FleetFilterOptions> filters() => _call(() async {
        final Object? result =
            await _client.rpc<Object?>('fleet_supervisor_driver_filters');
        return FleetFilterOptions.fromResult(result);
      });

  @override
  Future<List<FleetAssignment>> history(String driverId) => _call(() async {
        final Object? result = await _client.rpc<Object?>(
          'fleet_supervisor_assignment_history',
          params: <String, Object?>{'p_driver_id': driverId},
        );
        return fleetAssignmentsFrom(result);
      });

  @override
  Future<List<FleetVehicleOption>> vehicles({
    required String? country,
    String search = '',
  }) =>
      _call(() async {
        // RLS scopes the read to the caller's org, country and site.
        PostgrestFilterBuilder<List<Map<String, dynamic>>> q = _client
            .from('vehicle_fleet')
            .select('id,asset_no,registration_no,site,vehicle_type,country');
        if (country != null && country.isNotEmpty) q = q.eq('country', country);
        final String term = search.trim().replaceAll(RegExp(r'[%,()]'), ' ');
        if (term.isNotEmpty) {
          q = q.or('asset_no.ilike.%$term%,registration_no.ilike.%$term%');
        }
        final List<Map<String, dynamic>> rows =
            await q.order('asset_no').limit(40);
        return <FleetVehicleOption>[
          for (final Map<String, dynamic> r in rows)
            FleetVehicleOption.fromRow(Map<String, Object?>.from(r)),
        ];
      });

  @override
  Future<FleetCommandOutcome> command(
    String action,
    Map<String, Object?> payload,
    String requestId,
  ) {
    if (!FleetTeamAction.all.contains(action)) {
      throw ArgumentError.value(action, 'action', 'Not a team action');
    }
    return _call(() async {
      final Object? result = await _client.rpc<Object?>(
        'fleet_supervisor_command',
        params: <String, Object?>{
          'p_action': action,
          'p_payload': payload,
          'p_request_id': requestId,
        },
      );
      return FleetCommandOutcome.fromResult(result);
    });
  }

  Future<void> _workspace(
    String action,
    Map<String, Object?> payload,
    String requestId,
  ) =>
      _call(() async {
        await _client.rpc<Object?>(
          'driver_workspace_command',
          params: <String, Object?>{
            'p_action': action,
            'p_payload': payload,
            'p_request_id': requestId,
          },
        );
      });

  @override
  Future<void> issueCharge(Map<String, Object?> payload, String requestId) =>
      _workspace('charge_issue', payload, requestId);

  @override
  Future<void> createFine(Map<String, Object?> payload, String requestId) =>
      _workspace('create_fine', payload, requestId);

  @override
  Future<String> uploadChargePhoto({
    required String localPath,
    required String driverId,
  }) =>
      _call(() async {
        final String ext = _ext(localPath);
        final String path = 'modules/driver-charge/$driverId/'
            '${DateTime.now().microsecondsSinceEpoch}$ext';
        await _client.storage.from(photoBucket).upload(path, File(localPath));
        return 'tp-storage://$photoBucket/$path';
      });

  static String _ext(String path) {
    final int dot = path.lastIndexOf('.');
    final String ext = dot < 0 ? '' : path.substring(dot).toLowerCase();
    return const <String>{'.jpg', '.jpeg', '.png', '.webp'}.contains(ext)
        ? ext
        : '.jpg';
  }
}
