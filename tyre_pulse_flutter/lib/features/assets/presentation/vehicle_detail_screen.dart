/// One vehicle, in full.
///
/// # This screen has NO route, and that is deliberate
///
/// `routes.dart` declares [VehiclesRoute] and never a `vehicleDetail`
/// counterpart - verified by reading the whole file and `app_router.dart`'s
/// route tree, where every OTHER list (`workOrders`, `accidentDashboard`,
/// `checklists`, `activityHistory`) declares a nested detail route and
/// `vehicles` does not. Registering a new route id was outside this change's
/// remit - the task that produced this file was explicit that `routes.dart`
/// is not to be edited, and that a missing route should be noted rather than
/// invented. So this screen is reached the same way the equivalent inline
/// expansion works in the production `mobile/app/(app)/vehicles.tsx`: pushed
/// directly from [VehiclesListScreen] with a plain [Navigator.push], onto
/// the Home branch's own nested Navigator (branch 0 in `app_router.dart`),
/// rather than through a named go_router location.
///
/// # Why that changes how Back is wired here
///
/// A screen reached via `context.go`/`context.push` gets its guard AND its
/// system-back handling from `app_router.dart`'s `_GuardedScreen` and
/// `TpScaffold`'s `backFallback`, both of which resolve through
/// [TpBack.of], i.e. through the ambient [GoRouter]. This screen was never
/// declared to that router, so:
///
/// - [TpModuleGuard] is applied EXPLICITLY here, because there is no
///   `_GuardedScreen` wrapper doing it automatically the way there is for
///   [VehiclesListScreen]. Permissions can change while this screen is
///   already open - an administrator revoking `vehicles` access mid-session
///   - and without its own guard this screen would keep rendering after
///   that.
/// - The page's own [TpScaffold] carries NO `backFallback`. A real
///   [Navigator] push put this screen on screen, so real history already
///   exists on the nearest Navigator, and Flutter's own default Back
///   handling (hardware button, predictive-back gesture, and the framework
///   default an omitted `backFallback` leaves in place - see
///   `tp_scaffold.dart`'s own doc) already pops it correctly. Setting
///   `backFallback` here would route that through [TpBack]/[GoRouter]
///   instead, and this environment has no way to compile-run the app and
///   confirm how `GoRouter.canPop()` behaves for a route it was never told
///   about - safer to rely on the plain Flutter mechanism that is
///   unambiguously correct for a plainly-pushed screen with real history.
/// - The app bar's chevron is wired explicitly to
///   `Navigator.of(context).maybePop()` for the same reason, using
///   [TpAppBar.onBack] - the override hook that file's own doc says exists
///   for exactly a screen that needs to run Back itself.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/module_guard.dart';
import 'package:tyre_pulse/app/router/route_access.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_fleet_providers.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_photo_resolver.dart';

class VehicleDetailScreen extends StatelessWidget {
  const VehicleDetailScreen({required this.assetNo, super.key});

  /// `vehicle_fleet.asset_no`, exact. See the library comment: this is the
  /// only identifier a re-fetchable detail screen can be keyed by.
  final String assetNo;

  @override
  Widget build(BuildContext context) {
    return TpModuleGuard(
      guard: TpRouteGuards.forRouteId(TpRouteId.vehicles),
      backFallback: TpRoutePaths.vehicles,
      child: _VehicleDetailBody(assetNo: assetNo),
    );
  }
}

class _VehicleDetailBody extends ConsumerWidget {
  const _VehicleDetailBody({required this.assetNo});

  final String assetNo;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AsyncValue<VehicleDetailOutcome> outcomeAsync = ref.watch(
      vehicleDetailProvider(assetNo),
    );

