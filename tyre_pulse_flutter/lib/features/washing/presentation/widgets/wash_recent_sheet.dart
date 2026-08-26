/// The "Recent washes" bottom sheet, opened from [WashingScreen]'s app bar.
///
/// Mirrors `features/meter_logs/presentation/widgets/meter_log_recent_sheet
/// .dart` exactly in shape - see that file's own library comment for why a
/// plain manual-state `ConsumerStatefulWidget` (not a new global
/// [FutureProvider]) is the right fit for a one-shot fetch behind a rarely
/// -opened sheet.
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
import 'package:tyre_pulse/features/washing/data/wash_record.dart';
import 'package:tyre_pulse/features/washing/washing_providers.dart';

class WashRecentSheet extends ConsumerStatefulWidget {
  const WashRecentSheet({super.key});

  @override
  ConsumerState<WashRecentSheet> createState() => _WashRecentSheetState();
}

class _WashRecentSheetState extends ConsumerState<WashRecentSheet> {
  bool _loading = true;
  AppError? _error;
  List<WashRecord> _washes = const <WashRecord>[];

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
      final List<WashRecord> washes =
          await ref.read(washRepositoryProvider).listRecentWashes();
      if (!mounted) return;
      setState(() {
        _washes = washes;
        _loading = false;
      });
    } on Object catch (error) {
      if (!mounted) return;
      final AppLocalizations l10n = AppLocalizations.of(context);
      setState(() {
        _error = _asAppError(error, l10n.washRecentLoadErrorMessage);
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
    if (_washes.isEmpty) {
      return SizedBox(
        height: 160,
        child: TpEmptyState(message: l10n.washRecentEmptyMessage),
      );
    }

    return ConstrainedBox(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.sizeOf(context).height * 0.6,
      ),
      child: ListView.separated(
        shrinkWrap: true,
        padding: const EdgeInsets.symmetric(horizontal: TpSpace.lg),
        itemCount: _washes.length,
        separatorBuilder: (_, __) => const Divider(height: TpSpace.lg),
        itemBuilder: (BuildContext context, int index) =>
            _RecentWashRow(wash: _washes[index]),
      ),
    );
  }
}

class _RecentWashRow extends StatelessWidget {
  const _RecentWashRow({required this.wash});

  final WashRecord wash;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final List<String> subtitleParts = <String>[
      if (wash.washDate != null) wash.washDate!,
      if (wash.washTime != null) wash.washTime!,
      if (wash.site != null) wash.site!,
    ];

    return Row(
      children: <Widget>[
        Icon(Icons.local_car_wash_outlined, color: palette.textMuted),
        const SizedBox(width: TpSpace.md),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(wash.assetNo, style: Theme.of(context).textTheme.titleSmall),
              if (subtitleParts.isNotEmpty)
                Text(
                  subtitleParts.join(' · '),
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(color: palette.textMuted),
                ),
            ],
          ),
        ),
        if (wash.washType != null)
          TpStatusChip(
            status: TpStatus.neutral,
            label: wash.washType!,
            isCompact: true,
          ),
      ],
    );
  }
}
