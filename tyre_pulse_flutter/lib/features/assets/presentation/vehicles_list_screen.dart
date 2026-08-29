/// The fleet register list.
///
/// Ported from `mobile/app/(app)/vehicles.tsx`, restructured onto the seven
/// design-system states rather than the production screen's simpler
/// loading/error/empty split - see [_buildBody] for the full mapping.
///
/// # Gating
///
/// This screen is reached ONLY through the router at [TpRoutePaths.vehicles],
/// and `app_router.dart`'s `_GuardedScreen` ALREADY wraps every registered
/// route in `TpModuleGuard(guard: TpRouteGuards.forRouteId(route.routeId),
/// ...)` BEFORE calling the screen registry's builder - verified by reading
/// that file. So the `vehicles` module gate has already run, and this
/// screen's own `build` method never executes for a denied user at all. A
/// second `TpModuleGuard` wrap here would be redundant with the one the
/// router already applies to every registered screen; see
/// `vehicle_detail_screen.dart` for the screen that DOES need its own guard,
/// because it is reached by a plain `Navigator.push` the router never sees.
///
/// # The scanner hand-off this screen exists to honour
///
/// [VehiclesListScreen.initialSearchTerm] is [VehiclesRoute.assetNo]
/// resolved by [assetsScreenRegistrations]. `routes.dart`'s own comment on
/// that field records the defect it fixes: "the production scanner passes
/// `q` here and the screen never reads it, so scanning an asset and choosing
/// 'View asset' opens the unfiltered fleet list." Seeding the search field
/// with it - rather than silently discarding it - is what makes that
/// hand-off real.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart';
import 'package:tyre_pulse/features/assets/domain/asset_classes.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_detail_screen.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_fleet_providers.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_photo_resolver.dart';

class VehiclesListScreen extends ConsumerStatefulWidget {
  const VehiclesListScreen({
    this.initialSearchTerm,
    this.backFallback = TpRoutePaths.home,
    super.key,
  });

  /// Pre-fills the search box. See the library comment.
  final String? initialSearchTerm;

  /// Where Back goes with no history to pop. [TpBackFallbacks.forRoute]
  /// resolves this to [TpRoutePaths.home] today, because `vehicles` has no
  /// entry in `TpBackFallbacks.byRouteId` - passed explicitly rather than
  /// hard-coded here so a future fallback-table entry is honoured without
  /// this file changing.
  final String backFallback;

  @override
  ConsumerState<VehiclesListScreen> createState() => _VehiclesListScreenState();
}

@visibleForTesting
abstract final class VehiclesListScreenKeys {
  static const Key search = Key('vehicles.search');
  static Key asset(String id) => Key('vehicles.asset.$id');
}

class _VehiclesListScreenState extends ConsumerState<VehiclesListScreen> {
  late final TextEditingController _searchController;
  late String _searchTerm;

  /// Null = every class. [tyreAssetClassFilter] = the default, tyre-carrying
  /// classes only. Anything else = exactly that class code.
  String? _classFilter = tyreAssetClassFilter;