    return TpScaffold(
      appBar: TpAppBar(
        title: l10n.vehiclesDetailSubtitle,
        subtitle: TpDirection.isolateLtr(assetNo),
        onBack: () => Navigator.of(context).maybePop(),
      ),
      body: _buildBody(context, ref, l10n, outcomeAsync),
    );
  }

  /// The same seven-state policy as [VehiclesListScreen]'s
  /// `_buildBody` - see that method's doc for the full reasoning, repeated
  /// here only where it differs:
  ///
  /// - [VehicleDetailNotFound] maps to [TpEmptyState], not [TpErrorState].
  ///   The query ran and answered "no such row", which is a fact about the
  ///   fleet register, not a malfunction - mirroring
  ///   `SupabaseFailure.isNoRowsFound`'s own distinction. Rendering it as an
  ///   error would tell a technician something is broken when the honest
  ///   answer is that the asset number does not exist in this scope.
  Widget _buildBody(
    BuildContext context,
    WidgetRef ref,
    AppLocalizations l10n,
    AsyncValue<VehicleDetailOutcome> outcomeAsync,
  ) {
    return outcomeAsync.when(
      loading: () => const TpLoadingState(),
      error: (Object error, StackTrace stackTrace) => TpErrorState(
        error: error is AppError ? error : _unexpectedError(),
        onRetry: () => ref.invalidate(vehicleDetailProvider(assetNo)),
      ),
      data: (VehicleDetailOutcome outcome) => switch (outcome) {
        VehicleDetailLoaded(asset: final VehicleAsset asset) => _DetailView(
            asset: asset,
            l10n: l10n,
          ),
        VehicleDetailFromCache(cachedAt: final DateTime? cachedAt) =>
          TpOfflineCachedState(
            cachedAtLabel: _formatCachedAt(cachedAt),
            onRetry: () => ref.invalidate(vehicleDetailProvider(assetNo)),
          ),
        VehicleDetailNotFound() => TpEmptyState(
            title: l10n.vehiclesNotFoundTitle,
            message: l10n.vehiclesNotFoundMessage,
          ),
        VehicleDetailFailed(error: final AppError error) =>
          isBackendUnavailableError(error)
              ? TpBackendUnavailableState(
                  onRetry: () => ref.invalidate(vehicleDetailProvider(assetNo)),
                )
              : TpErrorState(
                  error: error,
                  onRetry: () => ref.invalidate(vehicleDetailProvider(assetNo)),
                ),
      },
    );
  }

  static AppError _unexpectedError() => const AppError(
        kind: AppErrorKind.unknown,
        message: 'Something went wrong. Please try again.',
        isRetryable: true,
      );

  static String? _formatCachedAt(DateTime? cachedAt) {
    if (cachedAt == null) {
      return null;
    }
    final DateTime local = cachedAt.toLocal();
    final String hh = local.hour.toString().padLeft(2, '0');
    final String mm = local.minute.toString().padLeft(2, '0');
    return '${local.year}-${local.month.toString().padLeft(2, '0')}-'
        '${local.day.toString().padLeft(2, '0')} $hh:$mm';
  }
}

/// The full record. Twelve fields, matching the production screen's own
/// expandable detail grid field for field: fleet number, type, make/model,
/// year, current odometer, operator, department, site, region, country,
/// tyre size, registration.
class _DetailView extends ConsumerWidget {
  const _DetailView({required this.asset, required this.l10n});

  final VehicleAsset asset;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final bool canStartInspection = ref.watch(
      canAccessModuleProvider(ModuleKey.inspect),
    );
    final String? vehiclePhoto = vehiclePhotoAsset(asset);

    final List<(String, String?)> fields = <(String, String?)>[
      (l10n.vehiclesFieldFleetNo, asset.fleetNumber),
      (l10n.vehiclesFieldType, asset.vehicleType),
      (l10n.vehiclesFieldMakeModel, _join(<String?>[asset.make, asset.model])),
      (l10n.vehiclesFieldYear, asset.year?.toString()),
      (
        l10n.vehiclesFieldCurrentKm,
        asset.currentKm != null
            ? '${formatVehicleOdometer(asset.currentKm!)} km'
            : null,
      ),
      (l10n.vehiclesFieldOperator, asset.operatorName),
      (l10n.vehiclesFieldDepartment, asset.department),
      (l10n.vehiclesFieldSite, asset.site),
      (l10n.vehiclesFieldRegion, asset.region),
      (l10n.vehiclesFieldCountry, asset.country),
      (l10n.vehiclesFieldTyreSize, asset.tyreSize),
      (l10n.vehiclesFieldRegistration, asset.registrationNo),
    ];

