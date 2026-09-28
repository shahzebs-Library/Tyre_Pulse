/// Repair Request (RFR) form (`/repair-request`, [RepairRequestRoute]).
///
/// Ported from `mobile/app/(app)/repair-request.tsx`: a driver reports a
/// fault BEFORE any job card exists; the workshop later converts it. This is
/// NOT the Report Issue flow (that writes `corrective_actions`); it writes
/// `repair_requests` (V608).
///
/// Layout follows the capture-form archetype: identify the machine first so
/// the register fills in what it knows, then the fault, then optional meter
/// readings, then one dominant submit.
///
/// ONLINE-ONLY by declaration: see `repair_request_repository.dart`. The form
/// keeps every value on failure so a retry costs nothing, and the server
/// issues the RFR number - the phone never prints an invented one.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_fleet_providers.dart';
import 'package:tyre_pulse/features/extras/data/repair_request_repository.dart';
import 'package:tyre_pulse/features/extras/domain/repair_request.dart';
import 'package:tyre_pulse/features/extras/extras_providers.dart';
import 'package:uuid/uuid.dart';

/// Stable keys for tests.
abstract final class RepairRequestKeys {
  static const Key chooseAsset = Key('repairReq.chooseAsset');
  static const Key description = Key('repairReq.description');
  static const Key site = Key('repairReq.site');
  static const Key odometer = Key('repairReq.odometer');
  static const Key engineHours = Key('repairReq.engineHours');
  static const Key submit = Key('repairReq.submit');
  static const Key success = Key('repairReq.success');
  static const Key error = Key('repairReq.error');
  static Key category(String token) => Key('repairReq.category.$token');
  static Key priority(String token) => Key('repairReq.priority.$token');
}

/// Localized label for a fault category token.
String repairFaultCategoryLabel(AppLocalizations l10n, String token) {
  switch (token) {
    case 'Engine':
      return l10n.repairReqCatEngine;
    case 'Transmission':
      return l10n.repairReqCatTransmission;
    case 'Brakes':
      return l10n.repairReqCatBrakes;
    case 'Tyres':
      return l10n.repairReqCatTyres;
    case 'Hydraulics':
      return l10n.repairReqCatHydraulics;
    case 'Electrical':
      return l10n.repairReqCatElectrical;
    case 'Body':
      return l10n.repairReqCatBody;
    case 'Drum/Mixer':
      return l10n.repairReqCatDrumMixer;
    case 'Pump':
      return l10n.repairReqCatPump;
    case 'Air System':
      return l10n.repairReqCatAirSystem;
    case 'Cooling':
      return l10n.repairReqCatCooling;
    default:
      return l10n.repairReqCatOther;
  }
}

String _priorityLabel(AppLocalizations l10n, String token) {
  switch (token) {
    case 'Low':
      return l10n.workOrderPriorityLow;
    case 'High':
      return l10n.workOrderPriorityHigh;
    case 'Critical':
      return l10n.workOrderPriorityCritical;
    default:
      return l10n.workOrderPriorityMedium;
  }
}

class RepairRequestScreen extends ConsumerStatefulWidget {
  const RepairRequestScreen({required this.route, super.key});

  final RepairRequestRoute route;

  @override
  ConsumerState<RepairRequestScreen> createState() =>
      _RepairRequestScreenState();
}

class _RepairRequestScreenState extends ConsumerState<RepairRequestScreen> {
  final TextEditingController _description = TextEditingController();
  final TextEditingController _site = TextEditingController();
  final TextEditingController _odometer = TextEditingController();
  final TextEditingController _engineHours = TextEditingController();

  /// One id per attempt, kept across retries so a lost response cannot
  /// create a second request. Renewed only after a confirmed submit.
  String _clientUuid = const Uuid().v4();

  String? _assetNo;
  VehicleAsset? _asset;
  String? _category;
  String _priority = kRepairDefaultPriority;
  bool _submitting = false;
  bool _showProblems = false;
  String? _error;
  RepairRequestReceipt? _receipt;

