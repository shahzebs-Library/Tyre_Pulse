/// "Due for wash again" - pure, deterministic rule with no I/O.
///
/// Ported field-for-field from `mobile/lib/washSchedule.ts`
/// (`mobile/` is READ-ONLY reference material - see `AGENTS.md` rule "Never
/// edit them from this project"). That file's own library comment explains
/// the design, repeated here rather than paraphrased:
///
/// Vehicles are washed on a rolling interval. Given the wash history, this
/// derives which assets are due again (latest wash + interval has passed) so
/// the washing screen can surface a "Due for wash" list. Pure and
/// deterministic (no I/O, no wall-clock read unless [washDueList]'s `now` is
/// omitted), so it is trivially testable and shares ONE definition of "due"
/// across every surface that needs it.
///
/// # There is deliberately no server cron and no notification scheduling here
///
/// The reference implementation additionally fires a LOCAL device
/// notification from this list (`notifyWashDue`, called by
/// `mobile/app/(app)/washing.tsx`). This port stops at deriving the list.
/// Wiring a local-reminder mechanism on top of it is a separate, deliberate
/// product decision for a later pass, not something folded into this phase -
/// this codebase's own stated policy (`lib/main.dart`'s note on
/// `package_info_plus`) is not to reach for new capability "to shorten five
/// lines", and scheduling a local notification is a materially bigger
/// decision than that. `lib/features/washing/presentation/washing_screen.dart`
/// therefore renders this list as a plain in-app panel only.
///
/// # Pure Dart only - no Flutter, no widgets, no I/O
///
/// This file imports nothing beyond `dart:core`, mirroring the discipline
/// `lib/features/approvals/domain/checklist_approval.dart`'s own library
/// comment states for the same reason: a rule that decides what a field
/// worker sees next must be total and side-effect free, testable with no
/// widget tree and no network.
///
/// # Date arithmetic: UTC day-count rather than the reference's ms-rounding
///
/// The TS source represents "today" and a parsed wash date as
/// midnight-anchored JS `Date` objects in the LOCAL timezone, then divides a
/// millisecond difference by `86400000` and rounds, specifically to guard
/// against a daylight-saving transition making a calendar day 23 or 25 hours
/// long. This port instead re-anchors every parsed calendar date onto UTC
/// midnight (`DateTime.utc(year, month, day)`) before any arithmetic, which
/// has no daylight-saving component at all, so [Duration.inDays] between two
/// such values is always an exact whole number of calendar days with no
/// rounding step needed. Same result for every real input, by a route with
/// one less thing that can go wrong on a device whose clock changes twice a
/// year.
///
/// # Stricter date validation than the reference: a deliberate, disclosed
/// # improvement
///
/// The reference's `parseDate` builds `new Date('2024-02-30T00:00:00')`,
/// which JavaScript silently ROLLS OVER into 2024-03-01 rather than
/// rejecting it - `Number.isNaN(d.getTime())` is false for a rolled-over
/// date, so an invalid calendar date is silently treated as a different,
/// valid one. [_parseIsoDate] here instead round-trips the parsed
/// year/month/day back through [DateTime.utc] and rejects anything that does
/// not come back unchanged, treating an impossible calendar date exactly
/// like an unparseable one (skipped, never guessed at) - consistent with
/// this codebase's standing rule against fabricating a fact from corrupt
/// input. `wash_date` is a genuine Postgres `date` column with no client
/// path that can ever write "30 February", so this only changes behaviour
/// for already-corrupt data, and only by refusing to guess at it.
library;

/// Default wash cadence, in days. One place; referenced by the screen and by
/// every test.
const int kWashIntervalDays = 7;

/// One historical wash, as far as this rule needs to know about it.
///
/// #mirror: `WashHistoryRecord` in `mobile/lib/washSchedule.ts`.
final class WashHistoryRecord {
  const WashHistoryRecord({
    this.assetNo,
    this.washDate,
    this.site,
    this.vehicleType,
  });

  final String? assetNo;

  /// `YYYY-MM-DD`, or a longer ISO string sharing that prefix. Any other
  /// shape is treated as unparseable, never guessed at.
  final String? washDate;

  final String? site;
  final String? vehicleType;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is WashHistoryRecord &&
          other.assetNo == assetNo &&
          other.washDate == washDate &&
          other.site == site &&
          other.vehicleType == vehicleType);

  @override
  int get hashCode => Object.hash(assetNo, washDate, site, vehicleType);

  @override
  String toString() =>
      'WashHistoryRecord(assetNo: $assetNo, washDate: $washDate)';
}

/// One asset that is due (or overdue) for a wash.
///
/// #mirror: `WashDueEntry` in `mobile/lib/washSchedule.ts`.
final class WashDueEntry {
  const WashDueEntry({
    required this.assetNo,
    required this.lastWashDate,
    required this.nextDueDate,
    required this.daysOverdue,
    this.site,
    this.vehicleType,
  });

  final String assetNo;

  /// `YYYY-MM-DD` of the most recent wash this asset has on record.
  final String lastWashDate;

  /// `YYYY-MM-DD` - [lastWashDate] plus the interval that was applied.
  final String nextDueDate;

  /// Whole days past due. `0` means due exactly today, never negative - a
  /// negative value would mean "not yet due", and such an asset is never
  /// included in [washDueList]'s result at all.
  final int daysOverdue;

