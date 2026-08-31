/// Serial No. Search - find a tyre by its serial number.
///
/// A field user types, pastes or scans a tyre serial and resolves it to the
/// canonical `tyre_records` row. From a match with a fitted asset they can
/// jump into a new inspection. From a match at all they can mark or undo a
/// scrap, each gated behind an explicit confirmation step because it is a
/// hard-to-reverse safety action - see `tyre_lookup_repository.dart`.
///
/// ACCESS TO THIS SCREEN is already decided before it is ever built: the
/// router wraps every route in `TpModuleGuard`, keyed to `RouteModule.serial`
/// for this one, and only builds the registered screen when that guard
/// admits the caller - see `app/router/app_router.dart`'s `_GuardedScreen`
/// ("A refused screen must not run its build method at all"). So this file
/// does not repeat that check; it only asks the SERVER, separately and more
/// narrowly, whether THIS user may scrap or undo a scrap - two different
/// questions at two different layers, both real.
library;

import 'dart:async';

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
import 'package:tyre_pulse/features/tyres/domain/serial_search_state.dart';
import 'package:tyre_pulse/features/tyres/domain/tyre_lookup_record.dart';
import 'package:tyre_pulse/features/tyres/presentation/'
    'serial_search_controller.dart';

class SerialSearchScreen extends ConsumerStatefulWidget {
  const SerialSearchScreen({required this.route, super.key});

  final SerialSearchRoute route;

  @override
  ConsumerState<SerialSearchScreen> createState() => _SerialSearchScreenState();
}

class _SerialSearchScreenState extends ConsumerState<SerialSearchScreen> {
  final TextEditingController _searchController = TextEditingController();
  bool _didPrefill = false;

  @override
  void initState() {
    super.initState();
    final String? prefill = widget.route.tyreSerial?.value;
    if (prefill == null || prefill.trim().isEmpty) return;

    _searchController.text = prefill;
    // Deferred to after the first frame: triggering a search mutates
    // provider state, and doing that synchronously from initState risks
    // Riverpod's "modified a provider while the widget tree was building"
    // assertion. The `mounted`/`_didPrefill` pair stops a stray extra frame
    // from re-running the search a second time.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || _didPrefill) return;
      _didPrefill = true;
      final SerialSearchController controller = ref.read(
        serialSearchControllerProvider.notifier,
      );
      unawaited(controller.search(prefill));
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _handleQueryChanged(String value) {
    final SerialSearchController controller = ref.read(
      serialSearchControllerProvider.notifier,
    );
    controller.setQuery(value);
    if (value.isEmpty) controller.clear();
  }

  Future<void> _runSearch([String? raw]) {
    return ref
        .read(serialSearchControllerProvider.notifier)
        .search(raw ?? _searchController.text);
  }

  Future<void> _openScrapSheet(TyreLookupRecord tyre) async {
    final String? reason = await _ScrapReasonSheet.show(context);
    if (reason == null) return; // Dismissed without confirming.
    if (!mounted) return;
    await ref
        .read(serialSearchControllerProvider.notifier)
        .confirmScrap(reason: reason);
  }

  Future<void> _confirmUndoScrap() async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final bool confirmed = await TpDialog.confirm(
      context: context,
      title: l10n.serialSearchUndoConfirmTitle,
      message: l10n.serialSearchUndoConfirmMessage,
      confirmLabel: l10n.serialSearchUndoScrap,
      isDestructive: true,
    );
    if (!confirmed || !mounted) return;
    await ref.read(serialSearchControllerProvider.notifier).undoScrap();
  }

  void _inspectTyre(TyreLookupRecord tyre) {
    final String? assetNo = tyre.assetNo;
    if (assetNo == null) return;
    final SerialSearchState state = ref.read(serialSearchControllerProvider);
    final NewInspectionRoute target = NewInspectionRoute(
      assetNo: AssetNo(assetNo),
      siteName: tyre.site == null ? null : SiteName(tyre.site!),
      tyreSerial: state.resolvedSerial == null
          ? null
          : TyreSerial(state.resolvedSerial!),
      tyrePosition:
          tyre.bestPosition == null ? null : TyrePosition(tyre.bestPosition!),
    );
    GoRouter.of(context).go(target.location);
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final SerialSearchState state = ref.watch(serialSearchControllerProvider);

    ref.listen<SerialSearchState>(serialSearchControllerProvider, (
      SerialSearchState? previous,
      SerialSearchState next,
    ) {
      final AppError? error = next.lastError;
      if (error == null || identical(error, previous?.lastError)) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(error.message)));
    });

    return TpScaffold(
      backFallback: TpRoutePaths.home,
      appBar: TpAppBar(
        title: l10n.serialSearchTitle,
        subtitle: l10n.serialSearchSubtitle,
        backFallback: TpRoutePaths.home,
      ),
      body: ListView(
        padding: const EdgeInsets.all(TpSpace.lg),
        children: <Widget>[
          _SearchBar(
            controller: _searchController,
            isSearching: state.isSearching,
            onChanged: _handleQueryChanged,
            onSubmitted: (String value) => unawaited(_runSearch(value)),
            onSearchPressed: () => unawaited(_runSearch()),
          ),
          const SizedBox(height: TpSpace.lg),
          _ResultArea(
            state: state,
            onRetrySearch: () => unawaited(_runSearch()),
            onInspect: _inspectTyre,
            onMarkScrap: (TyreLookupRecord tyre) =>
                unawaited(_openScrapSheet(tyre)),
            onUndoScrap: () => unawaited(_confirmUndoScrap()),
          ),
        ],
      ),
    );
  }
}