  @override
  void initState() {
    super.initState();
    final String initial = widget.initialSearchTerm?.trim() ?? '';
    _searchController = TextEditingController(text: initial);
    _searchTerm = initial;
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _selectClassChip(String? assetClass) {
    setState(() {
      // Tapping the already-active specific class again returns to the
      // default tyre-carrying filter, matching the production screen's own
      // toggle behaviour.
      _classFilter = (assetClass != null && assetClass == _classFilter)
          ? tyreAssetClassFilter
          : assetClass;
    });
  }

  void _openDetail(String assetNo) {
    Navigator.of(context).push<void>(
      MaterialPageRoute<void>(
        builder: (BuildContext _) => VehicleDetailScreen(assetNo: assetNo),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AsyncValue<VehicleFleetListOutcome> outcomeAsync = ref.watch(
      vehicleFleetListProvider,
    );

    return TpScaffold(
      backFallback: widget.backFallback,
      backgroundColor: TpPalette.of(context).surface,
      appBar: TpAppBar(
        title: l10n.appTitle,
        backFallback: widget.backFallback,
        actions: <Widget>[
          IconButton(
            tooltip: l10n.scannerTitle,
            onPressed: () => context.push(const ScannerRoute().location),
            icon: const Icon(Icons.qr_code_scanner_rounded),
          ),
        ],
      ),
      body: _buildBody(context, l10n, outcomeAsync),
    );
  }

  /// The seven-state mapping.
  ///
  /// - `AsyncLoading` -> [TpLoadingState]. The only case that may spin, and
  ///   it ends by itself.
  /// - `AsyncError` -> [TpErrorState]. Defensive only:
  ///   [VehicleFleetRepository.loadAll] never throws, so this branch fires
  ///   only for a genuine bug in provider construction, never for an
  ///   expected outcome.
  /// - [VehicleFleetListLoaded] -> the real list, search box and class
  ///   chips, built in [_buildLoaded].
  /// - [VehicleFleetListFromCache] -> [TpOfflineCachedState]. Deliberately
  ///   NOT [TpOfflineBanner]: that widget takes a `TpSyncSummary`, which
  ///   describes the offline WRITE queue this read-only screen has none of -
  ///   using it here would misuse a widget built for a different domain.
  ///   [TpOfflineCachedState] is the purpose-built widget for exactly this
  ///   situation: a read that could not reach the server, answered from the
  ///   copy already on the device.
  /// - [VehicleFleetListFailed] -> [TpBackendUnavailableState] when the
  ///   failure is network-classified (see [isBackendUnavailableError]),
  ///   otherwise [TpErrorState]. [TpNotConfiguredState] is deliberately
  ///   never reached from this screen - `vehicle_fleet` is a core,
  ///   always-provisioned table with no per-organisation toggle, so there is
  ///   no genuine "this has not been set up" condition to map onto it.
  ///   Inventing one would be exactly the kind of fabricated state this
  ///   application's own standards forbid.
  Widget _buildBody(
    BuildContext context,
    AppLocalizations l10n,
    AsyncValue<VehicleFleetListOutcome> outcomeAsync,
  ) {
    return outcomeAsync.when(
      loading: () => const TpLoadingState(),
      error: (Object error, StackTrace stackTrace) => TpErrorState(
        error: error is AppError ? error : _unexpectedError(),
        onRetry: () => ref.invalidate(vehicleFleetListProvider),
      ),
      data: (VehicleFleetListOutcome outcome) => switch (outcome) {
        VehicleFleetListLoaded(
          assets: final List<VehicleAsset> assets,
          truncated: final bool truncated,
        ) =>
          _buildLoaded(context, l10n, assets, truncated: truncated),
        VehicleFleetListFromCache(cachedAt: final DateTime? cachedAt) =>
          TpOfflineCachedState(
            cachedAtLabel: _formatCachedAt(cachedAt),
            onRetry: () => ref.invalidate(vehicleFleetListProvider),
          ),
        VehicleFleetListFailed(error: final AppError error) =>
          isBackendUnavailableError(error)
              ? TpBackendUnavailableState(
                  onRetry: () => ref.invalidate(vehicleFleetListProvider),
                )
              : TpErrorState(
                  error: error,
                  onRetry: () => ref.invalidate(vehicleFleetListProvider),
                ),
      },
    );
  }

  Widget _buildLoaded(
    BuildContext context,
    AppLocalizations l10n,
    List<VehicleAsset> assets, {
    required bool truncated,
  }) {
    final List<VehicleAsset> filtered = applyVehicleFilters(
      assets,
      assetClassFilter: _classFilter,
      searchTerm: _searchTerm,
    );
    // Chips are built from the WHOLE loaded set, never the already-filtered
    // one - narrowing by class must not narrow the chips that let you widen
    // it again.
    final List<AssetClassChip> classesPresent = classChips(
      assets.map((VehicleAsset a) => a.assetNo),
    );

    return Column(
      children: <Widget>[
        if (truncated) _TruncatedNotice(message: l10n.vehiclesTruncatedNotice),
        Padding(
          padding: const EdgeInsets.fromLTRB(
            TpSpace.lg,
            TpSpace.lg,
            TpSpace.lg,
            TpSpace.sm,
          ),
          child: _FleetRegisterHeading(
            title: l10n.loginScopeFleetAssets,
            countLabel: l10n.vehiclesCount(assets.length),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(
            TpSpace.lg,
            TpSpace.sm,
            TpSpace.lg,
            TpSpace.xs,
          ),
          child: Row(
            children: <Widget>[
              Expanded(
                child: KeyedSubtree(
                  key: VehiclesListScreenKeys.search,
                  child: TpSearchField(
                    controller: _searchController,
                    hint: l10n.vehiclesSearchHint,
                    onChanged: (String value) =>
                        setState(() => _searchTerm = value),
                  ),
                ),
              ),
              const SizedBox(width: TpSpace.sm),
              _SquareScannerButton(
                tooltip: l10n.scannerTitle,
                onTap: () => context.push(const ScannerRoute().location),
              ),
            ],
          ),
        ),
        const SizedBox(height: TpSpace.sm),
        _ClassChipsRow(
          selected: _classFilter,
          classesPresent: classesPresent,
          tyreAssetsLabel: l10n.vehiclesTyreAssetsFilter,
          allLabel: l10n.vehiclesAllFilter,
          onSelect: _selectClassChip,
        ),
        Expanded(
          child: filtered.isEmpty
              ? TpEmptyState(
                  title: l10n.vehiclesEmptyTitle,
                  message: _searchTerm.trim().isNotEmpty
                      ? l10n.vehiclesEmptySearchMessage
                      : null,
                )
              : ListView.separated(
                  padding: const EdgeInsets.fromLTRB(
                    TpSpace.lg,
                    TpSpace.sm,
                    TpSpace.lg,
                    TpSpace.xxl,
                  ),
                  itemCount: filtered.length,
                  separatorBuilder: (BuildContext context, int index) =>
                      const SizedBox(height: TpSpace.sm),
                  itemBuilder: (BuildContext context, int index) {
                    final VehicleAsset asset = filtered[index];
                    return _FleetAssetCard(
                      key: VehiclesListScreenKeys.asset(asset.id),
                      asset: asset,
                      unknownAssetLabel: l10n.vehiclesUnknownAsset,
                      onTap: asset.hasNavigableAssetNo
                          ? () => _openDetail(asset.assetNo!)
                          : null,
                    );
                  },
                ),
        ),
      ],
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

class _FleetRegisterHeading extends StatelessWidget {
  const _FleetRegisterHeading({
    required this.title,
    required this.countLabel,
  });

  final String title;
  final String countLabel;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: <Widget>[
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                title,
                style: text.headlineMedium?.copyWith(
                  color: palette.text,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.4,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                countLabel,
                style: text.bodyMedium?.copyWith(
                  color: palette.textSecondary,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
        ),
        DecoratedBox(
          decoration: BoxDecoration(
            color: palette.primarySoft,
            borderRadius: BorderRadius.circular(TpRadius.pill),
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Icon(
                  Icons.cloud_done_outlined,
                  size: 17,
                  color: palette.primaryDark,
                ),
                const SizedBox(width: 5),
                Text(
                  AppLocalizations.of(context).inspectionStatusSynced,
                  style: text.labelSmall?.copyWith(
                    color: palette.primaryDark,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _SquareScannerButton extends StatelessWidget {
  const _SquareScannerButton({
    required this.tooltip,
    required this.onTap,
  });

  final String tooltip;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Semantics(
      button: true,
      label: tooltip,
      child: Material(
        color: palette.surfaceAlt,
        borderRadius: BorderRadius.circular(TpRadius.md),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(TpRadius.md),
          child: SizedBox.square(
            dimension: TpSizing.controlHeight,
            child: Icon(
              Icons.qr_code_scanner_rounded,
              color: palette.text,
              size: TpSizing.iconLg,
            ),
          ),
        ),
      ),
    );
  }
}

/// The production fleet row rendered in the approved light register style.
///
/// The leading artwork is one of the exact vehicle assets supplied with the
/// Figma hand-off. It is selected only when the real make/model/type text
/// identifies that class; an unrecognised class keeps the honest generic icon
/// instead of receiving a random vehicle photograph.
class _FleetAssetCard extends StatelessWidget {
  const _FleetAssetCard({
    required this.asset,
    required this.unknownAssetLabel,
    this.onTap,
    super.key,
  });

  final VehicleAsset asset;
  final String unknownAssetLabel;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final String identity = asset.displayIdentity ?? unknownAssetLabel;
    final String? description = _joinNonEmpty(
      <String?>[asset.make, asset.model, asset.vehicleType],
      separator: ' · ',
    );
    final String? contextLine = _joinNonEmpty(
      <String?>[
        asset.site,
        if (asset.currentKm != null)
          '${formatVehicleOdometer(asset.currentKm!)} km',
      ],
      separator: ' · ',
    );
    final TpStatusColors statusColors = palette.forStatus(
      vehicleStatusTone(asset.status),
    );
    final String? photo = vehiclePhotoAsset(asset);

    return Semantics(
      button: onTap != null,
      label: identity,
      child: Material(
        color: palette.surface,
        shape: RoundedRectangleBorder(
          side: BorderSide(color: palette.border),
          borderRadius: BorderRadius.circular(TpRadius.lg),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(TpSpace.md),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: <Widget>[
                Container(
                  width: 94,
                  height: 82,
                  decoration: BoxDecoration(
                    color: palette.surfaceAlt,
                    borderRadius: BorderRadius.circular(TpRadius.md),
                    border: Border.all(color: palette.border),
                  ),
                  clipBehavior: Clip.antiAlias,
                  alignment: Alignment.center,
                  child: photo == null
                      ? Icon(
                          vehicleFallbackIcon(asset),
                          size: 38,
                          color: palette.primary,
                        )
                      : Image.asset(
                          photo,
                          width: double.infinity,
                          height: double.infinity,
                          fit: BoxFit.contain,
                          filterQuality: FilterQuality.high,
                          semanticLabel: identity,
                        ),
                ),
                const SizedBox(width: TpSpace.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      TpIdentifierText(
                        identity,
                        style: text.titleMedium?.copyWith(
                          color: palette.text,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      if (description != null) ...<Widget>[
                        const SizedBox(height: 3),
                        Text(
                          description,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: text.labelSmall?.copyWith(
                            color: palette.textSecondary,
                          ),
                        ),
                      ],
                      const SizedBox(height: 7),
                      Row(
                        children: <Widget>[
                          if (asset.status?.trim().isNotEmpty == true)
                            Text(
                              asset.status!.trim(),
                              style: text.labelSmall?.copyWith(
                                color: statusColors.base,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          if (asset.status?.trim().isNotEmpty == true &&
                              contextLine != null)
                            Text(
                              '  ·  ',
                              style: text.labelSmall?.copyWith(
                                color: palette.textMuted,
                              ),
                            ),
                          if (contextLine != null)
                            Expanded(
                              child: Text(
                                contextLine,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: text.labelSmall?.copyWith(
                                  color: palette.textMuted,
                                ),
                              ),
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: TpSpace.sm),
                Icon(
                  Directionality.of(context) == TextDirection.rtl
                      ? Icons.chevron_left_rounded
                      : Icons.chevron_right_rounded,
                  color: palette.textMuted,
                  size: TpSizing.iconMd,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Joins the non-blank values in [parts] with [separator]. Returns null when
/// nothing survives, so a caller can tell "no detail line" apart from an
/// empty string that would still take up layout space.
String? _joinNonEmpty(List<String?> parts, {required String separator}) {
  final List<String> present = parts
      .whereType<String>()
      .map((String s) => s.trim())
      .where((String s) => s.isNotEmpty)
      .toList(growable: false);
  return present.isEmpty ? null : present.join(separator);
}

/// A slim, non-blocking notice that the list may be shorter than the whole
/// fleet. Not a full-screen state: there IS a usable, complete-looking list
/// underneath it, and the seven-state widgets are for when there is nothing
/// else to show.
class _TruncatedNotice extends StatelessWidget {
  const _TruncatedNotice({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TpStatusColors colors = palette.forStatus(TpStatus.info);
    return Container(
      width: double.infinity,
      color: colors.soft,
      padding: const EdgeInsets.symmetric(
        horizontal: TpSpace.lg,
        vertical: TpSpace.sm,
      ),
      child: Text(
        message,
        style: Theme.of(context)
            .textTheme
            .labelSmall
            ?.copyWith(color: colors.onSoft),
      ),
    );
  }
}

/// The horizontal row of class-filter chips.
///
/// Two fixed chips (tyre-carrying default, then All) followed by one chip
/// per class actually present in the loaded set, in [classChips]'s own
/// priority order.
class _ClassChipsRow extends StatelessWidget {
  const _ClassChipsRow({
    required this.selected,
    required this.classesPresent,
    required this.tyreAssetsLabel,
    required this.allLabel,
    required this.onSelect,
  });

  final String? selected;
  final List<AssetClassChip> classesPresent;
  final String tyreAssetsLabel;
  final String allLabel;
  final ValueChanged<String?> onSelect;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 40,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: TpSpace.lg),
        children: <Widget>[
          _ClassChip(
            label: tyreAssetsLabel,
            isSelected: selected == tyreAssetClassFilter,
            onTap: () => onSelect(tyreAssetClassFilter),
          ),
          const SizedBox(width: TpSpace.xs),
          _ClassChip(
            label: allLabel,
            isSelected: selected == null,
            onTap: () => onSelect(null),
          ),
          for (final AssetClassChip chip in classesPresent) ...<Widget>[
            const SizedBox(width: TpSpace.xs),
            _ClassChip(
              label: '${chip.assetClass} ${chip.count}',
              isSelected: selected == chip.assetClass,
              onTap: () => onSelect(chip.assetClass),
            ),
          ],
        ],
      ),
    );
  }
}

class _ClassChip extends StatelessWidget {
  const _ClassChip({
    required this.label,
    required this.isSelected,
    required this.onTap,
  });

  final String label;
  final bool isSelected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return ChoiceChip(
      label: Text(label),
      selected: isSelected,
      onSelected: (bool _) => onTap(),
      showCheckmark: false,
      backgroundColor: palette.surface,
      selectedColor: palette.primary,
      labelStyle: Theme.of(context)
          .textTheme
          .labelMedium
          ?.copyWith(color: isSelected ? palette.onPrimary : palette.text),
      side: BorderSide(
        color: isSelected ? palette.primary : palette.border,
        width: TpBorderWidth.hairline,
      ),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(TpRadius.pill),
      ),
      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
      visualDensity: VisualDensity.compact,
    );
  }
}
