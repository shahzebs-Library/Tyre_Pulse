/// Reports a tyre defect from the Take Action screen - "Repair (Puncture /
/// Damage)". Records ONE offline-queued write against `corrective_actions`,
/// via the ALREADY-VERIFIED [CommandType.reportIssue] command
/// (`lib/core/sync/command_registry.dart`), which this file does nothing
/// beyond building the payload for and enqueuing - the exact same shape
/// `tyre_replacement_repository.dart`'s own library comment describes for
/// [CommandType.tyreChange]: one command, no multi-step transaction, no
/// table this repository invented on its own.
///
/// # `corrective_actions` has no tyre-position column
///
/// [CommandRegistry.specFor]'s `reportIssue` field allow-list carries
/// `asset_no` and `tyre_serial`, but no `tyre_position`/`position` column -
/// unlike [CommandType.tyreChange], which does. Rather than write a column
/// the registry does not allow-list (an invented field this app's own rule
/// against never-verified backend columns forbids), the wheel's position is
/// folded into [SubmitTyreDefectReportInput.title]/`description`, which the
/// caller always composes to name the position explicitly - see
/// `tyre_take_action_screen.dart`'s own build of this input.
library;

import 'package:tyre_pulse/core/database/dao/queue_dao.dart'
    show QueuedMediaAttachment;
import 'package:tyre_pulse/core/sync/command_registry.dart';
import 'package:tyre_pulse/core/sync/queued_command_repository.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:uuid/uuid.dart';

/// `corrective_actions.priority`'s own small, fixed vocabulary. A raw
/// business value written to a database column - never translated, matching
/// `TyreReadingCondition.all`'s own established convention for a sibling
/// column.
abstract final class CorrectiveActionPriority {
  static const String low = 'Low';
  static const String medium = 'Medium';
  static const String high = 'High';
  static const String critical = 'Critical';

  static const List<String> all = <String>[low, medium, high, critical];
}

/// What [TyreDefectReportRepository.submitDefectReport] actually sent.
final class SubmitTyreDefectReportInput {
  const SubmitTyreDefectReportInput({
    required this.title,
    required this.description,
    this.assetNo,
    this.tyreSerial,
    this.site,
    this.priority,
    this.rootCause,
    this.country,
    this.assignedTo,
    this.dueDate,
    this.photoLocalPaths = const <String>[],
  });

  final String title;
  final String description;
  final String? assetNo;
  final String? tyreSerial;
  final String? site;

  /// One of `corrective_actions.priority`'s own values - a fixed business
  /// vocabulary, never translated, matching every other DB-column enum in
  /// this app (`TyreReadingCondition`, tyre replacement's own position
  /// codes). See `tyre_take_action_screen.dart` for the value set offered.
  final String? priority;

  /// The chosen damage reason, already composed into free text by the
  /// caller - see that screen's own doc comment on why a UI-authored reason
  /// list is folded into `root_cause` rather than the tyre condition
  /// vocabulary.
  final String? rootCause;

  final String? country;
  final String? assignedTo;
  final DateTime? dueDate;
  final List<String> photoLocalPaths;
}

/// Records a tyre defect report. Never throws for an ordinary offline
/// condition - see [TyreReplacementRepository]'s own doc comment, which
/// this mirrors exactly.
abstract interface class TyreDefectReportRepository {
  Future<Set<String>> submitDefectReport({
    required WorkspaceContext workspace,
    required SubmitTyreDefectReportInput input,
  });
}

final class DefaultTyreDefectReportRepository
    implements TyreDefectReportRepository {
  DefaultTyreDefectReportRepository(this._commands);

  final QueuedCommandRepository _commands;

  static const Uuid _uuid = Uuid();

  @override
  Future<Set<String>> submitDefectReport({
    required WorkspaceContext workspace,
    required SubmitTyreDefectReportInput input,
  }) async {
    final String title = input.title.trim();
    final List<String> photos = <String>[
      for (final String path in input.photoLocalPaths)
        if (path.trim().isNotEmpty) path.trim(),
    ];

    final EnqueueResult result = await _commands.enqueue(
      type: CommandType.reportIssue,
      payload: <String, Object?>{
        'title': title,
        'description': _trimmedOrNull(input.description),
        'priority': _trimmedOrNull(input.priority),
        'site': _trimmedOrNull(input.site),
        'asset_no': _trimmedOrNull(input.assetNo),
        'tyre_serial': _trimmedOrNull(input.tyreSerial),
        'root_cause': _trimmedOrNull(input.rootCause),
        'status': 'Open',
        'created_by': workspace.userId.trim().isEmpty ? null : workspace.userId,
        'country': input.country,
        'assigned_to': _trimmedOrNull(input.assignedTo),
        'due_date': input.dueDate?.toUtc().toIso8601String(),
        'photos': photos.isEmpty ? null : photos,
      },
      workspace: workspace,
      now: DateTime.now(),
      attachments: <QueuedMediaAttachment>[
        for (int i = 0; i < photos.length; i++)
          QueuedMediaAttachment(
            localPath: photos[i],
            fileName: _basename(photos[i]),
            orderIndex: i,
          ),
      ],
      country: input.country ?? workspace.activeCountry,
      idempotencyKey: 'tyredefect_${_slug(input.assetNo ?? title)}_'
          '${_uuid.v4().substring(0, 8)}',
    );

    return result.droppedFields;
  }

  static String _slug(String value) =>
      value.replaceAll(RegExp(r'[^A-Za-z0-9]+'), '_');

  static String _basename(String path) {
    final int slash = path.lastIndexOf(RegExp(r'[\\/]'));
    return slash < 0 ? path : path.substring(slash + 1);
  }
}

String? _trimmedOrNull(String? raw) {
  final String trimmed = raw?.trim() ?? '';
  return trimmed.isEmpty ? null : trimmed;
}