  @override
  void initState() {
    super.initState();
    final String? routeAsset = widget.route.assetNo?.value.trim();
    final String? routeSite = widget.route.siteName?.value.trim();
    if (routeSite != null && routeSite.isNotEmpty) _site.text = routeSite;
    if (routeAsset != null && routeAsset.isNotEmpty) {
      _assetNo = routeAsset;
      WidgetsBinding.instance
          .addPostFrameCallback((_) => unawaited(_resolveRouteAsset()));
    } else if (_site.text.isEmpty) {
      _site.text = ref.read(workspaceContextProvider)?.legacySite ?? '';
    }
  }

  @override
  void dispose() {
    _description.dispose();
    _site.dispose();
    _odometer.dispose();
    _engineHours.dispose();
    super.dispose();
  }

  /// A deep link names an asset: fill in what the register knows about it.
  /// A failed or empty lookup leaves the typed asset number in place.
  Future<void> _resolveRouteAsset() async {
    final String? assetNo = _assetNo;
    if (assetNo == null) return;
    try {
      final WorkspaceContext? workspace = ref.read(workspaceContextProvider);
      final VehicleDetailOutcome outcome =
          await ref.read(vehicleFleetRepositoryProvider).byAssetNo(
                scope: null,
                assetNo: assetNo,
                country: workspace?.activeCountry,
              );
      final VehicleAsset? asset = switch (outcome) {
        VehicleDetailLoaded(:final VehicleAsset asset) => asset,
        VehicleDetailFromCache(:final VehicleAsset asset) => asset,
        _ => null,
      };
      if (asset != null && mounted) _applyAsset(asset);
    } on Object {
      // The asset number itself is still valid input; details stay blank.
    }
  }

  void _applyAsset(VehicleAsset asset) {
    setState(() {
      _asset = asset;
      _assetNo = asset.assetNo;
      final String site = (asset.site ?? '').trim();
      // The picked machine's registered site replaces the default, but a
      // site given by the route (the caller knew it) is kept.
      if (site.isNotEmpty && widget.route.siteName == null) {
        _site.text = site;
      }
    });
  }

  Future<void> _pickAsset() async {
    final VehicleAsset? picked = await TpBottomSheet.show<VehicleAsset>(
      context: context,
      title: AppLocalizations.of(context).repairReqChooseAsset,
      builder: (BuildContext context) => const _AssetPickerSheet(),
    );
    if (picked != null && mounted) _applyAsset(picked);
  }

  RepairRequestDraft _draft() => RepairRequestDraft(
        assetNo: _assetNo ?? '',
        description: _description.text,
        site: _site.text,
        plateNo: _asset?.registrationNo,
        assetDescription: composeAssetDescription(
          vehicleType: _asset?.vehicleType,
          make: _asset?.make,
          model: _asset?.model,
        ),
        faultCategory: _category,
        priority: _priority,
        odometer: _odometer.text,
        engineHours: _engineHours.text,
      );

