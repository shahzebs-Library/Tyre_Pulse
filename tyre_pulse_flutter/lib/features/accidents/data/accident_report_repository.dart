library;

import 'dart:convert';

import 'package:tyre_pulse/core/database/dao/queue_dao.dart'
    show QueuedMediaAttachment;
import 'package:tyre_pulse/core/sync/command_registry.dart';
import 'package:tyre_pulse/core/sync/queued_command_repository.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_damage_map.dart';
import 'package:uuid/uuid.dart';

final class SubmitAccidentReportInput {
  const SubmitAccidentReportInput({
    required this.assetNo,
    required this.site,
    required this.description,
    required this.severity,
    required this.accidentType,
    required this.photoLocalPaths,
    required this.damageMap,
    this.vehicleId,
    this.vehicleType,
    this.location,
    this.notes,
  });

  final String assetNo;
  final String site;
  final String description;
  final String severity;
  final String accidentType;
  final List<String> photoLocalPaths;
  final AccidentDamageMap damageMap;
  final String? vehicleId;
  final String? vehicleType;
  final String? location;
  final String? notes;
}

abstract interface class AccidentReportRepository {
  Future<Set<String>> submit({
    required WorkspaceContext workspace,
    required SubmitAccidentReportInput input,
  });
}

/// Offline-first accident capture. The report and its durable evidence paths
/// enter the same queue transaction, so a process death cannot leave a report
/// without the media rows that belong to it.
final class OfflineAccidentReportRepository
    implements AccidentReportRepository {
  const OfflineAccidentReportRepository(this._commands);

  final QueuedCommandRepository _commands;
  static const Uuid _uuid = Uuid();

  @override
  Future<Set<String>> submit({
    required WorkspaceContext workspace,
    required SubmitAccidentReportInput input,
  }) async {
    final DateTime now = DateTime.now();
    final List<String> photos = <String>[
      for (final String path in input.photoLocalPaths)
        if (path.trim().isNotEmpty) path.trim(),
    ];
    final EnqueueResult result = await _commands.enqueue(
      type: CommandType.reportAccident,
      payload: <String, Object?>{
        'site': input.site.trim(),
        'asset_no': input.assetNo.trim(),
        'vehicle_id': _text(input.vehicleId),
        'reported_by': workspace.userId,
        'reporter_name': _text(workspace.fullName),
        'incident_date': _date(now),
        'incident_time': _time(now),
        'location': _text(input.location),
        'accident_type': input.accidentType.trim(),
        'severity': input.severity.trim(),
        'description': input.description.trim(),
        'damage_description': input.damageMap.isEmpty
            ? null
            : jsonEncode(<String, Object?>{
                'version': 1,
                'marks': <Map<String, Object?>>[
                  for (final AccidentDamageMark mark in input.damageMap.marks)
                    <String, Object?>{
                      'zone_id': mark.zoneId,
                      if (mark.view != null) 'view': mark.view!.name,
                      if (mark.normalizedX != null) 'x': mark.normalizedX,
                      if (mark.normalizedY != null) 'y': mark.normalizedY,
                      if (_text(mark.areaLabel) != null)
                        'area': mark.areaLabel!.trim(),
                      'severity': mark.severity.name,
                      if (_text(mark.note) != null) 'note': mark.note!.trim(),
                    },
                ],
              }),
        'photos': photos.isEmpty ? null : photos,
        'notes': _text(input.notes),
        'status': 'reported',
        'country': workspace.activeCountry,
        'vehicle_type': _text(input.vehicleType),
      },
      workspace: workspace,
      now: now,
      country: workspace.activeCountry,
      idempotencyKey: 'accident_${_uuid.v4()}',
      attachments: <QueuedMediaAttachment>[
        for (int i = 0; i < photos.length; i++)
          QueuedMediaAttachment(
            localPath: photos[i],
            fileName: _basename(photos[i]),
            orderIndex: i,
            bucket: 'accident-photos',
          ),
      ],
    );
    return result.droppedFields;
  }
}

String? _text(String? raw) {
  final String value = raw?.trim() ?? '';
  return value.isEmpty ? null : value;
}

String _date(DateTime value) => '${value.year.toString().padLeft(4, '0')}-'
    '${value.month.toString().padLeft(2, '0')}-'
    '${value.day.toString().padLeft(2, '0')}';

String _time(DateTime value) => '${value.hour.toString().padLeft(2, '0')}:'
    '${value.minute.toString().padLeft(2, '0')}';

String _basename(String path) {
  final int slash = path.lastIndexOf(RegExp(r'[\\/]'));
  return slash < 0 ? path : path.substring(slash + 1);
}
