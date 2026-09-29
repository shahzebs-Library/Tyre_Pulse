/// The single-asset financial report, opened from Vehicle 360.
///
/// # No route of its own
///
/// Like [VehicleDetailScreen], this screen is pushed with a plain
/// [Navigator.push] from the Vehicle 360 costs card: the router files are
/// owned elsewhere and declare no route for it. It therefore applies its own
/// [TpModuleGuard] on the `vehicles` module, the same guard its parent uses.
///
/// # What is shown, and what is deliberately not
///
/// Every figure comes from [AssetFinancialSummary] (see
/// `asset_financials.dart` for the source of each). Left out on purpose,
/// because no table holds them: an annual budget and its variance, a cost
/// per km TARGET and a downtime COST (no downtime rate exists). External
/// repairs ARE read (`work_orders.outside_repair_cost`), but the column is
/// empty on most rows, so the composition usually leaves that slice out
/// rather than drawing 0%. The screen says where its numbers come from.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart' show DateFormat;
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/module_guard.dart';
import 'package:tyre_pulse/app/router/route_access.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/assets/data/asset_insights_repository.dart';
import 'package:tyre_pulse/features/assets/domain/asset_financials.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/asset_insights_providers.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_photo_resolver.dart';
import 'package:tyre_pulse/features/assets/presentation/widgets/asset_cost_widgets.dart';

/// The period choices shared by the report and the Vehicle 360 costs tab.
enum AssetReportPeriod { yearToDate, last12Months, last90Days, last30Days }

extension AssetReportPeriodX on AssetReportPeriod {
  AssetCostPeriod resolve(DateTime now) => switch (this) {
        AssetReportPeriod.yearToDate => AssetCostPeriod.yearToDate(now),
        // Twelve CALENDAR months, starting on the 1st: a day-anchored start
        // spans thirteen months, and the monthly chart would then show fewer
        // months than the total counts.
        AssetReportPeriod.last12Months => AssetCostPeriod(
            from: DateTime(now.year, now.month - 11),
            to: DateTime(now.year, now.month, now.day),
          ),
        AssetReportPeriod.last90Days => AssetCostPeriod.lastDays(now, 90),
        AssetReportPeriod.last30Days => AssetCostPeriod.lastDays(now, 30),
      };

  String label(AppLocalizations l10n) => switch (this) {
        AssetReportPeriod.yearToDate => l10n.fleetMockPeriodYtd,
        AssetReportPeriod.last12Months => l10n.fleetMockPeriod12m,
        AssetReportPeriod.last90Days => l10n.fleetMockPeriod90d,
        AssetReportPeriod.last30Days => l10n.fleetMockPeriod30d,
      };
}

/// The scope the money is read in: the asset's own country first (the same
/// code in another country is another machine), else the active country.
AssetScope assetScopeFor(VehicleAsset asset, String? activeCountry) {
  final String? own = asset.country?.trim();
  final String? active = activeCountry?.trim();
  return (
    assetNo: asset.assetNo!.trim(),
    country: (own != null && own.isNotEmpty)
        ? own
        : (active != null && active.isNotEmpty ? active : null),
  );
}

@visibleForTesting
abstract final class AssetFinancialReportKeys {
  static const Key period = Key('asset_fin.period');
  static const Key kpis = Key('asset_fin.kpis');
  static const Key trend = Key('asset_fin.trend');
  static const Key composition = Key('asset_fin.composition');
  static const Key entries = Key('asset_fin.entries');
  static const Key viewAll = Key('asset_fin.view_all');
  static const Key export = Key('asset_fin.export');
  static const Key exportIcon = Key('asset_fin.export_icon');
  static const Key mixed = Key('asset_fin.mixed');
  static const Key incomplete = Key('asset_fin.incomplete');
  static const Key unlabelled = Key('asset_fin.unlabelled');
}