  final String? site;
  final String? vehicleType;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is WashDueEntry &&
          other.assetNo == assetNo &&
          other.lastWashDate == lastWashDate &&
          other.nextDueDate == nextDueDate &&
          other.daysOverdue == daysOverdue &&
          other.site == site &&
          other.vehicleType == vehicleType);

  @override
  int get hashCode => Object.hash(
    assetNo,
    lastWashDate,
    nextDueDate,
    daysOverdue,
    site,
    vehicleType,
  );

  @override
  String toString() =>
      'WashDueEntry(assetNo: $assetNo, daysOverdue: $daysOverdue)';
}

final RegExp _isoDatePrefixPattern = RegExp(r'^\d{4}-\d{2}-\d{2}$');

/// Parses the first ten characters of [raw] as a calendar date, anchored to
/// UTC midnight so later arithmetic never touches a timezone or daylight
/// -saving rule. Returns `null` for anything that is not a genuine calendar
/// date - see the library comment on why this is stricter than the ported
/// reference.
DateTime? _parseIsoDate(String? raw) {
  if (raw == null) {
    return null;
  }
  final String candidate = raw.length >= 10 ? raw.substring(0, 10) : raw;
  if (!_isoDatePrefixPattern.hasMatch(candidate)) {
    return null;
  }
  final int? year = int.tryParse(candidate.substring(0, 4));
  final int? month = int.tryParse(candidate.substring(5, 7));
  final int? day = int.tryParse(candidate.substring(8, 10));
  if (year == null || month == null || day == null) {
    return null;
  }
  final DateTime parsed = DateTime.utc(year, month, day);
  // DateTime.utc silently rolls an out-of-range day/month over into the
  // following period rather than throwing - round-tripping catches that and
  // treats it as unparseable, never as a guessed-at different date.
  if (parsed.year != year || parsed.month != month || parsed.day != day) {
    return null;
  }
  return parsed;
}

String _formatIsoDate(DateTime utcMidnight) {
  final String y = utcMidnight.year.toString().padLeft(4, '0');
  final String m = utcMidnight.month.toString().padLeft(2, '0');
  final String d = utcMidnight.day.toString().padLeft(2, '0');
  return '$y-$m-$d';
}

/// Re-anchors [now] (a caller's local "today", or the device clock when
/// [now] is `null`) onto UTC midnight for the same calendar day. Dart's local
/// [DateTime.now] already exposes calendar-correct year/month/day fields, so
/// - unlike the ported reference - no timezone-offset correction is needed
/// to read "today" as the user's own calendar day.
DateTime _resolveToday(DateTime? now) {
  final DateTime source = now ?? DateTime.now();
  return DateTime.utc(source.year, source.month, source.day);
}

int _clampInterval(int? intervalDays) {
  if (intervalDays != null && intervalDays > 0) {
    return intervalDays;
  }
  return kWashIntervalDays;
}

/// The date an asset is next due for a wash, given its last wash date.
/// Returns `null` when [lastDate] is not a valid calendar date.
///
/// #mirror: `nextWashDue` in `mobile/lib/washSchedule.ts`.
String? nextWashDue(String? lastDate, {int? intervalDays}) {
  final DateTime? parsed = _parseIsoDate(lastDate);
  if (parsed == null) {
    return null;
  }
  final DateTime due = parsed.add(Duration(days: _clampInterval(intervalDays)));
  return _formatIsoDate(due);
}

/// [washDueList]'s working record of one asset's most recent wash, kept as a
/// private typedef purely so the function body below does not have to repeat
/// this record's shape at every declaration site.
typedef _LatestWash = ({DateTime washedOn, String? site, String? vehicleType});

/// Assets whose most recent wash is at or past its interval as of [now].
///
/// One entry per asset - its LATEST wash wins - most-overdue first, then by
/// asset number. A record with no asset number or an unparseable
/// [WashHistoryRecord.washDate] is skipped honestly rather than guessed at.
///
/// #mirror: `washDueList` in `mobile/lib/washSchedule.ts`.
List<WashDueEntry> washDueList(
  List<WashHistoryRecord>? records, {
  int? intervalDays,
  DateTime? now,
}) {
  final int interval = _clampInterval(intervalDays);
  final DateTime today = _resolveToday(now);

  final Map<String, _LatestWash> latestByAsset = <String, _LatestWash>{};

  for (final WashHistoryRecord record
      in records ?? const <WashHistoryRecord>[]) {
    final String asset = record.assetNo?.trim() ?? '';
    if (asset.isEmpty) {
      continue;
    }
    final DateTime? washedOn = _parseIsoDate(record.washDate);
    if (washedOn == null) {
      continue;
    }
    final _LatestWash? previous = latestByAsset[asset];
    if (previous == null || washedOn.isAfter(previous.washedOn)) {
      latestByAsset[asset] = (
        washedOn: washedOn,
        site: record.site,
        vehicleType: record.vehicleType,
      );
    }
  }

  final List<WashDueEntry> due = <WashDueEntry>[];
  for (final MapEntry<String, _LatestWash> entry in latestByAsset.entries) {
    final DateTime nextDue = entry.value.washedOn.add(Duration(days: interval));
    final int overdue = today.difference(nextDue).inDays;
    if (overdue >= 0) {
      due.add(
        WashDueEntry(
          assetNo: entry.key,
          lastWashDate: _formatIsoDate(entry.value.washedOn),
          nextDueDate: _formatIsoDate(nextDue),
          daysOverdue: overdue,
          site: entry.value.site,
          vehicleType: entry.value.vehicleType,
        ),
      );
    }
  }

  due.sort((WashDueEntry a, WashDueEntry b) {
    final int byOverdue = b.daysOverdue.compareTo(a.daysOverdue);
    if (byOverdue != 0) {
      return byOverdue;
    }
    return a.assetNo.compareTo(b.assetNo);
  });
  return due;
}
