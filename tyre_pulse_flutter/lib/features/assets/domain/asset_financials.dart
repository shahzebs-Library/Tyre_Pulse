/// Per-asset cost figures for the Vehicle 360 cost snapshot and the
/// single-asset financial report.
///
/// Pure: no Flutter, no Supabase, no `BuildContext`. Everything here is
/// computed from rows the repository already read, so the arithmetic is
/// testable without a network.
///
/// # Where each figure comes from, and nowhere else
///
/// - Parts, lubricants and tyres: `parts_consumption`, the authoritative
///   expense grid. `spare_cost` / `oil_cost` / `tyre_cost` are the
///   classifier's per-line buckets, so every line lands in exactly one of
///   them. `currency` is populated on every row by the server; the money on
///   this screen is labelled with THAT value, never with an assumed one.
/// - Labour: `work_orders.labour_cost`. The expense grid carries no labour,
///   so adding it is not a double count. `work_orders` has no currency column,
///   so labour is only added when the job cards were read inside the SAME
///   country the grid lines belong to (the repository scopes both reads by
///   one country). `parts_cost` / `tyre_cost` on a job card are deliberately
///   NOT read: they would double count the grid.
/// - External repairs: `work_orders.outside_repair_cost` (live column, summed
///   by the applied V279 / V322 report RPCs). Same currency rule as labour.
///   It is empty on most rows today, so the bucket usually carries nothing
///   and the composition bar then leaves it out rather than drawing a 0%
///   slice.
/// - Downtime: `work_orders.breakdown_hours`. Hours only. No labour or
///   downtime rate exists anywhere in the schema, so no downtime COST is
///   derived - inventing a rate would make up money.
/// - Distance and running hours: `odometer_logs` / `engine_hours_logs`
///   readings inside the period. A distance is only claimed when at least two
///   readings exist and the later one is higher. Otherwise cost per km is
///   "not measurable", never a figure divided by a guess.
///
/// # Never blended
///
/// Lines in more than one currency are never added together. The summary
/// reports [AssetFinancialSummary.mixedCurrencies] and the screen refuses to
/// print a total rather than add riyals to dirhams.
library;

import 'package:flutter/foundation.dart' show immutable;

/// The four buckets the cost composition bar shows.
enum AssetCostBucket { spareParts, lubricants, tyres, labour, external }

/// One `parts_consumption` line.
@immutable
class AssetCostLine {
  const AssetCostLine({
    required this.date,
    required this.spare,
    required this.oil,
    required this.tyre,
    this.workOrderNo,
    this.itemDescription,
    this.currency,
  });

  /// Decodes a PostgREST row. Returns null when the row has no usable
  /// `event_date` - a cost with no date cannot be placed in a period or a
  /// month, and silently dating it "today" would move money in time.
  static AssetCostLine? fromRow(Map<String, dynamic> row) {
    final DateTime? date = parseAssetDate(row['event_date']);
    if (date == null) return null;
    return AssetCostLine(
      date: date,
      spare: _num(row['spare_cost']) ?? 0,
      oil: _num(row['oil_cost']) ?? 0,
      tyre: _num(row['tyre_cost']) ?? 0,
      workOrderNo: _str(row['work_order_no']),
      itemDescription: _str(row['item_description']),
      currency: _str(row['currency'])?.toUpperCase(),
    );
  }

  final DateTime date;
  final double spare;
  final double oil;
  final double tyre;
  final String? workOrderNo;
  final String? itemDescription;
  final String? currency;

  double get total => spare + oil + tyre;
}

/// One `work_orders` row, reduced to the cost and downtime facts.
@immutable
class AssetJobCard {
  const AssetJobCard({
    required this.id,
    this.workOrderNo,
    this.openedAt,
    this.completedAt,
    this.labourCost,
    this.outsideRepairCost,
    this.breakdownHours,
    this.workType,
    this.status,
    this.description,
  });