  Future<void> _submit() async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final RepairRequestDraft draft = _draft();
    if (validateRepairRequest(draft).isNotEmpty) {
      setState(() => _showProblems = true);
      return;
    }
    final WorkspaceContext? workspace = ref.read(workspaceContextProvider);
    if (workspace == null) {
      setState(() => _error = l10n.repairReqErrNoProfile);
      return;
    }
    // A request must carry a country: `repair_requests` RLS shows a
    // country-less row to the whole organisation. Prefer the workspace
    // country, then the picked machine's own country (it was read under the
    // user's country scope), then a single-country user's only country.
    final List<String> named = workspace.countryScope.namedCountries;
    final String? assetCountry = _asset?.country?.trim();
    final String? country = workspace.activeCountry ??
        ((assetCountry?.isNotEmpty ?? false) ? assetCountry : null) ??
        (named.length == 1 ? named.first : null);
    if (country == null) {
      // Multi-country user in the all-countries view with a machine whose
      // country is unknown: ask them to pick the machine from the list.
      setState(() => _error = l10n.repairReqErrAsset);
      return;
    }
    final RepairRequestReporter reporter = RepairRequestReporter(
      userId: workspace.userId,
      fullName: workspace.fullName,
      employeeId: workspace.employeeId,
      country: country,
      legacySite: workspace.legacySite,
    );
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final RepairRequestReceipt receipt =
          await ref.read(repairRequestRepositoryProvider).submit(
                buildRepairRequestRow(
                  draft: draft,
                  reporter: reporter,
                  clientUuid: _clientUuid,
                ),
              );
      if (!mounted) return;
      setState(() => _receipt = receipt);
    } on SupabaseFailure catch (failure) {
      if (!mounted) return;
      setState(() {
        _error = failure.isConnectivity
            ? l10n.repairReqErrOffline
            : failure.isPermissionDenied
                ? l10n.repairReqErrPermission
                : l10n.repairReqErrFailed;
      });
    } on Object {
      if (mounted) setState(() => _error = l10n.repairReqErrFailed);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  void _startAnother() {
    setState(() {
      _receipt = null;
      _clientUuid = const Uuid().v4();
      _description.clear();
      _odometer.clear();
      _engineHours.clear();
      _category = null;
      _priority = kRepairDefaultPriority;
      _showProblems = false;
      _error = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String fallback = TpBackFallbacks.forRoute(widget.route);
    final RepairRequestReceipt? receipt = _receipt;

    return TpScaffold(
      backFallback: fallback,
      appBar: TpAppBar(
        title: l10n.repairReqTitle,
        subtitle: l10n.repairReqSubtitle,
        backFallback: fallback,
      ),
      body: receipt != null
          ? TpStateView(
              key: RepairRequestKeys.success,
              icon: Icons.check_circle_outline,
              tone: TpStatus.ok,
              title: l10n.repairReqSentTitle,
              message: receipt.rfrNo == null
                  ? l10n.repairReqSentNoNumber
                  : l10n.repairReqSentWithNumber(receipt.rfrNo!),
              primaryActionLabel: l10n.repairReqAnother,
              onPrimaryAction: _startAnother,
              secondaryActionLabel: l10n.repairReqDone,
              onSecondaryAction: () => context.go(fallback),
            )
          : _buildForm(context, l10n),
    );
  }

  Widget _buildForm(BuildContext context, AppLocalizations l10n) {
    final List<RepairRequestProblem> problems =
        _showProblems ? validateRepairRequest(_draft()) : const [];
    final TextTheme text = Theme.of(context).textTheme;
    final TpPalette palette = TpPalette.of(context);
    final VehicleAsset? asset = _asset;
    final String? assetNo = _assetNo;

    Widget label(String value) => Padding(
          padding: const EdgeInsets.only(bottom: TpSpace.sm),
          child: Text(value, style: text.titleSmall),
        );

    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(
        TpSpace.lg,
        TpSpace.lg,
        TpSpace.lg,
        TpSpace.xxxl,
      ),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 720),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              label(l10n.repairReqMachine),
              TpCard(
                key: RepairRequestKeys.chooseAsset,
                onTap: _submitting ? null : () => unawaited(_pickAsset()),
                borderColor:
                    problems.contains(RepairRequestProblem.assetMissing)
                        ? palette.forStatus(TpStatus.critical).base
                        : null,
                child: Row(
                  children: <Widget>[
                    Icon(Icons.local_shipping_outlined, color: palette.primary),
                    const SizedBox(width: TpSpace.md),
                    Expanded(
                      child: assetNo == null
                          ? Text(l10n.repairReqChooseAsset)
                          : Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: <Widget>[
                                Text(assetNo, style: text.titleMedium),
                                if (composeAssetDescription(
                                      vehicleType: asset?.vehicleType,
                                      make: asset?.make,
                                      model: asset?.model,
                                    ) !=
                                    null)
                                  Text(
                                    composeAssetDescription(
                                      vehicleType: asset?.vehicleType,
                                      make: asset?.make,
                                      model: asset?.model,
                                    )!,
                                    style: text.bodySmall,
                                  ),
                                if ((asset?.registrationNo ?? '').isNotEmpty)
                                  Text(
                                    l10n.repairReqPlate(asset!.registrationNo!),
                                    style: text.bodySmall,
                                  ),
                              ],
                            ),
                    ),
                    Text(
                      assetNo == null
                          ? l10n.repairReqSelect
                          : l10n.repairReqChange,
                      style: text.labelLarge?.copyWith(color: palette.primary),
                    ),
                  ],
                ),
              ),
              if (problems.contains(RepairRequestProblem.assetMissing))
                _ProblemText(l10n.repairReqErrAsset),
              const SizedBox(height: TpSpace.lg),
              TpInput(
                key: RepairRequestKeys.site,
                label: l10n.repairReqSite,
                hint: l10n.repairReqSiteHint,
                controller: _site,
                enabled: !_submitting,
              ),
              const SizedBox(height: TpSpace.lg),
              label(l10n.repairReqCategory),
              Wrap(
                spacing: TpSpace.sm,
                runSpacing: TpSpace.sm,
                children: <Widget>[
                  for (final String token in kRepairFaultCategories)
                    ChoiceChip(
                      key: RepairRequestKeys.category(token),
                      label: Text(repairFaultCategoryLabel(l10n, token)),
                      selected: _category == token,
                      onSelected: _submitting
                          ? null
                          : (bool on) =>
                              setState(() => _category = on ? token : null),
                    ),
                ],
              ),
              const SizedBox(height: TpSpace.lg),
              TpInput(
                key: RepairRequestKeys.description,
                label: l10n.repairReqDescription,
                hint: l10n.repairReqDescriptionHint,
                controller: _description,
                isRequired: true,
                maxLines: 5,
                maxLength: 2000,
                enabled: !_submitting,
                textCapitalization: TextCapitalization.sentences,
                errorText:
                    problems.contains(RepairRequestProblem.descriptionMissing)
                        ? l10n.repairReqErrDescription
                        : null,
              ),
              const SizedBox(height: TpSpace.lg),
              label(l10n.repairReqPriority),
              Wrap(
                spacing: TpSpace.sm,
                runSpacing: TpSpace.sm,
                children: <Widget>[
                  for (final String token in kRepairPriorities)
                    ChoiceChip(
                      key: RepairRequestKeys.priority(token),
                      label: Text(_priorityLabel(l10n, token)),
                      selected: _priority == token,
                      onSelected: _submitting
                          ? null
                          : (_) => setState(() => _priority = token),
                    ),
                ],
              ),
              const SizedBox(height: TpSpace.lg),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Expanded(
                    child: TpInput(
                      key: RepairRequestKeys.odometer,
                      label: l10n.repairReqOdometer,
                      hint: l10n.repairReqOptional,
                      controller: _odometer,
                      enabled: !_submitting,
                      keyboardType: const TextInputType.numberWithOptions(
                        decimal: true,
                      ),
                      errorText: problems
                              .contains(RepairRequestProblem.odometerInvalid)
                          ? l10n.repairReqErrMeter
                          : null,
                    ),
                  ),
                  const SizedBox(width: TpSpace.md),
                  Expanded(
                    child: TpInput(
                      key: RepairRequestKeys.engineHours,
                      label: l10n.repairReqEngineHours,
                      hint: l10n.repairReqOptional,
                      controller: _engineHours,
                      enabled: !_submitting,
                      keyboardType: const TextInputType.numberWithOptions(
                        decimal: true,
                      ),
                      errorText: problems
                              .contains(RepairRequestProblem.engineHoursInvalid)
                          ? l10n.repairReqErrMeter
                          : null,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: TpSpace.lg),
              Text(
                l10n.repairReqOnlineNote,
                style: text.bodySmall?.copyWith(color: palette.textMuted),
              ),
              if (_error != null) ...<Widget>[
                const SizedBox(height: TpSpace.md),
                TpCard(
                  key: RepairRequestKeys.error,
                  background: palette.forStatus(TpStatus.critical).soft,
                  child: Text(_error!),
                ),
              ],
              const SizedBox(height: TpSpace.xl),
              TpButton.primary(
                key: RepairRequestKeys.submit,
                label: l10n.repairReqSubmit,
                icon: Icons.send_outlined,
                isBusy: _submitting,
                isFullWidth: true,
                onPressed: _submitting ? null : () => unawaited(_submit()),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ProblemText extends StatelessWidget {
  const _ProblemText(this.message);

  final String message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: TpSpace.xs),
      child: Text(
        message,
        style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: TpPalette.of(context).forStatus(TpStatus.critical).base,
            ),
      ),
    );
  }
}

