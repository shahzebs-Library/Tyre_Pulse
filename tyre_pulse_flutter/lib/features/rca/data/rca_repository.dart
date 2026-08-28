library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/database/dao/queue_dao.dart'
    show QueuedMediaAttachment;
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/core/sync/command_registry.dart';
import 'package:tyre_pulse/core/sync/queued_command_repository.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/features/rca/data/rca_record_dto.dart';
import 'package:tyre_pulse/features/rca/domain/rca_record.dart';
import 'package:uuid/uuid.dart';

final class SubmitRcaInput {
  const SubmitRcaInput({
    required this.rootCause,
    this.assetNo,
    this.tyreSerial,
    this.brand,
    this.site,
    this.kmAtFailure,
    this.contributingFactors = const <String>[],
    this.photoLocalPaths = const <String>[],
  });

  final String rootCause;
  final String? assetNo;
  final String? tyreSerial;
  final String? brand;
  final String? site;
  final num? kmAtFailure;
  final List<String> contributingFactors;
  final List<String> photoLocalPaths;
}

abstract interface class RcaRepository {
  Future<List<RcaRecord>> listRecent({String? country});

  Future<void> submit({
    required WorkspaceContext workspace,
    required SubmitRcaInput input,
  });
}

final class DefaultRcaRepository with SupabaseGateway implements RcaRepository {
  DefaultRcaRepository(this._client, this._commands);

  final SupabaseClient _client;
  final QueuedCommandRepository _commands;
  static const Uuid _uuid = Uuid();

  @override
  Future<List<RcaRecord>> listRecent({String? country}) {
    return guard<List<RcaRecord>>(() async {
      var query = _client.from(SupabaseTables.rcaRecords).select(
            'id,asset_no,tyre_serial,brand,site,failure_date,km_at_failure,'
            'root_cause,contributing_factors,created_at',
          );
      final String scope = country?.trim() ?? '';
      if (scope.isNotEmpty && scope != 'All') {
        query = query.or('country.eq.$scope,country.is.null');
      }
      final List<Map<String, dynamic>> rows =
          await query.order('created_at', ascending: false).limit(300);
      return rows
          .map((Map<String, dynamic> row) => RcaRecordDto(row).toDomain())
          .where((RcaRecord row) => row.id.isNotEmpty)
          .toList(growable: false);
    });
  }

  @override
  Future<void> submit({
    required WorkspaceContext workspace,
    required SubmitRcaInput input,
  }) async {
    final List<String> photos = <String>[
      for (final String path in input.photoLocalPaths)
        if (path.trim().isNotEmpty) path.trim(),
    ];
    final DateTime now = DateTime.now();
    final String date = '${now.year.toString().padLeft(4, '0')}-'
        '${now.month.toString().padLeft(2, '0')}-'
        '${now.day.toString().padLeft(2, '0')}';
    await _commands.enqueue(
      type: CommandType.rca,
      payload: <String, Object?>{
        'asset_no': _text(input.assetNo),
        'tyre_serial': _text(input.tyreSerial),
        'brand': _text(input.brand),
        'site': _text(input.site),
        'failure_date': date,
        'km_at_failure': input.kmAtFailure,
        'root_cause': input.rootCause.trim(),
        'contributing_factors': input.contributingFactors.isEmpty
            ? null
            : input.contributingFactors,
        'photos': photos.isEmpty ? null : photos,
        'country': workspace.activeCountry,
        'created_by': workspace.userId,
      },
      workspace: workspace,
      now: now,
      country: workspace.activeCountry,
      idempotencyKey: 'rca_${_uuid.v4()}',
      attachments: <QueuedMediaAttachment>[
        for (int i = 0; i < photos.length; i++)
          QueuedMediaAttachment(
            localPath: photos[i],
            fileName: _basename(photos[i]),
            orderIndex: i,
          ),
      ],
    );
  }
}

String? _text(String? raw) {
  final String value = raw?.trim() ?? '';
  return value.isEmpty ? null : value;
}

String _basename(String path) {
  final int slash = path.lastIndexOf(RegExp(r'[\\/]'));
  return slash < 0 ? path : path.substring(slash + 1);
}
