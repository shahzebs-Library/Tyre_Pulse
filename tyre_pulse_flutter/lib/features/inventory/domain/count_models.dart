/// The phone's view of a physical inventory audit.
///
/// # Blind count is the rule
///
/// `inventory_audit_snapshot_lines` hold the expected quantities and serials,
/// and docs/inventory/07 says they are NEVER readable by the counter until the
/// count is submitted. The server enforces that by only answering the counter
/// through `inv_audit_counter_view`. This file is the second line of defence:
/// no model here has an expected-quantity field, and [stripExpectedKeys]
/// removes any expected/system/on-hand key from a server payload before it is
/// parsed, so a server regression cannot leak a number onto the screen.
library;

import 'package:flutter/foundation.dart';

/// Keys a counter must never see (see [isBlindForbiddenKey]).
const List<String> blindForbiddenKeyFragments = <String>[
  'expected',
  'system_qty',
  'qty_on_hand',
  'on_hand',
  'snapshot_qty',
  'book_qty',
  'variance',
  'avg_unit_cost',
  'unit_cost',
  'value',
];

/// True when [key] names a figure a blind counter must not see. Matched on
/// whole underscore-separated words, so `expected_qty` is caught while
/// `unexpected` (the counter's own "found, not listed" flag) is not.
bool isBlindForbiddenKey(String key) {
  final String lower = key.toLowerCase();
  return blindForbiddenKeyFragments.any(
    (String f) =>
        lower == f ||
        lower.startsWith('${f}_') ||
        lower.endsWith('_$f') ||
        lower.contains('_${f}_'),
  );
}

/// Removes every key a blind counter must not see, recursively.
Object? stripExpectedKeys(Object? node) {
  if (node is Map) {
    final Map<String, Object?> out = <String, Object?>{};
    node.forEach((Object? key, Object? value) {
      final String name = '$key';
      final String lower = name.toLowerCase();
      if (isBlindForbiddenKey(lower)) return;
      out[name] = stripExpectedKeys(value);
    });
    return out;
  }
  if (node is List) {
    return <Object?>[for (final Object? item in node) stripExpectedKeys(item)];
  }
  return node;
}

String? _text(Object? value) {
  final String text = value?.toString().trim() ?? '';
  return text.isEmpty ? null : text;
}

DateTime? _date(Object? value) => DateTime.tryParse(_text(value) ?? '');

/// One audit assigned to the signed-in counter.
@immutable
final class InventoryAuditSummary {
  const InventoryAuditSummary({
    required this.id,
    this.reference,
    this.auditType,
    this.status,
    this.site,
    this.dueAt,
    this.instructions,
    this.locationCount,
  });

  factory InventoryAuditSummary.fromJson(Map<String, Object?> json) =>
      InventoryAuditSummary(
        id: _text(json['id']) ?? '',
        reference: _text(json['ref'] ?? json['reference']),
        auditType: _text(json['audit_type'] ?? json['type']),
        status: _text(json['status']),
        site: _text(json['site']),
        dueAt: _date(json['due_at']),
        instructions: _text(json['instructions']),
        locationCount: switch (json['location_count']) {
          final num n => n.toInt(),
          _ => null,
        },
      );

  final String id;
  final String? reference;
  final String? auditType;
  final String? status;
  final String? site;
  final DateTime? dueAt;
  final String? instructions;
  final int? locationCount;

  /// Statuses in which the counter may still record lines
  /// (docs/inventory/07: assigned, in_progress, recount).
  bool get acceptsCounts => const <String>{
        'assigned',
        'in_progress',
        'recount',
      }.contains(status);

  bool isOverdue(DateTime now) =>
      dueAt != null && acceptsCounts && dueAt!.isBefore(now);
}

/// A location in the audit scope.
@immutable
final class AuditLocation {
  const AuditLocation({required this.id, this.code, this.name});

