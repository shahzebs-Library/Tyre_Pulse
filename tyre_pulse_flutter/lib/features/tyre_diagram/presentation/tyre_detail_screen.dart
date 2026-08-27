/// The Tyre Detail screen - everything recorded for ONE wheel, and the way
/// into Take Action.
///
/// Pushed with a plain [Navigator.push]/[MaterialPageRoute], never a named
/// `go_router` route: this screen has no independent deep-link identity of
/// its own (it only ever makes sense in the context of the diagram it was
/// opened from - the wizard's Tyres step, an inspection detail, an approval
/// review), the same reasoning `tyre_detail_sheet.dart`'s own library
/// comment gives for staying off the route table entirely (there it is a
/// bottom sheet; here the reference design calls for a full screen, but the
/// "no independent identity" reasoning is the same). AGENTS.md's seven
/// untouchable router files are exactly why this stays an imperative push -
/// adding a named route for it would mean editing `routes.dart`/
/// `app_router.dart`.
///
/// Reads ONLY the entry-map shape [wheelConditionFor]/[wheelStatusFor]
/// already establish as this feature's shared, cross-top-level-feature
/// vocabulary - see `tyre_diagram_stats.dart`'s own library comment. Brand,
/// pattern, size, installed/running distance and temperature are NOT
/// tracked anywhere in this app's inspection domain (verified against
/// `features/inspections/domain/tyre_position_reading.dart`'s own field
/// list and `tyre_condition.dart`) - every one of those rows renders the
/// design system's own honest "not recorded" state rather than a fabricated
/// value (AGENTS.md rule 1; spec section 32).
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/app/theme/tp_typography.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_condition.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_condition_labels.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_take_action_screen.dart';

/// Pushes [TyreDetailScreen] and returns its result future, matching every
/// other imperative-navigation helper in this design system
/// ([showTyreDetailSheet], `TpDialog.confirm`) - `unawaited_futures` is an
/// analyser error in this project, so a caller is never tempted to fire and
/// forget it.
Future<void> pushTyreDetailScreen(
  BuildContext context, {
  required String positionCode,
  required String vehicleType,
  Map<String, Object?>? entry,
  String? assetNo,
  String? siteName,
  VoidCallback? onAdjustReading,
}) {
  return Navigator.of(context).push<void>(
    MaterialPageRoute<void>(
      builder: (BuildContext context) => TyreDetailScreen(
        positionCode: positionCode,
        vehicleType: vehicleType,
        entry: entry,
        assetNo: assetNo,
        siteName: siteName,
        onAdjustReading: onAdjustReading,
      ),
    ),
  );
}

class TyreDetailScreen extends StatelessWidget {
  const TyreDetailScreen({
    required this.positionCode,
    required this.vehicleType,
    this.entry,
    this.assetNo,
    this.siteName,
    this.onAdjustReading,
    super.key,
  });

  /// The position id/code exactly as the caller's diagram already keys it -
  /// never relabelled here, so a fitter reading this screen sees the same
  /// identifier the diagram and the inspection record use.
  final String positionCode;

  final String vehicleType;

  /// The raw recorded entry for this position, or `null` when nothing was
  /// ever recorded.
  final Map<String, Object?>? entry;

  final String? assetNo;
  final String? siteName;

  /// Non-null only when this screen was opened from a LIVE, editable
  /// inspection (the wizard's Tyres step) - see
  /// `new_inspection_screen.dart`'s own wiring. Forwarded to Take Action as
  /// the one thing that makes "Adjust reading" a real action rather than a
  /// disabled one.
  final VoidCallback? onAdjustReading;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TpStatus status = wheelStatusFor(entry);
    final TyreCondition? condition = wheelConditionFor(entry);
    final String? notes = _stringOrNull(entry?['notes']);
    final String? serial = _stringOrNull(
      entry?['serial_number'] ?? entry?['serial_no'] ?? entry?['serial'],
    );
    final String? photoUrl = _stringOrNull(entry?['photo_url']);
    final String? photoLocalPath = _stringOrNull(entry?['photo_uri']);