class _SearchBar extends StatelessWidget {
  const _SearchBar({
    required this.controller,
    required this.isSearching,
    required this.onChanged,
    required this.onSubmitted,
    required this.onSearchPressed,
  });

  final TextEditingController controller;
  final bool isSearching;
  final ValueChanged<String> onChanged;
  final ValueChanged<String> onSubmitted;
  final VoidCallback onSearchPressed;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);

    return TpCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Expanded(
                child: TpSearchField(
                  controller: controller,
                  hint: l10n.serialSearchPlaceholder,
                  onChanged: onChanged,
                  onSubmitted: onSubmitted,
                ),
              ),
              const SizedBox(width: TpSpace.sm),
              ValueListenableBuilder<TextEditingValue>(
                valueListenable: controller,
                builder: (BuildContext context, TextEditingValue value, _) {
                  final bool canSearch = value.text.trim().isNotEmpty;
                  return TpButton.primary(
                    label: l10n.searchHint,
                    icon: Icons.search,
                    isBusy: isSearching,
                    onPressed:
                        canSearch && !isSearching ? onSearchPressed : null,
                  );
                },
              ),
            ],
          ),
          const SizedBox(height: TpSpace.sm),
          Text(
            l10n.serialSearchHelp,
            style: Theme.of(context).textTheme.labelSmall,
          ),
        ],
      ),
    );
  }
}

class _ResultArea extends StatelessWidget {
  const _ResultArea({
    required this.state,
    required this.onRetrySearch,
    required this.onInspect,
    required this.onMarkScrap,
    required this.onUndoScrap,
  });

  final SerialSearchState state;
  final VoidCallback onRetrySearch;
  final ValueChanged<TyreLookupRecord> onInspect;
  final ValueChanged<TyreLookupRecord> onMarkScrap;
  final VoidCallback onUndoScrap;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);

    if (state.isSearching) {
      return TpLoadingState(message: l10n.serialSearchSearching);
    }
    if (state.isError) {
      return TpErrorState(
        error: state.lastError ??
            AppError(
              kind: AppErrorKind.unknown,
              message: l10n.stateErrorMessage,
            ),
        onRetry: onRetrySearch,
      );
    }
    if (state.isEmptyResult) {
      return TpEmptyState(
        icon: Icons.search_off,
        title: l10n.serialSearchEmptyTitle,
        message: l10n.serialSearchEmptyMessage,
      );
    }
    if (state.isFound) {
      return _FoundResult(
        state: state,
        onInspect: onInspect,
        onMarkScrap: onMarkScrap,
        onUndoScrap: onUndoScrap,
      );
    }
    return TpEmptyState(
      icon: Icons.qr_code_2,
      title: l10n.serialSearchIdleTitle,
      message: l10n.serialSearchIdleMessage,
    );
  }
}

class _FoundResult extends StatelessWidget {
  const _FoundResult({
    required this.state,
    required this.onInspect,
    required this.onMarkScrap,
    required this.onUndoScrap,
  });

  final SerialSearchState state;
  final ValueChanged<TyreLookupRecord> onInspect;
  final ValueChanged<TyreLookupRecord> onMarkScrap;
  final VoidCallback onUndoScrap;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TyreLookupRecord tyre = state.tyre!;
    final String? lastReading = _lastReadingLabel(l10n, tyre);