class AssetFinancialReportScreen extends StatelessWidget {
  const AssetFinancialReportScreen({
    required this.asset,
    this.initialPeriod = AssetReportPeriod.yearToDate,
    this.clock,
    super.key,
  });

  /// Must carry a navigable asset number; the caller checks.
  final VehicleAsset asset;
  final AssetReportPeriod initialPeriod;

  /// Injectable "now" for tests.
  final DateTime Function()? clock;

  @override
  Widget build(BuildContext context) {
    return TpModuleGuard(
      guard: TpRouteGuards.forRouteId(TpRouteId.vehicles),
      backFallback: TpRoutePaths.vehicles,
      child: _ReportBody(
        asset: asset,
        initialPeriod: initialPeriod,
        now: (clock ?? DateTime.now)(),
      ),
    );
  }
}

class _ReportBody extends ConsumerStatefulWidget {
  const _ReportBody({
    required this.asset,
    required this.initialPeriod,
    required this.now,
  });

  final VehicleAsset asset;
  final AssetReportPeriod initialPeriod;
  final DateTime now;

  @override
  ConsumerState<_ReportBody> createState() => _ReportBodyState();
}

class _ReportBodyState extends ConsumerState<_ReportBody> {
  late AssetReportPeriod _period = widget.initialPeriod;
  bool _showAll = false;
  bool _exporting = false;

  AssetFinancialRequest get _request => (
        scope: assetScopeFor(widget.asset, ref.read(activeCountryProvider)),
        period: _period.resolve(widget.now),
      );

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AssetFinancialRequest request = (
      scope: assetScopeFor(widget.asset, ref.watch(activeCountryProvider)),
      period: _period.resolve(widget.now),
    );
    final AsyncValue<AssetFinancialData> data =
        ref.watch(assetFinancialsProvider(request));
    final AssetFinancialData? loaded = data.asData?.value;
    final bool canExport = loaded != null &&
        !loaded.isIncomplete &&
        loaded.summary.currency != null &&
        loaded.summary.hasCost &&
        !_exporting;

    return TpScaffold(
      backgroundColor: TpPalette.of(context).surfaceAlt,
      appBar: TpAppBar(
        title: l10n.fleetMockFinReportTitle,
        onBack: () => Navigator.of(context).maybePop(),
        actions: <Widget>[
          IconButton(
            key: AssetFinancialReportKeys.exportIcon,
            tooltip: l10n.fleetMockFinExport,
            icon: const Icon(Icons.picture_as_pdf_outlined),
            onPressed: canExport ? () => _export(loaded) : null,
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.md,
          TpSpace.lg,
          TpSpace.xxxl,
        ),
        children: <Widget>[
          _AssetHeader(
            asset: widget.asset,
            currency: loaded?.summary.currency,
          ),
          const SizedBox(height: TpSpace.md),
          _PeriodBar(
            period: _period,
            now: widget.now,
            onChanged: (AssetReportPeriod p) => setState(() {
              _period = p;
              _showAll = false;
            }),
          ),
          const SizedBox(height: TpSpace.md),
          ...data.when(
            loading: () => <Widget>[
              const SizedBox(height: 240, child: TpLoadingState()),
            ],
            error: (Object error, StackTrace _) => <Widget>[
              SizedBox(
                height: 320,
                child: TpErrorState(
                  error: error is AppError
                      ? error
                      : AppError(
                          kind: AppErrorKind.unknown,
                          message: l10n.stateErrorMessage,
                          isRetryable: true,
                        ),
                  onRetry: () =>
                      ref.invalidate(assetFinancialsProvider(_request)),
                ),
              ),
            ],
            data: (AssetFinancialData d) => _content(context, l10n, d),
          ),
        ],
      ),
    );
  }