    final List<({String label, String value, IconData icon})> metrics =
        <({String label, String value, IconData icon})>[
      if (asset.currentKm != null)
        (
          label: l10n.vehiclesFieldCurrentKm,
          value: '${formatVehicleOdometer(asset.currentKm!)} km',
          icon: Icons.speed_rounded,
        ),
      if (asset.fleetNumber?.trim().isNotEmpty == true)
        (
          label: l10n.vehiclesFieldFleetNo,
          value: asset.fleetNumber!.trim(),
          icon: Icons.tag_rounded,
        ),
      if (asset.tyreSize?.trim().isNotEmpty == true)
        (
          label: l10n.vehiclesFieldTyreSize,
          value: asset.tyreSize!.trim(),
          icon: Icons.tire_repair_outlined,
        ),
    ];

    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final double horizontalPadding =
            constraints.maxWidth >= 720 ? TpSpace.xxl : TpSpace.lg;
        return ListView(
          padding: EdgeInsets.fromLTRB(
            horizontalPadding,
            TpSpace.md,
            horizontalPadding,
            TpSpace.xxxl,
          ),
          children: <Widget>[
            Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 760),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    TpCard(
                      margin: const EdgeInsets.only(bottom: TpSpace.md),
                      padding: const EdgeInsets.all(TpSpace.lg),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Container(
                            width: 126,
                            height: 92,
                            decoration: BoxDecoration(
                              color: palette.surfaceAlt,
                              borderRadius: BorderRadius.circular(TpRadius.md),
                              border: Border.all(color: palette.border),
                            ),
                            clipBehavior: Clip.antiAlias,
                            alignment: Alignment.center,
                            child: vehiclePhoto == null
                                ? Icon(
                                    vehicleFallbackIcon(asset),
                                    color: palette.primary,
                                    size: 40,
                                  )
                                : Image.asset(
                                    vehiclePhoto,
                                    key: ValueKey<String>(vehiclePhoto),
                                    width: double.infinity,
                                    height: double.infinity,
                                    fit: BoxFit.contain,
                                    filterQuality: FilterQuality.high,
                                    semanticLabel: asset.displayIdentity,
                                  ),
                          ),
                          const SizedBox(width: TpSpace.md),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: <Widget>[
                                Row(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: <Widget>[
                                    Expanded(
                                      child: TpIdentifierText(
                                        asset.displayIdentity ??
                                            l10n.vehiclesUnknownAsset,
                                        style: text.headlineSmall,
                                      ),
                                    ),
                                    const SizedBox(width: TpSpace.sm),
                                    TpStatusChip(
                                      status: vehicleStatusTone(asset.status),
                                      label: asset.status,
                                      isCompact: true,
                                    ),
                                  ],
                                ),
                                if (asset.vehicleType?.trim().isNotEmpty ==
                                    true) ...<Widget>[
                                  const SizedBox(height: 2),
                                  Text(
                                    asset.vehicleType!.trim(),
                                    style: text.bodyMedium,
                                  ),
                                ],
                                if (asset.site?.trim().isNotEmpty ==
                                    true) ...<Widget>[
                                  const SizedBox(height: TpSpace.xs),
                                  Row(
                                    children: <Widget>[
                                      Icon(
                                        Icons.location_on_outlined,
                                        size: TpSizing.iconSm,
                                        color: palette.textMuted,
                                      ),
                                      const SizedBox(width: TpSpace.xs),
                                      Expanded(
                                        child: Text(
                                          asset.site!.trim(),
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                          style: text.labelSmall,
                                        ),
                                      ),
                                    ],
                                  ),
                                ],
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                    if (metrics.isNotEmpty) ...<Widget>[
                      _AssetMetricGrid(metrics: metrics),
                      const SizedBox(height: TpSpace.lg),
                    ],
                    _OverviewHeading(label: l10n.tyreDetailSectionOverview),
                    const SizedBox(height: TpSpace.sm),
                    TpCard(
                      margin: const EdgeInsets.only(bottom: TpSpace.lg),
                      padding: EdgeInsets.zero,
                      child: Column(
                        children: <Widget>[
                          for (int i = 0; i < fields.length; i++)
                            _FieldRow(
                              label: fields[i].$1,
                              value: fields[i].$2,
                              showDivider: i < fields.length - 1,
                              borderColor: palette.border,
                            ),
                        ],
                      ),
                    ),
                    if (canStartInspection)
                      TpButton.primary(
                        label: l10n.vehiclesStartInspection,
                        icon: Icons.assignment_outlined,
                        isFullWidth: true,
                        onPressed: () => _startInspection(context),
                      ),
                  ],
                ),
              ),
            ),
          ],
        );
      },
    );
  }

  /// Crosses from the Home branch (where the vehicles list and this screen
  /// live) into the Inspect branch. `app_router.dart`'s own rule 2 - "a push
  /// that continues a task stays in its branch; only a bar tap switches
  /// branch" - is written about the SCANNER's flow, but the general
  /// principle is the reason `context.go` is used here rather than
  /// `context.push`: this is a genuine branch switch, exactly like a tab
  /// tap, not a push that should stack on top of the vehicles branch's own
  /// history.
  void _startInspection(BuildContext context) {
    final String? site = asset.site;
    final String? code = asset.assetNo;
    // Guaranteed non-null: this screen only ever loads a row that matched
    // an exact asset_no lookup. Guarded anyway rather than force-unwrapped,
    // so a future change to how this screen is reached cannot turn into a
    // null-check crash.
    if (code == null) {
      return;
    }
    context.go(
      NewInspectionRoute(
        siteName: site == null ? null : SiteName(site),
        assetNo: AssetNo(code),
      ).location,
    );
  }

  static String? _join(List<String?> parts) {
    final List<String> present = parts
        .whereType<String>()
        .map((String s) => s.trim())
        .where((String s) => s.isNotEmpty)
        .toList(growable: false);
    return present.isEmpty ? null : present.join(' ');
  }
}