    return TpCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: TpTyreChip(
                  data: TpTyreChipData(
                    position: tyre.bestPosition ?? '-',
                    serial: state.resolvedSerial,
                    detail: lastReading,
                    // Unknown, not neutral: this lookup carries no
                    // condition/risk rating, only a status about being
                    // scrapped. "unknown" says honestly that nobody
                    // measured this tyre's condition here.
                    status:
                        state.isScrapped ? TpStatus.critical : TpStatus.unknown,
                  ),
                ),
              ),
              if (state.isScrapped)
                TpStatusChip(
                  status: TpStatus.critical,
                  label: l10n.serialSearchScrappedBadge,
                ),
            ],
          ),
          const SizedBox(height: TpSpace.md),
          Text(
            l10n.serialSearchFound,
            style: Theme.of(context).textTheme.labelMedium,
          ),
          const SizedBox(height: TpSpace.sm),
          Wrap(
            spacing: TpSpace.md,
            runSpacing: TpSpace.sm,
            children: <Widget>[
              _Detail(label: l10n.serialSearchBrand, value: tyre.brand),
              _Detail(label: l10n.serialSearchSize, value: tyre.size),
              _Detail(
                label: l10n.serialSearchPosition,
                value: tyre.bestPosition,
                isIdentifier: true,
              ),
              _Detail(
                label: l10n.serialSearchAsset,
                value: tyre.assetNo,
                isIdentifier: true,
              ),
              _Detail(label: l10n.serialSearchSite, value: tyre.site),
              _Detail(label: l10n.serialSearchLastReading, value: lastReading),
            ],
          ),
          if (state.scrapMark?.reason != null) ...<Widget>[
            const SizedBox(height: TpSpace.sm),
            Text(
              '${l10n.serialSearchScrapReasonLabel}: '
              '${state.scrapMark!.reason}',
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ],
          const SizedBox(height: TpSpace.lg),
          if (tyre.assetNo != null)
            TpButton.primary(
              label: l10n.serialSearchInspectThis,
              icon: Icons.assignment_outlined,
              isFullWidth: true,
              onPressed: () => onInspect(tyre),
            )
          else
            _NoAssetNote(
              message: l10n.serialSearchNoAssetNote,
              palette: palette,
            ),
          const SizedBox(height: TpSpace.sm),
          if (state.offerUnscrap)
            TpButton.secondary(
              label: l10n.serialSearchUndoScrap,
              icon: Icons.undo,
              isFullWidth: true,
              isBusy: state.isUnscrapBusy,
              onPressed: state.isUnscrapBusy ? null : onUndoScrap,
            )
          else if (state.offerScrap)
            TpButton.danger(
              label: l10n.serialSearchMarkScrap,
              icon: Icons.block,
              isFullWidth: true,
              isBusy: state.isScrapBusy,
              onPressed: state.isScrapBusy ? null : () => onMarkScrap(tyre),
            ),
        ],
      ),
    );
  }

  static String? _lastReadingLabel(
    AppLocalizations l10n,
    TyreLookupRecord tyre,
  ) {
    if (tyre.treadDepth != null) return '${tyre.treadDepth} mm';
    if (tyre.pressureReading != null) return '${tyre.pressureReading} PSI';
    return null;
  }
}

class _Detail extends StatelessWidget {
  const _Detail({
    required this.label,
    required this.value,
    this.isIdentifier = false,
  });

  final String label;
  final String? value;
  final bool isIdentifier;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final String display = value ?? l10n.valueNotMeasured;

    return SizedBox(
      width: 150,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text(label, style: text.labelSmall),
          if (isIdentifier)
            TpIdentifierText(display, style: text.bodyLarge)
          else
            Text(display, style: text.bodyLarge),
        ],
      ),
    );
  }
}

class _NoAssetNote extends StatelessWidget {
  const _NoAssetNote({required this.message, required this.palette});

  final String message;
  final TpPalette palette;

  @override
  Widget build(BuildContext context) {
    final TpStatusColors colors = palette.forStatus(TpStatus.warning);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.soft,
        borderRadius: BorderRadius.circular(TpRadius.md),
      ),
      child: Padding(
        padding: const EdgeInsets.all(TpSpace.md),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Icon(
              Icons.info_outline,
              size: TpSizing.iconMd,
              color: colors.onSoft,
            ),
            const SizedBox(width: TpSpace.sm),
            Expanded(
              child: Text(
                message,
                style: Theme.of(context)
                    .textTheme
                    .bodyMedium
                    ?.copyWith(color: colors.onSoft),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The reason-capture sheet for marking a tyre scrapped.
///
/// The sheet itself is the confirmation step: it demands a deliberate,
/// separate tap on Confirm after opening, rather than acting the moment the
/// Mark-as-scrap button is pressed - a hard-to-reverse action must not be one
/// tap away from an accidental press.
class _ScrapReasonSheet {
  const _ScrapReasonSheet._();

  /// Shows the sheet. Resolves to the entered reason (possibly empty) when
  /// the user confirms, or null when the sheet is dismissed without
  /// confirming.
  static Future<String?> show(BuildContext context) {
    final TextEditingController reasonController = TextEditingController();
    final AppLocalizations l10n = AppLocalizations.of(context);

    return TpBottomSheet.show<String>(
      context: context,
      title: l10n.serialSearchScrapModalTitle,
      builder: (BuildContext sheetContext) {
        return Padding(
          padding: const EdgeInsets.symmetric(horizontal: TpSpace.xl),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              TpInput(
                label: l10n.serialSearchScrapReasonLabel,
                controller: reasonController,
                hint: l10n.serialSearchScrapReasonPlaceholder,
                maxLines: 3,
              ),
              const SizedBox(height: TpSpace.lg),
              TpButton.danger(
                label: l10n.serialSearchConfirmScrap,
                icon: Icons.block,
                isFullWidth: true,
                onPressed: () {
                  Navigator.of(sheetContext).pop(reasonController.text);
                },
              ),
            ],
          ),
        );
      },
    ).whenComplete(reasonController.dispose);
  }
}
