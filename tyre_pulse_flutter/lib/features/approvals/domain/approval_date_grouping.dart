/// Pure date-grouping for an approvals queue - Today / Yesterday / a plain
/// date, matching the approved mock's grouped list.
///
/// Deliberately dependency-free (no `BuildContext`, no clock read): [now]
/// and every label are supplied by the caller, so the rule is testable with
/// a fixed instant and asserted directly, exactly as
/// `lib/features/home/home_layout.dart` keeps its own filtering pure.
library;

import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/features/approvals/data/inspection_approval_item.dart';

/// One dated section of a grouped approvals list.
///
/// Grouping is presentation only - it never changes which items are shown,
/// only how they are labelled and split. [items] keep the order they arrived
/// in.
@immutable
class ApprovalDateGroup {
  const ApprovalDateGroup({required this.label, required this.items});

  final String label;
  final List<InspectionApprovalItem> items;
}

/// Splits [items] - already ordered newest-first by the repository query -
/// into contiguous date-labelled sections.
///
/// An item whose `createdAt` cannot be parsed is grouped under
/// [unknownLabel] rather than being guessed into "today" or dropped, and
/// keeps its original relative position among the other undated items.
List<ApprovalDateGroup> groupApprovalsByDate(
  List<InspectionApprovalItem> items, {
  required DateTime now,
  required String todayLabel,
  required String yesterdayLabel,
  required String unknownLabel,
}) {
  final DateTime today = DateTime(now.year, now.month, now.day);
  final DateTime yesterday = today.subtract(const Duration(days: 1));

  final List<ApprovalDateGroup> groups = <ApprovalDateGroup>[];
  String? currentLabel;
  List<InspectionApprovalItem> currentItems = <InspectionApprovalItem>[];

  void flush() {
    if (currentLabel == null || currentItems.isEmpty) return;
    groups.add(
      ApprovalDateGroup(
        label: currentLabel,
        items: List<InspectionApprovalItem>.unmodifiable(currentItems),
      ),
    );
  }

  for (final InspectionApprovalItem item in items) {
    final String label = _labelFor(
      item.createdAt,
      today: today,
      yesterday: yesterday,
      todayLabel: todayLabel,
      yesterdayLabel: yesterdayLabel,
      unknownLabel: unknownLabel,
    );
    if (label != currentLabel) {
      flush();
      currentLabel = label;
      currentItems = <InspectionApprovalItem>[];
    }
    currentItems.add(item);
  }
  flush();

  return List<ApprovalDateGroup>.unmodifiable(groups);
}

String _labelFor(
  String? iso, {
  required DateTime today,
  required DateTime yesterday,
  required String todayLabel,
  required String yesterdayLabel,
  required String unknownLabel,
}) {
  if (iso == null || iso.isEmpty) return unknownLabel;
  final DateTime? parsed = DateTime.tryParse(iso);
  if (parsed == null) return unknownLabel;
  final DateTime local = parsed.toLocal();
  final DateTime day = DateTime(local.year, local.month, local.day);
  if (day == today) return todayLabel;
  if (day == yesterday) return yesterdayLabel;
  final String y = local.year.toString().padLeft(4, '0');
  final String m = local.month.toString().padLeft(2, '0');
  final String d = local.day.toString().padLeft(2, '0');
  return '$y-$m-$d';
}
