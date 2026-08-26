/// The tyre record detail view.
///
/// The production register never issues a second fetch to show this: it
/// reuses the exact row object the list already holds
/// (`mobile/app/(app)/records/index.tsx`, the `detail` state is set
/// straight from the tapped `item`). This does the same - it takes a
/// [TyreRecord] the caller already has, rather than an id it would have to
/// go and look up. `TyreRecordsRepository.fetchById` exists separately for a
/// caller that genuinely needs a fresh read.
///
/// Rendered as a modal bottom sheet through the shared [TpBottomSheet], not
/// as its own route - the production screen renders the same content as a
/// `Modal`, and promoting an in-page detail view to a route would change
/// what Back means on the register underneath it for no benefit, exactly
/// the reasoning `TpBottomSheet`'s own library comment records for a
/// different sheet in this design system.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/app/theme/tp_typography.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/records/domain/models/tyre_record.dart';
import 'package:tyre_pulse/features/records/domain/tyre_risk.dart';

/// Opens [record] in a modal bottom sheet. Returns the same [Future] as
/// [TpBottomSheet.show], so a caller that ever needs to know when the sheet
/// closed is not forced to discard that Future - `unawaited_futures` is an
/// analyser ERROR in this project.
Future<void> showTyreDetailSheet(BuildContext context, TyreRecord record) {
  return TpBottomSheet.show<void>(
    context: context,
    isScrollControlled: true,
    builder: (BuildContext context) => TyreDetailSheet(record: record),
  );
}

class TyreDetailSheet extends ConsumerWidget {
  const TyreDetailSheet({required this.record, super.key});

  final TyreRecord record;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String? currency = ref.watch(activeCurrencyProvider);

    final String? costLine = _costLine(record.costPerTyre, currency);
    final String? position = record.bestPosition;

    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          TpSpace.xl,
          0,
          TpSpace.xl,
          TpSpace.xl,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      TpIdentifierText(
                        record.assetNo ?? l10n.recordsDetailFallbackTitle,
                        style: Theme.of(context).textTheme.headlineSmall,
                      ),
                      if (record.brand != null) ...<Widget>[
                        const SizedBox(height: TpSpace.xs),
                        Text(
                          record.brand!,
                          style: Theme.of(context).textTheme.bodyMedium,
                        ),
                      ],
                    ],
                  ),
                ),
                if (record.riskLevel != null) ...<Widget>[
                  const SizedBox(width: TpSpace.md),
                  TpStatusChip(
                    status: tyreRiskStatus(record.riskLevel),
                    label: record.riskLevel,
                  ),
                ],
              ],
            ),
            if (position != null) ...<Widget>[
              const SizedBox(height: TpSpace.md),
              TpTyreChip(
                data: TpTyreChipData(
                  position: position,
                  serial: record.serialNo,
                  status: tyreRiskStatus(record.riskLevel),
                ),
              ),
            ],
            const SizedBox(height: TpSpace.lg),
            Flexible(
              child: SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    _DetailRow(
                      label: l10n.recordsSerialNo,
                      value: record.serialNo,
                      isIdentifier: true,
                    ),
                    _DetailRow(label: l10n.recordsSite, value: record.site),
                    _DetailRow(
                      label: l10n.recordsIssueDate,
                      value: record.issueDate,
                    ),
                    _DetailRow(
                      label: l10n.recordsCategory,
                      value: record.category,
                    ),
                    _DetailRow(label: l10n.recordsCostPerTyre, value: costLine),
                    _DetailRow(
                      label: l10n.recordsKmFitment,
                      value: _numberOrNull(record.kmAtFitment),
                    ),
                    _DetailRow(
                      label: l10n.recordsKmRemoval,
                      value: _numberOrNull(record.kmAtRemoval),
                    ),
                    _DetailRow(
                      label: l10n.recordsTyreLife,
                      value: _numberOrNull(record.tyreLifeKm),
                      highlight: true,
                    ),
                    _DetailRow(
                      label: l10n.recordsCountry,
                      value: record.country,
                    ),
                    _DetailBlock(
                      label: l10n.recordsDescription,
                      value: record.description,
                    ),
                    _DetailBlock(
                      label: l10n.recordsRemarks,
                      value: record.remarks,
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: TpSpace.md),
            TpButton.secondary(
              label: l10n.actionClose,
              isFullWidth: true,
              onPressed: () => Navigator.of(context).maybePop(),
            ),
          ],
        ),
      ),
    );
  }

  /// `null` when either half is missing - see the library comment on why a
  /// monetary figure is never shown without its currency.
  static String? _costLine(num? amount, String? currency) {
    if (amount == null || currency == null || currency.isEmpty) return null;
    return '$currency ${_formatThousands(amount)}';
  }

  static String? _numberOrNull(num? value) {
    if (value == null) return null;
    return _formatThousands(value);
  }

  static String _formatThousands(num value) {
    final bool isWhole = value == value.roundToDouble();
    final String text =
        isWhole ? value.round().toString() : value.toStringAsFixed(2);
    final bool negative = text.startsWith('-');
    final String digits = negative ? text.substring(1) : text;
    final List<String> parts = digits.split('.');
    final String whole = parts[0];
    final StringBuffer grouped = StringBuffer();
    for (int i = 0; i < whole.length; i++) {
      if (i > 0 && (whole.length - i) % 3 == 0) grouped.write(',');
      grouped.write(whole[i]);
    }
    final String result = parts.length > 1
        ? '${grouped.toString()}.${parts[1]}'
        : grouped.toString();
    return negative ? '-$result' : result;
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({
    required this.label,
    required this.value,
    this.highlight = false,
    this.isIdentifier = false,
  });

  final String label;
  final String? value;
  final bool highlight;
  final bool isIdentifier;

  @override
  Widget build(BuildContext context) {
    final String? shown = value?.trim();
    // A row with nothing to say is not shown at all, rather than showing a
    // label beside an empty value - matching the production `DetailRow`'s
    // own `if (!value ...) return null`.
    if (shown == null || shown.isEmpty) return const SizedBox.shrink();

    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final Color valueColor = highlight ? palette.primaryDark : palette.text;

    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: palette.border)),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: TpSpace.sm),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: <Widget>[
            Expanded(child: Text(label, style: text.bodyMedium)),
            const SizedBox(width: TpSpace.md),
            Flexible(
              child: isIdentifier
                  ? TpIdentifierText(
                      shown,
                      style: TpTypography.identifier(palette)
                          .copyWith(color: valueColor),
                      overflow: TextOverflow.ellipsis,
                    )
                  : Text(
                      shown,
                      textAlign: TextAlign.end,
                      style: text.labelLarge?.copyWith(color: valueColor),
                      overflow: TextOverflow.ellipsis,
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _DetailBlock extends StatelessWidget {
  const _DetailBlock({required this.label, required this.value});

  final String label;
  final String? value;

  @override
  Widget build(BuildContext context) {
    final String? shown = value?.trim();
    if (shown == null || shown.isEmpty) return const SizedBox.shrink();

    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;

    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: palette.border)),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: TpSpace.sm),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(label, style: text.labelMedium),
            const SizedBox(height: TpSpace.xs),
            Text(shown, style: text.bodyLarge),
          ],
        ),
      ),
    );
  }
}