  static AssetJobCard? fromRow(Map<String, dynamic> row) {
    final String? id = _str(row['id']);
    if (id == null) return null;
    return AssetJobCard(
      id: id,
      workOrderNo: _str(row['work_order_no']),
      openedAt: parseAssetDate(row['opened_at']),
      completedAt: parseAssetDate(row['completed_at']),
      labourCost: _num(row['labour_cost']),
      outsideRepairCost: _num(row['outside_repair_cost']),
      breakdownHours: _num(row['breakdown_hours']),
      workType: _str(row['work_type']),
      status: _str(row['status']),
      description: _str(row['description']),
    );
  }

  final String id;
  final String? workOrderNo;
  final DateTime? openedAt;
  final DateTime? completedAt;
  final double? labourCost;

  /// `work_orders.outside_repair_cost`: work sent to an outside workshop.
  final double? outsideRepairCost;
  final double? breakdownHours;
  final String? workType;
  final String? status;
  final String? description;
}

/// One meter reading (odometer km or engine hours).
@immutable
class AssetMeterReading {
  const AssetMeterReading({required this.date, required this.value});

  static AssetMeterReading? fromRow(
    Map<String, dynamic> row,
    String valueColumn,
  ) {
    final DateTime? date = parseAssetDate(row['reading_date']);
    final double? value = _num(row[valueColumn]);
    if (date == null || value == null) return null;
    return AssetMeterReading(date: date, value: value);
  }

  final DateTime date;
  final double value;
}

/// An inclusive calendar-day period.
@immutable
class AssetCostPeriod {
  const AssetCostPeriod({required this.from, required this.to});

  /// 1 January of [now]'s year to [now].
  factory AssetCostPeriod.yearToDate(DateTime now) =>
      AssetCostPeriod(from: DateTime(now.year), to: _day(now));

  /// The last [days] days, ending on [now].
  factory AssetCostPeriod.lastDays(DateTime now, int days) => AssetCostPeriod(
        from: _day(now).subtract(Duration(days: days - 1)),
        to: _day(now),
      );

  final DateTime from;
  final DateTime to;

  /// The same calendar window one year earlier. 29 February folds to the
  /// 28th, the way `DateTime` normalises it.
  AssetCostPeriod get previousYear => AssetCostPeriod(
        from: DateTime(from.year - 1, from.month, from.day),
        to: DateTime(to.year - 1, to.month, to.day),
      );

  bool contains(DateTime value) {
    final DateTime d = _day(value);
    return !d.isBefore(from) && !d.isAfter(to);
  }

  /// `YYYY-MM-DD` for a PostgREST date filter. Built from the local getters,
  /// never `toIso8601String()`, which would shift a UTC day.
  static String isoDay(DateTime value) =>
      '${value.year.toString().padLeft(4, '0')}-'
      '${value.month.toString().padLeft(2, '0')}-'
      '${value.day.toString().padLeft(2, '0')}';

  @override
  bool operator ==(Object other) =>
      other is AssetCostPeriod && other.from == from && other.to == to;

  @override
  int get hashCode => Object.hash(from, to);
}

/// One month's cost total for the trend chart.
@immutable
class AssetMonthlyCost {
  const AssetMonthlyCost({required this.month, required this.total});

  /// The first day of the month.
  final DateTime month;
  final double total;
}

/// One entry in "Recent cost entries": the grid lines of one work order on
/// one day, added together.
@immutable
class AssetCostEntry {
  const AssetCostEntry({
    required this.date,
    required this.amount,
    required this.lineCount,
    this.workOrderNo,
    this.description,
  });

  final DateTime date;
  final double amount;
  final int lineCount;
  final String? workOrderNo;
  final String? description;
}

/// Everything the cost screens print.
@immutable
class AssetFinancialSummary {
  const AssetFinancialSummary({
    required this.period,
    required this.currency,
    required this.mixedCurrencies,
    required this.spare,
    required this.lubricants,
    required this.tyres,
    required this.labour,
    this.external,
    required this.monthly,
    required this.entries,
    required this.lineCount,
    this.unlabelledLineCount = 0,
    this.previousTotal,
    this.previousMaintenance,
    this.distanceKm,
    this.runningHours,
    this.downtimeHours,
  });