  List<Widget> _content(
    BuildContext context,
    AppLocalizations l10n,
    AssetFinancialData data,
  ) {
    final AssetFinancialSummary s = data.summary;
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    if (data.isIncomplete) {
      // The read stopped at the row cap: the rows are a prefix of the ledger
      // and any total built from them is understated. No totals, no export.
      return <Widget>[
        SizedBox(
          key: AssetFinancialReportKeys.incomplete,
          height: 280,
          child: TpEmptyState(
            icon: Icons.warning_amber_rounded,
            title: l10n.assetsFixFinIncompleteTitle,
            message: l10n.assetsFixFinIncompleteBody(data.truncatedAt!),
          ),
        ),
      ];
    }
    if (s.hasUnlabelledCurrency) {
      return <Widget>[
        SizedBox(
          key: AssetFinancialReportKeys.unlabelled,
          height: 280,
          child: TpEmptyState(
            icon: Icons.currency_exchange_rounded,
            title: l10n.assetsFixFinUnlabelledTitle,
            message: l10n.assetsFixFinUnlabelledBody(s.unlabelledLineCount),
          ),
        ),
      ];
    }
    if (s.isMixed) {
      return <Widget>[
        SizedBox(
          key: AssetFinancialReportKeys.mixed,
          height: 280,
          child: TpEmptyState(
            icon: Icons.currency_exchange_rounded,
            title: l10n.fleetMockFinMixedTitle,
            message: l10n.fleetMockFinMixedBody(s.mixedCurrencies.join(', ')),
          ),
        ),
      ];
    }
    final String? currency = s.currency;
    if (!s.hasCost || currency == null) {
      return <Widget>[
        SizedBox(
          height: 280,
          child: TpEmptyState(
            icon: Icons.receipt_long_outlined,
            title: l10n.fleetMockFinNoCostTitle,
            message: l10n.fleetMockFinNoCostBody,
          ),
        ),
        _SourceNote(labourIncluded: data.labourIncluded),
      ];
    }

    final ({String text, Color color, IconData icon})? totalChange =
        assetChangeNote(context, s.totalChangePct);
    final ({String text, Color color, IconData icon})? maintChange =
        assetChangeNote(context, s.maintenanceChangePct);
    final double? perKm = s.costPerKm;
    final double? perHour = s.costPerHour;
    final List<AssetCostEntry> entries =
        _showAll ? s.entries : s.entries.take(3).toList();
    final String locale = Localizations.localeOf(context).toString();

    return <Widget>[
      TpCard(
        key: AssetFinancialReportKeys.kpis,
        child: LayoutBuilder(
          builder: (BuildContext context, BoxConstraints c) {
            final double w = c.maxWidth >= 520
                ? (c.maxWidth - TpSpace.md * 3) / 4
                : (c.maxWidth - TpSpace.md) / 2;
            return Wrap(
              spacing: TpSpace.md,
              runSpacing: TpSpace.lg,
              children: <Widget>[
                SizedBox(
                  width: w,
                  child: AssetKpiTile(
                    label: l10n.fleetMockFinTotalOperating,
                    value: assetMoneyLabel(currency, s.total),
                    note: totalChange?.text ?? l10n.fleetMockFinNoComparison,
                    noteColor: totalChange?.color,
                    noteIcon: totalChange?.icon,
                  ),
                ),
                SizedBox(
                  width: w,
                  child: AssetKpiTile(
                    label: l10n.fleetMockFinMaintenance,
                    value: assetMoneyLabel(currency, s.maintenance),
                    note: maintChange?.text ?? l10n.fleetMockFinNoComparison,
                    noteColor: maintChange?.color,
                    noteIcon: maintChange?.icon,
                  ),
                ),
                SizedBox(
                  width: w,
                  child: perKm != null || perHour == null
                      ? AssetKpiTile(
                          label: l10n.fleetMockFinCostPerKm,
                          value: perKm == null
                              ? l10n.fleetMockFinNotMeasurable
                              : assetMoneyLabel(currency, perKm, decimals: 2),
                          note: perKm == null
                              ? l10n.fleetMockFinNoKmReadings
                              : '${formatAssetMoney(s.distanceKm!)} km',
                        )
                      : AssetKpiTile(
                          label: l10n.fleetMockFinCostPerHour,
                          value:
                              assetMoneyLabel(currency, perHour, decimals: 2),
                          note: l10n.fleetMockFinHours(
                            formatAssetMoney(s.runningHours!),
                          ),
                        ),
                ),
                SizedBox(
                  width: w,
                  child: AssetKpiTile(
                    label: l10n.fleetMockFinDowntime,
                    value: s.downtimeHours == null
                        ? l10n.fleetMockFinNotRecorded
                        : l10n.fleetMockFinHours(
                            formatAssetMoney(s.downtimeHours!),
                          ),
                  ),
                ),
              ],
            );
          },
        ),
      ),
      if (!data.labourIncluded) ...<Widget>[
        const SizedBox(height: TpSpace.sm),
        Text(
          l10n.fleetMockFinLabourMissing,
          style: text.labelSmall?.copyWith(color: palette.warning.onSoft),
        ),
      ],
      const SizedBox(height: TpSpace.md),
      TpCard(
        key: AssetFinancialReportKeys.trend,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Row(
              children: <Widget>[
                Expanded(
                  child: Text(
                    l10n.fleetMockFinCostTrend,
                    style:
                        text.titleMedium?.copyWith(fontWeight: FontWeight.w800),
                  ),
                ),
                Text(
                  l10n.fleetMockFinMonthlyCost(currency),
                  style:
                      text.labelSmall?.copyWith(color: palette.textSecondary),
                ),
              ],
            ),
            const SizedBox(height: TpSpace.md),
            AssetMonthlyBars(monthly: s.monthly),
          ],
        ),
      ),
      const SizedBox(height: TpSpace.md),
      TpCard(
        key: AssetFinancialReportKeys.composition,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Text(
              l10n.fleetMockFinComposition,
              style: text.titleMedium?.copyWith(fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: TpSpace.md),
            AssetCompositionBar(
              summary: s,
              currency: currency,
              showAmounts: true,
            ),
          ],
        ),
      ),
      const SizedBox(height: TpSpace.md),
      TpCard(
        key: AssetFinancialReportKeys.entries,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Text(
              l10n.fleetMockFinRecentEntries,
              style: text.titleMedium?.copyWith(fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: TpSpace.sm),
            if (s.entries.isEmpty)
              Text(
                l10n.fleetMockFinNotRecorded,
                style: text.bodySmall?.copyWith(color: palette.textMuted),
              ),
            for (final AssetCostEntry e in entries)
              _EntryRow(entry: e, currency: currency, locale: locale),
            if (s.entries.length > 3)
              TextButton(
                key: AssetFinancialReportKeys.viewAll,
                onPressed: () => setState(() => _showAll = !_showAll),
                child: Text(
                  _showAll
                      ? l10n.fleetMockFinShowFewer
                      : l10n.fleetMockFinViewAll(s.entries.length),
                ),
              ),
          ],
        ),
      ),
      const SizedBox(height: TpSpace.md),
      _SourceNote(labourIncluded: data.labourIncluded),
      const SizedBox(height: TpSpace.lg),
      TpButton(
        key: AssetFinancialReportKeys.export,
        label: l10n.fleetMockFinExport,
        icon: Icons.ios_share_rounded,
        isFullWidth: true,
        isBusy: _exporting,
        onPressed: _exporting ? null : () => _export(data),
      ),
    ];
  }

  /// Shares the report on screen as a PDF. English on purpose, the same
  /// reason as the management report: the default PDF font carries no
  /// Arabic-script glyphs and none is bundled.
  Future<void> _export(AssetFinancialData data) async {
    final AssetFinancialSummary s = data.summary;
    final String? currency = s.currency;
    if (currency == null || _exporting) return;
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ScaffoldMessengerState? messenger =
        ScaffoldMessenger.maybeOf(context);
    setState(() => _exporting = true);
    try {
      final AppLocalizations en =
          await AppLocalizations.delegate.load(const Locale('en'));
      final pw.Document doc = buildAssetFinancialPdf(
        asset: widget.asset,
        data: data,
        periodLabel: _period.label(en),
        en: en,
      );
      final String code = widget.asset.assetNo ?? 'asset';
      await Printing.sharePdf(
        bytes: await doc.save(),
        filename: 'financial-report-$code.pdf',
      );
    } on Object {
      messenger?.showSnackBar(
        SnackBar(content: Text(l10n.fleetMockFinExportError)),
      );
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }
}

