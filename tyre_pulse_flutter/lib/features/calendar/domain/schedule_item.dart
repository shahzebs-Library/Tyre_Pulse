library;

import 'package:flutter/foundation.dart';

enum ScheduleKind { inspection, maintenance, task }

enum ScheduleBucket { overdue, today, week, later }

@immutable
final class ScheduleItem {
  const ScheduleItem({
    required this.id,
    required this.kind,
    required this.title,
    required this.date,
    this.subtitle,
    this.sourceId,
    this.priority,
  });

  final String id;
  final ScheduleKind kind;
  final String title;
  final String? subtitle;
  final DateTime date;
  final String? sourceId;
  final String? priority;

  ScheduleBucket bucket(DateTime now) {
    final DateTime today = DateTime(now.year, now.month, now.day);
    final DateTime due = DateTime(date.year, date.month, date.day);
    final int days = due.difference(today).inDays;
    if (days < 0) return ScheduleBucket.overdue;
    if (days == 0) return ScheduleBucket.today;
    if (days <= 7) return ScheduleBucket.week;
    return ScheduleBucket.later;
  }
}