  final AssetCostPeriod period;

  /// The single currency every counted line carries. Null when there are no
  /// lines (nothing to label) or when [mixedCurrencies] is true.
  final String? currency;

  /// Lines carried more than one currency. No total is printed then.
  final List<String> mixedCurrencies;

  final double spare;
  final double lubricants;
  final double tyres;

  /// Null when no job card in the period recorded a labour cost - a missing
  /// figure, not a zero.
  final double? labour;

  /// Outside repairs from the job cards. Null when none was recorded - a
  /// missing figure, not a zero.
  final double? external;

  final List<AssetMonthlyCost> monthly;
  final List<AssetCostEntry> entries;
  final int lineCount;

  /// Lines in the period that carry money but no currency. When non-zero no
  /// total is labelled with a currency: the money is real but its unit is
  /// unknown, and assuming the country's currency would mislabel it.
  final int unlabelledLineCount;

  bool get hasUnlabelledCurrency => unlabelledLineCount > 0;

  /// The same window a year earlier. Null when nothing was recorded then, so
  /// the change percentage is not computed against an empty year.
  final double? previousTotal;
  final double? previousMaintenance;

  /// Measured distance inside the period, or null (see the library comment).
  final double? distanceKm;
  final double? runningHours;

  /// Sum of recorded breakdown hours, or null when no card recorded any.
  final double? downtimeHours;

  bool get isMixed => mixedCurrencies.length > 1;

  bool get hasCost => lineCount > 0 || (labour ?? 0) > 0 || (external ?? 0) > 0;

  double get total =>
      spare + lubricants + tyres + (labour ?? 0) + (external ?? 0);

  /// Everything except tyres.
  double get maintenance =>
      spare + lubricants + (labour ?? 0) + (external ?? 0);

  double? get totalChangePct => _change(total, previousTotal);
  double? get maintenanceChangePct => _change(maintenance, previousMaintenance);

  double? get costPerKm {
    final double? km = distanceKm;
    if (km == null || km <= 0 || !hasCost) return null;
    return total / km;
  }

  double? get costPerHour {
    final double? h = runningHours;
    if (h == null || h <= 0 || !hasCost) return null;
    return total / h;
  }

  double amountOf(AssetCostBucket bucket) => switch (bucket) {
        AssetCostBucket.spareParts => spare,
        AssetCostBucket.lubricants => lubricants,
        AssetCostBucket.tyres => tyres,
        AssetCostBucket.labour => labour ?? 0,
        AssetCostBucket.external => external ?? 0,
      };

  /// Share of [bucket] in [total], 0..1. Null when there is no total.
  double? shareOf(AssetCostBucket bucket) {
    final double t = total;
    if (t <= 0) return null;
    return amountOf(bucket) / t;
  }

  static double? _change(double current, double? previous) {
    if (previous == null || previous <= 0) return null;
    return (current - previous) / previous * 100;
  }
}