/// Builds the PDF. Every value is one the screen prints; nothing is added.
pw.Document buildAssetFinancialPdf({
  required VehicleAsset asset,
  required AssetFinancialData data,
  required String periodLabel,
  required AppLocalizations en,
}) {
  final AssetFinancialSummary s = data.summary;
  final String currency = s.currency ?? '';
  String money(double v, {int d = 0}) =>
      assetMoneyLabel(currency, v, decimals: d);
  final DateFormat day = DateFormat('d MMM yyyy', 'en');
  final pw.Document doc = pw.Document();
  doc.addPage(
    pw.MultiPage(
      pageFormat: PdfPageFormat.a4,
      margin: const pw.EdgeInsets.all(32),
      build: (pw.Context _) => <pw.Widget>[
        pw.Text(
          en.fleetMockFinReportTitle,
          style: const pw.TextStyle(
            fontSize: 20,
            fontWeight: pw.FontWeight.bold,
          ),
        ),
        pw.SizedBox(height: 4),
        pw.Text(
          <String?>[
            asset.assetNo,
            asset.make,
            asset.model,
            asset.site,
          ]
              .whereType<String>()
              .where((String v) => v.trim().isNotEmpty)
              .join('  |  '),
        ),
        pw.Text(
          '$periodLabel: ${day.format(s.period.from)} - '
          '${day.format(s.period.to)}',
        ),
        pw.Text(en.fleetMockFinScopeNote(currency)),
        pw.SizedBox(height: 12),
        pw.TableHelper.fromTextArray(
          headers: <String>[
            en.fleetMockFinTotalOperating,
            en.fleetMockFinMaintenance,
            en.fleetMockFinCostPerKm,
            en.fleetMockFinDowntime,
          ],
          data: <List<String>>[
            <String>[
              money(s.total),
              money(s.maintenance),
              s.costPerKm == null
                  ? en.fleetMockFinNotMeasurable
                  : money(s.costPerKm!, d: 2),
              s.downtimeHours == null
                  ? en.fleetMockFinNotRecorded
                  : en.fleetMockFinHours(formatAssetMoney(s.downtimeHours!)),
            ],
          ],
        ),
        pw.SizedBox(height: 12),
        pw.Text(
          en.fleetMockFinComposition,
          style: const pw.TextStyle(fontWeight: pw.FontWeight.bold),
        ),
        pw.TableHelper.fromTextArray(
          data: <List<String>>[
            for (final AssetCostBucket b in AssetCostBucket.values)
              if (s.amountOf(b) > 0)
                <String>[
                  assetBucketLabel(en, b),
                  money(s.amountOf(b)),
                  assetPercent(s.shareOf(b)!),
                ],
          ],
        ),
        pw.SizedBox(height: 12),
        pw.Text(
          en.fleetMockFinCostTrend,
          style: const pw.TextStyle(fontWeight: pw.FontWeight.bold),
        ),
        pw.TableHelper.fromTextArray(
          data: <List<String>>[
            for (final AssetMonthlyCost m in s.monthly)
              <String>[
                DateFormat('MMM yyyy', 'en').format(m.month),
                money(m.total),
              ],
          ],
        ),
        pw.SizedBox(height: 12),
        pw.Text(
          en.fleetMockFinRecentEntries,
          style: const pw.TextStyle(fontWeight: pw.FontWeight.bold),
        ),
        pw.TableHelper.fromTextArray(
          data: <List<String>>[
            for (final AssetCostEntry e in s.entries)
              <String>[
                day.format(e.date),
                e.workOrderNo ?? '-',
                e.description ?? '-',
                money(e.amount),
              ],
          ],
        ),
        pw.SizedBox(height: 8),
        pw.Text(
          en.fleetMockFinSourceNote,
          style: const pw.TextStyle(fontSize: 9),
        ),
        if (!data.labourIncluded)
          pw.Text(
            en.fleetMockFinLabourMissing,
            style: const pw.TextStyle(fontSize: 9),
          ),
      ],
    ),
  );
  return doc;
}

