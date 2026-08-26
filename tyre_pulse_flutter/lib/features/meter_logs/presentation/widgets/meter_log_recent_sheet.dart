/// The "Recent readings" bottom sheet, opened from [MeterLogScreen]'s app
/// bar. Not a route: this is a supplementary list over the same data the
/// entry form already reads, and `tp_bottom_sheet.dart`'s own library
/// comment states the rule this follows exactly - "promoting an in-page
/// modal to a route changes what Back means on the screen underneath it".
///
/// State handling mirrors `InspectionApprovalReviewScreen`'s own manual
/// `_loading`/`_loadError`/`_item` pattern (a plain `ConsumerStatefulWidget`,
/// not a new global [FutureProvider]) rather than porting the reference's
/// `useState` + `useEffect` - this is a one-shot fetch behind a rarely
/// -opened sheet, and that established pattern already fits it precisely.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/features/meter_logs/data/meter_reading.dart';
import 'package:tyre_pulse/features/meter_logs/meter_logs_providers.dart';

class MeterLogRecentSheet extends ConsumerStatefulWidget {
  const MeterLogRecentSheet({super.key});

  @override
  ConsumerState<MeterLogRecentSheet> createState() =>
      _MeterLogRecentSheetState();
}

class _MeterLogRecentSheetState extends ConsumerState<MeterLogRecentSheet> {
  bool _loading = true;
  AppError? _error;
  List<MeterReading> _readings = const <MeterReading>[];

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final List<MeterReading> readings = await ref
          .read(meterLogRepositoryProvider)
          .listRecentReadings();
      if (!mounted) return;
      setState(() {
        _readings = readings;
        _loading = false;
      });
    } on Object catch (error) {
      if (!mounted) return;
      final AppLocalizations l10n = AppLocalizations.of(context);
      setState(() {
        _error = _asAppError(error, l10n.meterLogRecentLoadErrorMessage);
        _loading = false;
      });
    }
  }

  static AppError _asAppError(Object error, String fallbackMessage) {
    if (error is AppError) return error;
    if (error is SupabaseFailure) return error.error;
    return AppError(
      kind: AppErrorKind.unknown,
      message: fallbackMessage,
      technical: error.toString(),
      cause: error,
      isRetryable: true,
    );
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);

    if (_loading) {
      return const SizedBox(height: 160, child: TpLoadingState());
    }
    if (_error != null) {
      return SizedBox(
        height: 200,
        child: TpErrorState(error: _error!, onRetry: _load),
      );
    }
    if (_readings.isEmpty) {
      return SizedBox(
        height: 160,
        child: TpEmptyState(message: l10n.meterLogRecentEmptyMessage),
      );
    }

    return ConstrainedBox(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.sizeOf(context).height * 0.6,
      ),
      child: ListView.separated(
        shrinkWrap: true,
        padding: const EdgeInsets.symmetric(horizontal: TpSpace.lg),
        itemCount: _readings.length,
        separatorBuilder: (_, __) => const Divider(height: TpSpace.lg),
        itemBuilder: (BuildContext context, int index) =>
            _RecentRow(reading: _readings[index]),
      ),
    );
  }
}

class _RecentRow extends StatelessWidget {
  const _RecentRow({required this.reading});

  final MeterReading reading;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final num? km = reading.odometerKm;

    final List<String> subtitleParts = <String>[
      if (reading.readingDate != null) reading.readingDate!,
      if (reading.site != null) reading.site!,
    ];

    return Row(
      children: <Widget>[
        Icon(Icons.speed_outlined, color: palette.textMuted),
        const SizedBox(width: TpSpace.md),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                reading.assetNo,
                style: Theme.of(context).textTheme.titleSmall,
              ),
              if (subtitleParts.isNotEmpty)
                Text(
                  subtitleParts.join(' · '),
                  style: Theme.of(context).textTheme.bodySmall
                      ?.copyWith(color: palette.textMuted),
                ),
            ],
          ),
        ),
        Text(
          km == null
              ? l10n.valueUnavailable
              : l10n.meterLogRecentKmValue(km.toString()),
          style: Theme.of(context).textTheme.titleSmall,
        ),
      ],
    );
  }
}