/// Builds the summary. [lines]/[jobCards]/meters may span more than
/// [period]; anything outside it is ignored, so the caller can pass one read
/// that also covers the comparison year.
AssetFinancialSummary computeAssetFinancials({
  required AssetCostPeriod period,
  required List<AssetCostLine> lines,
  List<AssetJobCard> jobCards = const <AssetJobCard>[],
  List<AssetMeterReading> odometer = const <AssetMeterReading>[],
  List<AssetMeterReading> engineHours = const <AssetMeterReading>[],
}) {
  final AssetCostPeriod previous = period.previousYear;
  final List<AssetCostLine> current =
      lines.where((AssetCostLine l) => period.contains(l.date)).toList();
  final List<AssetCostLine> prior =
      lines.where((AssetCostLine l) => previous.contains(l.date)).toList();

  final List<String> currencies = <String>{
    for (final AssetCostLine l in current)
      if (l.currency != null) l.currency!,
  }.toList()
    ..sort();

  // A line with money but no currency cannot be labelled SAR/AED/EGP by
  // assumption. Counted separately; the summary then carries no currency.
  final int unlabelled = current
      .where((AssetCostLine l) => l.currency == null && l.total != 0)
      .length;

  double spare = 0, oil = 0, tyre = 0;
  for (final AssetCostLine l in current) {
    spare += l.spare;
    oil += l.oil;
    tyre += l.tyre;
  }

  final List<AssetJobCard> currentCards = jobCards
      .where((AssetJobCard c) => _cardDate(c) != null)
      .where((AssetJobCard c) => period.contains(_cardDate(c)!))
      .toList();
  final List<AssetJobCard> priorCards = jobCards
      .where((AssetJobCard c) => _cardDate(c) != null)
      .where((AssetJobCard c) => previous.contains(_cardDate(c)!))
      .toList();
  final double? labour = _sumPositive(
    currentCards.map((AssetJobCard c) => c.labourCost),
  );
  final double? priorLabour = _sumPositive(
    priorCards.map((AssetJobCard c) => c.labourCost),
  );
  final double? external = _sumPositive(
    currentCards.map((AssetJobCard c) => c.outsideRepairCost),
  );
  final double? priorExternal = _sumPositive(
    priorCards.map((AssetJobCard c) => c.outsideRepairCost),
  );
  final double? downtime = _sumPositive(
    currentCards.map((AssetJobCard c) => c.breakdownHours),
  );

  double priorSpare = 0, priorOil = 0, priorTyre = 0;
  for (final AssetCostLine l in prior) {
    priorSpare += l.spare;
    priorOil += l.oil;
    priorTyre += l.tyre;
  }
  final bool hasPrior =
      prior.isNotEmpty || (priorLabour ?? 0) > 0 || (priorExternal ?? 0) > 0;
  final double priorMaintenance =
      priorSpare + priorOil + (priorLabour ?? 0) + (priorExternal ?? 0);

  // Monthly trend: contiguous months from the period start to its end, zero
  // for a month with no line (a genuine "nothing issued" month inside a
  // period that has data).
  final Map<String, double> byMonth = <String, double>{};
  for (final AssetCostLine l in current) {
    byMonth.update(
      _monthKey(l.date),
      (double v) => v + l.total,
      ifAbsent: () => l.total,
    );
  }
  for (final AssetJobCard c in currentCards) {
    // Only positive figures, matching `_sumPositive` for the totals, so the
    // chart can never disagree with the tiles beside it.
    final double labourPart = (c.labourCost ?? 0) > 0 ? c.labourCost! : 0;
    final double externalPart =
        (c.outsideRepairCost ?? 0) > 0 ? c.outsideRepairCost! : 0;
    final double v = labourPart + externalPart;
    if (v <= 0) continue;
    byMonth.update(
      _monthKey(_cardDate(c)!),
      (double x) => x + v,
      ifAbsent: () => v,
    );
  }
  final List<AssetMonthlyCost> monthly = <AssetMonthlyCost>[];
  DateTime cursor = DateTime(period.from.year, period.from.month);
  final DateTime last = DateTime(period.to.year, period.to.month);
  while (!cursor.isAfter(last)) {
    monthly.add(
      AssetMonthlyCost(month: cursor, total: byMonth[_monthKey(cursor)] ?? 0),
    );
    cursor = DateTime(cursor.year, cursor.month + 1);
  }

  // Entries: grid lines grouped by (day, work order).
  final Map<String, List<AssetCostLine>> grouped =
      <String, List<AssetCostLine>>{};
  for (final AssetCostLine l in current) {
    final String key =
        '${AssetCostPeriod.isoDay(l.date)}|${l.workOrderNo ?? ''}';
    grouped.putIfAbsent(key, () => <AssetCostLine>[]).add(l);
  }
  final List<AssetCostEntry> entries = grouped.values.map((
    List<AssetCostLine> group,
  ) {
    group
        .sort((AssetCostLine a, AssetCostLine b) => b.total.compareTo(a.total));
    return AssetCostEntry(
      date: group.first.date,
      amount: group.fold(0, (double s, AssetCostLine l) => s + l.total),
      lineCount: group.length,
      workOrderNo: group.first.workOrderNo,
      description: group.first.itemDescription,
    );
  }).toList()
    ..sort((AssetCostEntry a, AssetCostEntry b) => b.date.compareTo(a.date));

  return AssetFinancialSummary(
    period: period,
    currency:
        currencies.length == 1 && unlabelled == 0 ? currencies.single : null,
    mixedCurrencies: currencies,
    unlabelledLineCount: unlabelled,
    spare: spare,
    lubricants: oil,
    tyres: tyre,
    labour: labour,
    external: external,
    monthly: monthly,
    entries: entries,
    lineCount: current.length,
    previousTotal: hasPrior ? priorMaintenance + priorTyre : null,
    previousMaintenance: hasPrior ? priorMaintenance : null,
    distanceKm: meterDelta(odometer, period),
    runningHours: meterDelta(engineHours, period),
    downtimeHours: downtime,
  );
}