class _AssetHeader extends StatelessWidget {
  const _AssetHeader({required this.asset, required this.currency});

  final VehicleAsset asset;
  final String? currency;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final String? photo = vehiclePhotoAsset(asset);
    final String makeModel = <String?>[asset.make, asset.model]
        .whereType<String>()
        .where((String v) => v.trim().isNotEmpty)
        .join(' ')
        .trim();
    return TpCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            children: <Widget>[
              Container(
                width: 96,
                height: 72,
                decoration: BoxDecoration(
                  color: palette.surfaceAlt,
                  borderRadius: BorderRadius.circular(TpRadius.md),
                  border: Border.all(color: palette.border),
                ),
                clipBehavior: Clip.antiAlias,
                child: photo == null
                    ? Icon(
                        vehicleFallbackIcon(asset),
                        color: palette.primary,
                        size: 36,
                      )
                    : Image.asset(photo, fit: BoxFit.contain),
              ),
              const SizedBox(width: TpSpace.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    TpIdentifierText(
                      asset.assetNo ?? '-',
                      style: text.titleLarge
                          ?.copyWith(fontWeight: FontWeight.w900),
                    ),
                    if (makeModel.isNotEmpty)
                      Text(makeModel, style: text.bodyMedium),
                    if (asset.site?.trim().isNotEmpty == true)
                      Row(
                        children: <Widget>[
                          Icon(
                            Icons.location_on_outlined,
                            size: 14,
                            color: palette.textSecondary,
                          ),
                          const SizedBox(width: 2),
                          Flexible(
                            child: Text(
                              asset.site!.trim(),
                              style: text.labelSmall?.copyWith(
                                color: palette.textSecondary,
                              ),
                            ),
                          ),
                        ],
                      ),
                    if (asset.currentKm != null)
                      Text(
                        '${formatVehicleOdometer(asset.currentKm!)} km',
                        style: text.labelSmall
                            ?.copyWith(color: palette.textSecondary),
                      ),
                  ],
                ),
              ),
              if (currency != null)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: TpSpace.sm,
                    vertical: TpSpace.xs,
                  ),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(TpRadius.md),
                    border: Border.all(color: palette.primary),
                  ),
                  child: Text(
                    currency!,
                    style: text.labelLarge?.copyWith(
                      color: palette.primary,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
            ],
          ),
          if (currency != null) ...<Widget>[
            const SizedBox(height: TpSpace.sm),
            Text(
              l10n.fleetMockFinScopeNote(currency!),
              style: text.labelSmall?.copyWith(color: palette.textSecondary),
            ),
          ],
        ],
      ),
    );
  }
}