  factory AuditLocation.fromJson(Map<String, Object?> json) => AuditLocation(
        id: _text(json['id'] ?? json['location_id']) ?? '',
        code: _text(json['code']),
        name: _text(json['name'] ?? json['label']),
      );

  final String id;
  final String? code;
  final String? name;

  String get display => code ?? name ?? id;
}

/// An item the counter is asked to count at a location. Carries NO quantity:
/// it says what to look for, never how many there should be.
@immutable
final class AuditItemPrompt {
  const AuditItemPrompt({
    required this.locationId,
    required this.itemId,
    this.itemCode,
    this.description,
    this.uom,
    this.serialTracked = false,
  });

  factory AuditItemPrompt.fromJson(Map<String, Object?> json) =>
      AuditItemPrompt(
        locationId: _text(json['location_id']) ?? '',
        itemId: _text(json['item_id']) ?? '',
        itemCode: _text(json['item_code'] ?? json['code']),
        description: _text(json['description'] ?? json['item_name']),
        uom: _text(json['uom'] ?? json['base_uom']),
        serialTracked: json['serial_tracked'] == true,
      );

  final String locationId;
  final String itemId;
  final String? itemCode;
  final String? description;
  final String? uom;
  final bool serialTracked;
}

/// The counter's view of one audit: scope and prompts, never expectations.
@immutable
final class AuditCounterView {
  const AuditCounterView({
    required this.audit,
    required this.locations,
    required this.prompts,
    this.submittedClientUuids = const <String>{},
  });

  /// Parses `inv_audit_counter_view(p_audit_id)` after [stripExpectedKeys].
  factory AuditCounterView.fromJson(Map<String, Object?> raw) {
    final Map<String, Object?> json =
        stripExpectedKeys(raw)! as Map<String, Object?>;
    List<Map<String, Object?>> rows(Object? value) => <Map<String, Object?>>[
          if (value is List)
            for (final Object? row in value)
              if (row is Map) Map<String, Object?>.from(row),
        ];
    final Object? audit = json['audit'];
    return AuditCounterView(
      audit: InventoryAuditSummary.fromJson(
        audit is Map ? Map<String, Object?>.from(audit) : json,
      ),
      locations: rows(json['locations'])
          .map(AuditLocation.fromJson)
          .where((AuditLocation l) => l.id.isNotEmpty)
          .toList(growable: false),
      prompts: rows(json['items'])
          .map(AuditItemPrompt.fromJson)
          .where((AuditItemPrompt p) => p.itemId.isNotEmpty)
          .toList(growable: false),
      submittedClientUuids: <String>{
        if (json['submitted'] is List)
          for (final Object? id in json['submitted']! as List<Object?>)
            if (_text(id) != null) _text(id)!,
      },
    );
  }

  final InventoryAuditSummary audit;
  final List<AuditLocation> locations;
  final List<AuditItemPrompt> prompts;

  /// Lines the server already holds for this audit (so a reinstalled or
  /// second device does not resubmit them).
  final Set<String> submittedClientUuids;

  AuditLocation? locationById(String id) {
    for (final AuditLocation l in locations) {
      if (l.id == id) return l;
    }
    return null;
  }

  List<AuditItemPrompt> promptsAt(String locationId) => prompts
      .where((AuditItemPrompt p) => p.locationId == locationId)
      .toList(growable: false);
}

/// Physical condition recorded with a count line.
enum CountCondition {
  good('good'),
  damaged('damaged'),
  repairable('repairable'),
  quarantine('quarantine'),
  scrap('scrap');

  const CountCondition(this.wire);
  final String wire;

  static CountCondition fromWire(String? value) =>
      CountCondition.values.firstWhere(
        (CountCondition c) => c.wire == value,
        orElse: () => CountCondition.good,
      );
}

enum CountLineState {
  /// Saved on this device only.
  draft,

  /// Accepted by the server (or found already there on a replay).
  submitted,

  /// The server refused it; [CountLine.rejectReason] says why.
  rejected,
}