/// Highest minus lowest reading inside [period], or null unless at least two
/// readings exist and the difference is positive. A meter reset or a single
/// reading is not a distance.
double? meterDelta(List<AssetMeterReading> readings, AssetCostPeriod period) {
  final List<AssetMeterReading> inside = readings
      .where((AssetMeterReading r) => period.contains(r.date))
      .toList()
    ..sort(
      (AssetMeterReading a, AssetMeterReading b) => a.date.compareTo(b.date),
    );
  if (inside.length < 2) return null;
  final double delta = inside.last.value - inside.first.value;
  return delta > 0 ? delta : null;
}

/// Money with thousands separators, no decimals: `42680.4` -> `42,680`.
String formatAssetMoney(double value, {int decimals = 0}) {
  final bool negative = value < 0;
  final String fixed = value.abs().toStringAsFixed(decimals);
  final List<String> parts = fixed.split('.');
  final String digits = parts.first;
  final StringBuffer out = StringBuffer();
  for (int i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) out.write(',');
    out.write(digits[i]);
  }
  if (parts.length > 1) out.write('.${parts[1]}');
  return negative ? '-$out' : out.toString();
}

/// `12345` -> `12.3K`, for chart bar labels.
String formatAssetCompact(double value) {
  final double a = value.abs();
  if (a >= 1000000) return '${(value / 1000000).toStringAsFixed(1)}M';
  if (a >= 1000) return '${(value / 1000).toStringAsFixed(1)}K';
  return value.toStringAsFixed(0);
}

/// Parses a PostgREST `date` or `timestamptz` value. Date-only strings are
/// read as a LOCAL calendar day so they never shift across midnight.
DateTime? parseAssetDate(Object? raw) {
  if (raw is! String || raw.trim().isEmpty) return null;
  final String s = raw.trim();
  final RegExpMatch? m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(s);
  if (m != null) {
    return DateTime(
      int.parse(m.group(1)!),
      int.parse(m.group(2)!),
      int.parse(m.group(3)!),
    );
  }
  return DateTime.tryParse(s)?.toLocal();
}

DateTime? _cardDate(AssetJobCard c) => c.openedAt ?? c.completedAt;

double? _sumPositive(Iterable<double?> values) {
  double sum = 0;
  bool any = false;
  for (final double? v in values) {
    if (v != null && v > 0) {
      sum += v;
      any = true;
    }
  }
  return any ? sum : null;
}

String _monthKey(DateTime d) => '${d.year}-${d.month}';

DateTime _day(DateTime d) => DateTime(d.year, d.month, d.day);

double? _num(Object? raw) {
  if (raw is num) return raw.toDouble();
  if (raw is String) return double.tryParse(raw.trim());
  return null;
}

String? _str(Object? raw) {
  if (raw is! String) return raw?.toString();
  final String t = raw.trim();
  return t.isEmpty ? null : t;
}