class _PeriodBar extends StatelessWidget {
  const _PeriodBar({
    required this.period,
    required this.now,
    required this.onChanged,
  });

  final AssetReportPeriod period;
  final DateTime now;
  final ValueChanged<AssetReportPeriod> onChanged;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AssetCostPeriod resolved = period.resolve(now);
    // Both pills keep one height even when only one label wraps.
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Expanded(
            child: PopupMenuButton<AssetReportPeriod>(
              key: AssetFinancialReportKeys.period,
              onSelected: onChanged,
              itemBuilder: (BuildContext context) =>
                  <PopupMenuEntry<AssetReportPeriod>>[
                for (final AssetReportPeriod p in AssetReportPeriod.values)
                  PopupMenuItem<AssetReportPeriod>(
                    value: p,
                    child: Text(p.label(l10n)),
                  ),
              ],
              child: _Pill(
                icon: Icons.calendar_month_outlined,
                label: period.label(l10n),
                trailing: Icons.keyboard_arrow_down_rounded,
              ),
            ),
          ),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: _Pill(
              icon: Icons.trending_up_rounded,
              label: l10n.fleetMockFinVsYear(
                '${resolved.previousYear.to.year}',
              ),
              muted: true,
            ),
          ),
        ],
      ),
    );
  }
}