    return TpScaffold(
      appBar: TpAppBar(
        title: l10n.tyreDetailTitle,
        subtitle: <String?>[assetNo, siteName]
            .where((String? v) => v != null && v.trim().isNotEmpty)
            .join(' - '),
        // Explicit pop, not `TpBack`: this screen has no `go_router` route
        // identity of its own (see the library comment), so it is popped
        // off the plain `Navigator` it was pushed onto directly rather than
        // through the router-aware default.
        onBack: () => Navigator.of(context).pop(),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.xxl,
        ),
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: TpIdentifierText(
                  positionCode,
                  style: TpTypography.identifier(
                    palette,
                  ).copyWith(fontSize: 26, color: palette.text),
                ),
              ),
              TpStatusChip(
                status: status,
                label: condition == null
                    ? null
                    : tyreConditionLabel(l10n, condition),
              ),
            ],
          ),
          const SizedBox(height: TpSpace.lg),
          Row(
            children: <Widget>[
              Expanded(
                child: _statCard(
                  entry,
                  const <String>['tread_depth_mm', 'tread_depth'],
                  label: l10n.tyreDetailStatTread,
                  unit: 'mm',
                  status: status,
                ),
              ),
              const SizedBox(width: TpSpace.sm),
              Expanded(
                child: _statCard(
                  entry,
                  const <String>['pressure_psi', 'pressure'],
                  label: l10n.tyreDetailStatPressure,
                  unit: 'psi',
                  status: status,
                ),
              ),
              const SizedBox(width: TpSpace.sm),
              Expanded(
                child: TpStatCard.unavailable(
                  label: l10n.tyreDetailStatTemperature,
                  caption: l10n.tyreDetailNotRecordedCaption,
                ),
              ),
            ],
          ),
          const SizedBox(height: TpSpace.xl),
          Text(
            l10n.tyreDetailSectionOverview,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: TpSpace.sm),
          TpCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                _DetailRow(
                  label: l10n.tyreDetailAssetLabel,
                  value: assetNo,
                  fallback: l10n.tyreDetailFieldNotRecorded,
                  isIdentifier: true,
                ),
                _DetailRow(
                  label: l10n.tyreDetailSiteLabel,
                  value: siteName,
                  fallback: l10n.tyreDetailFieldNotRecorded,
                ),
                _DetailRow(
                  label: l10n.inspectionSerialLabel,
                  value: serial,
                  fallback: l10n.tyreDetailFieldNotRecorded,
                  isIdentifier: true,
                ),
                if (notes != null && notes.isNotEmpty)
                  _DetailRow(label: l10n.inspectionNotesLabel, value: notes),
              ],
            ),
          ),
          const SizedBox(height: TpSpace.lg),
          Text(
            l10n.tyreDetailSectionAdditionalInfo,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: TpSpace.sm),
          TpCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                _DetailRow(
                  label: l10n.tyreDetailBrandLabel,
                  value: null,
                  fallback: l10n.tyreDetailFieldNotRecorded,
                ),
                _DetailRow(
                  label: l10n.tyreDetailSizeLabel,
                  value: null,
                  fallback: l10n.tyreDetailFieldNotRecorded,
                ),
                _DetailRow(
                  label: l10n.tyreDetailInstalledKmLabel,
                  value: null,
                  fallback: l10n.tyreDetailFieldNotRecorded,
                ),
                _DetailRow(
                  label: l10n.tyreDetailRunningKmLabel,
                  value: null,
                  fallback: l10n.tyreDetailFieldNotRecorded,
                ),
              ],
            ),
          ),
          if (photoUrl != null || photoLocalPath != null) ...<Widget>[
            const SizedBox(height: TpSpace.lg),
            Text(
              l10n.inspectionPhotoLabel,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: TpSpace.sm),
            TpCard(
              child: ClipRRect(
                borderRadius: BorderRadius.circular(TpRadius.md),
                child: Image(
                  image: photoUrl != null
                      ? NetworkImage(photoUrl)
                      : AssetImage(photoLocalPath!) as ImageProvider,
                  height: 160,
                  width: double.infinity,
                  fit: BoxFit.cover,
                  errorBuilder: (context, error, stack) =>
                      const SizedBox.shrink(),
                ),
              ),
            ),
          ],
          if (entry == null) ...<Widget>[
            const SizedBox(height: TpSpace.lg),
            Text(
              l10n.tyreDetailNoEvidenceMessage,
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: palette.textMuted),
            ),
          ],
          const SizedBox(height: TpSpace.xl),
          TpButton.primary(
            label: l10n.tyreDetailTakeActionButton,
            icon: Icons.build_outlined,
            isFullWidth: true,
            onPressed: () => pushTyreTakeActionScreen(
              context,
              positionCode: positionCode,
              assetNo: assetNo,
              siteName: siteName,
              onAdjustReading: onAdjustReading,
            ),
          ),
        ],
      ),
    );
  }

  Widget _statCard(
    Map<String, Object?>? entry,
    List<String> keys, {
    required String label,
    required String unit,
    required TpStatus status,
  }) {
    final String? value = _numberText(entry, keys);
    if (value == null) {
      return TpStatCard.unavailable(label: label);
    }
    return TpStatCard.text(
      label: label,
      value: '$value $unit',
      status: status,
    );
  }

  static String? _stringOrNull(Object? raw) {
    if (raw == null) return null;
    final String s = raw.toString().trim();
    return s.isEmpty ? null : s;
  }

  static String? _numberText(Map<String, Object?>? entry, List<String> keys) {
    if (entry == null) return null;
    for (final String key in keys) {
      final Object? value = entry[key];
      if (value == null) continue;
      if (value is num) {
        if (!value.isFinite) return null;
        return value == value.roundToDouble()
            ? value.toInt().toString()
            : value.toString();
      }
      final String text = value.toString().trim();
      if (text.isNotEmpty) return text;
    }
    return null;
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({
    required this.label,
    required this.value,
    this.fallback,
    this.isIdentifier = false,
  });

  final String label;
  final String? value;

  /// Shown, dimmed, when [value] is absent - the honest gap, never blank.
  final String? fallback;
  final bool isIdentifier;

  @override
  Widget build(BuildContext context) {
    final String? trimmed = value?.trim();
    final bool hasValue = trimmed != null && trimmed.isNotEmpty;
    if (!hasValue && fallback == null) return const SizedBox.shrink();

    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final String shown = hasValue ? trimmed : fallback!;
    final Color valueColor = hasValue ? palette.text : palette.textMuted;

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
              child: hasValue && isIdentifier
                  ? TpIdentifierText(
                      shown,
                      style: TpTypography.identifier(
                        palette,
                      ).copyWith(color: valueColor),
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