class _AssetMetricGrid extends StatelessWidget {
  const _AssetMetricGrid({required this.metrics});

  final List<({String label, String value, IconData icon})> metrics;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final int columns = constraints.maxWidth >= 620
            ? metrics.length
            : metrics.length > 2
                ? 2
                : metrics.length;
        final int safeColumns = columns < 1 ? 1 : columns;
        final double width =
            (constraints.maxWidth - TpSpace.sm * (safeColumns - 1)) /
                safeColumns;
        return Wrap(
          spacing: TpSpace.sm,
          runSpacing: TpSpace.sm,
          children: <Widget>[
            for (final metric in metrics)
              SizedBox(width: width, child: _AssetMetricCard(metric: metric)),
          ],
        );
      },
    );
  }
}

class _AssetMetricCard extends StatelessWidget {
  const _AssetMetricCard({required this.metric});

  final ({String label, String value, IconData icon}) metric;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    return TpCard(
      background: palette.surfaceAlt,
      padding: const EdgeInsets.all(TpSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Icon(metric.icon, size: TpSizing.iconSm, color: palette.primary),
              const SizedBox(width: TpSpace.xs),
              Expanded(
                child: Text(
                  metric.label,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: text.labelSmall,
                ),
              ),
            ],
          ),
          const SizedBox(height: TpSpace.sm),
          Text(
            metric.value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: text.titleMedium?.copyWith(fontWeight: FontWeight.w800),
          ),
        ],
      ),
    );
  }
}

class _OverviewHeading extends StatelessWidget {
  const _OverviewHeading({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Row(
      children: <Widget>[
        Text(
          label,
          style: Theme.of(context).textTheme.labelLarge?.copyWith(
                color: palette.primary,
              ),
        ),
        const SizedBox(width: TpSpace.sm),
        Expanded(child: Divider(color: palette.border)),
      ],
    );
  }
}

class _FieldRow extends StatelessWidget {
  const _FieldRow({
    required this.label,
    required this.value,
    required this.showDivider,
    required this.borderColor,
  });

  final String label;
  final String? value;
  final bool showDivider;
  final Color borderColor;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    // A genuinely unmeasured field renders the design system's own
    // placeholder rather than a blank line or an invented value - spec
    // section 32: a dash, never a fabricated "0" or empty space that reads
    // as a rendering fault.
    final String display = value?.trim().isNotEmpty == true
        ? value!.trim()
        : l10n.valueNotMeasured;

    return Container(
      decoration: showDivider
          ? BoxDecoration(
              border: Border(bottom: BorderSide(color: borderColor)),
            )
          : null,
      padding: const EdgeInsets.symmetric(
        horizontal: TpSpace.lg,
        vertical: TpSpace.md,
      ),
      child: Row(
        children: <Widget>[
          Expanded(flex: 2, child: Text(label, style: text.labelMedium)),
          Expanded(
            flex: 3,
            child: Text(
              display,
              style: text.bodyLarge,
              textAlign: TextAlign.end,
            ),
          ),
        ],
      ),
    );
  }
}