class _Pill extends StatelessWidget {
  const _Pill({
    required this.icon,
    required this.label,
    this.trailing,
    this.muted = false,
  });

  final IconData icon;
  final String label;
  final IconData? trailing;
  final bool muted;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    // The two pills share a phone-width row, so the label may take a second
    // line rather than being cut to "This year to ...".
    return Container(
      constraints: const BoxConstraints(minHeight: TpSizing.minTouchTarget),
      padding: const EdgeInsets.symmetric(
        horizontal: TpSpace.sm,
        vertical: TpSpace.xs,
      ),
      decoration: BoxDecoration(
        color: palette.surface,
        border: Border.all(color: palette.controlBorder),
        borderRadius: BorderRadius.circular(TpRadius.md),
      ),
      child: Row(
        children: <Widget>[
          Icon(icon, size: 18, color: palette.text),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Text(
              label,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.labelLarge?.copyWith(
                    color: muted ? palette.textSecondary : palette.text,
                  ),
            ),
          ),
          if (trailing != null) Icon(trailing, color: palette.text),
        ],
      ),
    );
  }
}

class _EntryRow extends StatelessWidget {
  const _EntryRow({
    required this.entry,
    required this.currency,
    required this.locale,
  });

  final AssetCostEntry entry;
  final String currency;
  final String locale;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: TpSpace.sm),
      child: Row(
        children: <Widget>[
          Icon(Icons.event_note_outlined, color: palette.primary, size: 20),
          const SizedBox(width: TpSpace.sm),
          SizedBox(
            width: 56,
            child: Text(
              DateFormat('d MMM', locale).format(entry.date),
              style: text.labelMedium,
            ),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  entry.description ?? l10n.fleetMockFinNotRecorded,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: text.bodyMedium?.copyWith(fontWeight: FontWeight.w700),
                ),
                Text(
                  <String>[
                    if (entry.workOrderNo != null) entry.workOrderNo!,
                    l10n.fleetMockFinLines(entry.lineCount),
                  ].join(' · '),
                  style:
                      text.labelSmall?.copyWith(color: palette.textSecondary),
                ),
              ],
            ),
          ),
          const SizedBox(width: TpSpace.sm),
          Text(
            assetMoneyLabel(currency, entry.amount),
            style: text.labelLarge?.copyWith(fontWeight: FontWeight.w800),
          ),
        ],
      ),
    );
  }
}

class _SourceNote extends StatelessWidget {
  const _SourceNote({required this.labourIncluded});

  final bool labourIncluded;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Icon(Icons.info_outline_rounded, size: 16, color: palette.textMuted),
        const SizedBox(width: TpSpace.xs),
        Expanded(
          child: Text(
            l10n.fleetMockFinSourceNote,
            style: Theme.of(context)
                .textTheme
                .labelSmall
                ?.copyWith(color: palette.textMuted),
          ),
        ),
      ],
    );
  }
}