/// Search the fleet register and pick one machine. Reuses the shared
/// [VehicleFleetRepository] and its RN-parity [applyVehicleFilters] search,
/// so a machine findable on the Vehicles screen is findable here.
class _AssetPickerSheet extends ConsumerStatefulWidget {
  const _AssetPickerSheet();

  @override
  ConsumerState<_AssetPickerSheet> createState() => _AssetPickerSheetState();
}

class _AssetPickerSheetState extends ConsumerState<_AssetPickerSheet> {
  static const int _shown = 60;

  VehicleFleetListOutcome? _outcome;
  String _term = '';

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    setState(() => _outcome = null);
    final WorkspaceContext? workspace = ref.read(workspaceContextProvider);
    final VehicleFleetListOutcome outcome =
        await ref.read(vehicleFleetRepositoryProvider).loadAll(
              scope: null,
              country: workspace?.activeCountry,
            );
    if (mounted) setState(() => _outcome = outcome);
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final VehicleFleetListOutcome? outcome = _outcome;
    final double height = MediaQuery.sizeOf(context).height * 0.75;

    final Widget body;
    if (outcome == null) {
      body = const TpLoadingState();
    } else if (outcome is VehicleFleetListFailed) {
      body =
          TpErrorState(error: outcome.error, onRetry: () => unawaited(_load()));
    } else {
      final List<VehicleAsset> all = switch (outcome) {
        VehicleFleetListLoaded(:final List<VehicleAsset> assets) => assets,
        VehicleFleetListFromCache(:final List<VehicleAsset> assets) => assets,
        VehicleFleetListFailed() => const <VehicleAsset>[],
      };
      final List<VehicleAsset> matches = applyVehicleFilters(
        all,
        searchTerm: _term,
      )
          .where((VehicleAsset a) => (a.assetNo ?? '').trim().isNotEmpty)
          .toList(growable: false);
      if (all.isEmpty) {
        body = TpEmptyState(message: l10n.repairReqNoAssets);
      } else if (matches.isEmpty) {
        body = TpEmptyState(message: l10n.repairReqNoMatch);
      } else {
        final int count = matches.length < _shown ? matches.length : _shown;
        body = ListView.builder(
          itemCount: count + (matches.length > _shown ? 1 : 0),
          itemBuilder: (BuildContext context, int index) {
            if (index == count) {
              return Padding(
                padding: const EdgeInsets.all(TpSpace.md),
                child: Text(l10n.repairReqRefineSearch(matches.length)),
              );
            }
            final VehicleAsset asset = matches[index];
            final String? detail = composeAssetDescription(
              vehicleType: asset.vehicleType,
              make: asset.make,
              model: asset.model,
            );
            return ListTile(
              leading: const Icon(Icons.local_shipping_outlined),
              title: Text(asset.assetNo!),
              subtitle: Text(
                <String>[
                  if (detail != null) detail,
                  if ((asset.site ?? '').isNotEmpty) asset.site!,
                ].join(' | '),
              ),
              onTap: () => Navigator.pop(context, asset),
            );
          },
        );
      }
    }

    return SizedBox(
      height: height,
      child: Column(
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.all(TpSpace.lg),
            child: TpSearchField(
              hint: l10n.repairReqSearchHint,
              autofocus: true,
              onChanged: (String value) => setState(() => _term = value),
            ),
          ),
          if (outcome is VehicleFleetListFromCache)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: TpSpace.lg),
              child: Text(l10n.repairReqCachedList),
            ),
          Expanded(child: body),
        ],
      ),
    );
  }
}
