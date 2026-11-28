/// Pure read-side helpers behind the wash screen's vehicle card and the wash
/// history page: the last wash for one asset, the history summary numbers,
/// and the history filters.
///
/// Everything here is computed from the SAME rows `listRecentWashes` already
/// returns - nothing is estimated. A row whose `wash_date` is not a real
/// calendar date is skipped, never guessed at, matching `wash_schedule.dart`.
library;

import 'package:tyre_pulse/features/washing/data/wash_record.dart';
import 'package:tyre_pulse/features/washing/domain/wash_schedule.dart';

/// Parses the first ten characters of [raw] as a calendar date (UTC
/// midnight). Returns null for anything that is not a genuine date.
DateTime? washCalendarDate(String? raw) {
  if (raw == null || raw.length < 10) return null;
  final String s = raw.substring(0, 10);
  if (!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(s)) return null;
  final int y = int.parse(s.substring(0, 4));
  final int m = int.parse(s.substring(5, 7));
  final int d = int.parse(s.substring(8, 10));
  final DateTime parsed = DateTime.utc(y, m, d);
  if (parsed.year != y || parsed.month != m || parsed.day != d) return null;
  return parsed;
}

DateTime _today(DateTime? now) {
  final DateTime source = now ?? DateTime.now();
  return DateTime.utc(source.year, source.month, source.day);
}

String _assetKey(String value) => value.trim().toUpperCase();

/// What the vehicle card says about the picked asset's last wash.
final class AssetWashInfo {
  const AssetWashInfo({
    required this.lastWash,
    required this.daysSince,
    required this.isDue,
    required this.daysOverdue,
  });

  /// Most recent wash on record for the asset.
  final WashRecord lastWash;

  /// Whole days between the last wash and today (0 = washed today).
  final int daysSince;

  /// True once [daysSince] reaches the wash interval ([kWashIntervalDays]).
  final bool isDue;

  /// Days past the due date; 0 when due exactly today or not due.
  final int daysOverdue;
}

/// The latest dated wash for [assetNo] in [history], or null when the asset
/// has no dated wash on record.
AssetWashInfo? assetWashInfo(
  List<WashRecord> history,
  String assetNo, {
  int intervalDays = kWashIntervalDays,
  DateTime? now,
}) {
  final String key = _assetKey(assetNo);
  if (key.isEmpty) return null;
  WashRecord? latest;
  DateTime? latestDate;
  for (final WashRecord wash in history) {
    if (_assetKey(wash.assetNo) != key) continue;
    final DateTime? date = washCalendarDate(wash.washDate);
    if (date == null) continue;
    if (latestDate == null || date.isAfter(latestDate)) {
      latest = wash;
      latestDate = date;
    }
  }
  if (latest == null || latestDate == null) return null;
  final int since = _today(now).difference(latestDate).inDays;
  final int interval = intervalDays > 0 ? intervalDays : kWashIntervalDays;
  final int clampedSince = since < 0 ? 0 : since;
  return AssetWashInfo(
    lastWash: latest,
    daysSince: clampedSince,
    isDue: clampedSince >= interval,
    daysOverdue: clampedSince > interval ? clampedSince - interval : 0,
  );
}

/// The numbers at the top of the wash history page.
final class WashHistoryStats {
  const WashHistoryStats({
    required this.lastSevenDays,
    required this.thisMonth,
    this.topAsset,
    this.topAssetCount = 0,
  });

  /// Washes dated today or within the six days before it.
  final int lastSevenDays;

  /// Washes dated in the current calendar month.
  final int thisMonth;

  /// The asset washed most often this month; null when nothing was washed.
  final String? topAsset;
  final int topAssetCount;
}

WashHistoryStats washHistoryStats(List<WashRecord> history, {DateTime? now}) {
  final DateTime today = _today(now);
  final DateTime weekStart = today.subtract(const Duration(days: 6));
  int week = 0;
  int month = 0;
  final Map<String, int> perAsset = <String, int>{};
  final Map<String, String> display = <String, String>{};
  for (final WashRecord wash in history) {
    final DateTime? date = washCalendarDate(wash.washDate);
    if (date == null || date.isAfter(today)) continue;
    if (!date.isBefore(weekStart)) week++;
    if (date.year == today.year && date.month == today.month) {
      month++;
      final String key = _assetKey(wash.assetNo);
      if (key.isEmpty) continue;
      perAsset[key] = (perAsset[key] ?? 0) + 1;
      display.putIfAbsent(key, () => wash.assetNo.trim());
    }
  }
  String? top;
  int topCount = 0;
  final List<String> keys = perAsset.keys.toList()..sort();
  for (final String key in keys) {
    if (perAsset[key]! > topCount) {
      top = display[key];
      topCount = perAsset[key]!;
    }
  }
  return WashHistoryStats(
    lastSevenDays: week,
    thisMonth: month,
    topAsset: top,
    topAssetCount: topCount,
  );
}

/// History filters. A null field means "no filter".
final class WashHistoryFilter {
  const WashHistoryFilter({
    this.from,
    this.to,
    this.washType,
    this.query = '',
    this.mineOnly = false,
  });

  /// Inclusive calendar-date bounds (time ignored).
  final DateTime? from;
  final DateTime? to;
  final String? washType;
  final String query;
  final bool mineOnly;

  bool get isActive =>
      from != null ||
      to != null ||
      washType != null ||
      query.trim().isNotEmpty ||
      mineOnly;
}

List<WashRecord> filterWashHistory(
  List<WashRecord> history,
  WashHistoryFilter filter, {
  String? userId,
}) {
  final DateTime? from = filter.from == null
      ? null
      : DateTime.utc(filter.from!.year, filter.from!.month, filter.from!.day);
  final DateTime? to = filter.to == null
      ? null
      : DateTime.utc(filter.to!.year, filter.to!.month, filter.to!.day);
  final String query = filter.query.trim().toLowerCase();
  return <WashRecord>[
    for (final WashRecord wash in history)
      if (_matches(wash, filter, from, to, query, userId)) wash,
  ];
}

bool _matches(
  WashRecord wash,
  WashHistoryFilter filter,
  DateTime? from,
  DateTime? to,
  String query,
  String? userId,
) {
  if (filter.mineOnly && wash.createdBy != userId) return false;
  if (filter.washType != null && wash.washType != filter.washType) {
    return false;
  }
  if (from != null || to != null) {
    final DateTime? date = washCalendarDate(wash.washDate);
    if (date == null) return false;
    if (from != null && date.isBefore(from)) return false;
    if (to != null && date.isAfter(to)) return false;
  }
  if (query.isEmpty) return true;
  return <String?>[
    wash.assetNo,
    wash.site,
    wash.entryName,
    wash.entryUsername,
    wash.washedBy,
  ].whereType<String>().join(' ').toLowerCase().contains(query);
}
