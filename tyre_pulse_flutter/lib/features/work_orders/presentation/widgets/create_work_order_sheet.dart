/// "New work order" - the create form, opened as a [TpBottomSheet] from
/// [WorkOrdersListScreen]'s app bar.
///
/// Mirrors the reference screen's own shape (`mobile/app/(app)/
/// work-orders.tsx` opens this exact form inside a slide-up `Modal`) while
/// using this codebase's own established primitive for a sheet-hosted form
/// rather than the reference's bespoke one - the SAME substitution
/// `WashingScreen`'s own `_openRecentWashes` already makes for a *viewing*
/// sheet, applied here to a *creating* one. There is no dedicated route for
/// "new work order" in `routes.dart` (only [WorkOrdersRoute], the list, and
/// [WorkOrderDetailRoute], which REQUIRES a [WorkOrderId] and therefore
/// cannot address a not-yet-created row) - adding one would have meant
/// editing that file, which this phase's brief is explicit is out of
/// scope. A [TpBottomSheet] is deliberately NOT a route either
/// (`tp_bottom_sheet.dart`'s own library comment), so creation stays fully
/// on the existing [WorkOrdersRoute] screen without inventing a route this
/// phase has no authority to declare.
///
/// # A debounced asset lookup that only INFORMS, and never auto-fills
///
/// The reference create form has NO asset lookup at all - it is a bare
/// text field. This sheet adds one, matching this codebase's own
/// established convention (`WashingScreen`/`MeterLogScreen` both debounce
/// 350ms onto `VehicleFleetRepository.byAssetNo` and show what they found),
/// as a disclosed, deliberate addition: it helps a technician confirm they
/// typed the right asset code before logging a job against it, which is a
/// real, low-risk data-quality improvement over the reference. It does
/// NOT change [CreateWorkOrderInput.assetNo] or auto-fill anything from
/// the vehicle record - the reference's own business rule, preserved here,
/// is that a work order's `site`/`country`/`technician_name` come from the
/// SIGNED-IN USER'S own workspace context, never from the asset being
/// worked on (`WorkOrderRepository.create`'s own doc comment).
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_fleet_providers.dart';
import 'package:tyre_pulse/features/work_orders/data/work_order_repository.dart';
import 'package:tyre_pulse/features/work_orders/domain/work_order_status.dart';
import 'package:tyre_pulse/features/work_orders/presentation/widgets/work_order_badges.dart';

const Duration _kLookupDebounce = Duration(milliseconds: 350);

/// Shows the sheet. Resolves to `true` when a work order was queued,
/// `false`/`null` when the sheet was dismissed without saving - the caller
/// (`WorkOrdersListScreen`) reloads the list only on `true`.
Future<bool?> showCreateWorkOrderSheet(BuildContext context) {
  final AppLocalizations l10n = AppLocalizations.of(context);
  return TpBottomSheet.show<bool>(
    context: context,
    title: l10n.workOrderNewTitle,
    builder: (BuildContext sheetContext) => const CreateWorkOrderSheet(),
  );
}

class CreateWorkOrderSheet extends ConsumerStatefulWidget {
  const CreateWorkOrderSheet({super.key});

  @override
  ConsumerState<CreateWorkOrderSheet> createState() =>
      _CreateWorkOrderSheetState();
}

class _CreateWorkOrderSheetState extends ConsumerState<CreateWorkOrderSheet> {
  final TextEditingController _assetController = TextEditingController();
  final TextEditingController _descriptionController = TextEditingController();

  String _workType = kWorkOrderDefaultWorkType;
  String _priority = kWorkOrderDefaultPriority;

  Timer? _lookupDebounce;
  VehicleAsset? _foundAsset;
  bool _saving = false;
  String? _assetError;

  @override
  void initState() {
    super.initState();
    _assetController.addListener(_onAssetChanged);
  }

  @override
  void dispose() {
    _lookupDebounce?.cancel();
    _assetController.removeListener(_onAssetChanged);
    _assetController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  void _onAssetChanged() {
    _lookupDebounce?.cancel();
    if (_assetError != null) setState(() => _assetError = null);
    final String asset = _assetController.text.trim();
    if (asset.isEmpty) {
      setState(() => _foundAsset = null);
      return;
    }
    _lookupDebounce = Timer(
      _kLookupDebounce,
      () => unawaited(_performLookup(asset)),
    );
  }

  Future<void> _performLookup(String asset) async {
    final WorkspaceContext? workspace = ref.read(workspaceContextProvider);
    final VehicleDetailOutcome outcome = await ref
        .read(vehicleFleetRepositoryProvider)
        .byAssetNo(
          scope: vehicleCacheScopeFor(workspace),
          assetNo: asset,
          country: workspace?.activeCountry,
        );

    if (!mounted) return;
    if (_assetController.text.trim() != asset) return;

    VehicleAsset? resolved;
    if (outcome is VehicleDetailLoaded) {
      resolved = outcome.asset;
    } else if (outcome is VehicleDetailFromCache) {
      resolved = outcome.asset;
    }
    setState(() => _foundAsset = resolved);
  }

  Future<void> _submit() async {
    if (_saving) return;
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String asset = _assetController.text.trim();
    if (asset.isEmpty) {
      setState(() => _assetError = l10n.workOrderAssetRequiredMessage);
      return;
    }

    final WorkspaceContext? workspace = ref.read(workspaceContextProvider);
    if (workspace == null) {
      _showSnack(l10n.workOrderWorkspaceLoadingMessage);
      return;
    }

    setState(() => _saving = true);
    try {
      await ref
          .read(workOrderRepositoryProvider)
          .create(
            workspace: workspace,
            input: CreateWorkOrderInput(
              assetNo: asset,
              workType: _workType,
              priority: _priority,
              description: _descriptionController.text,
            ),
          );
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on Object {
      if (!mounted) return;
      _showSnack(l10n.workOrderSaveFailedMessage);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _showSnack(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);

    return SingleChildScrollView(
      padding: EdgeInsets.only(
        left: TpSpace.xl,
        right: TpSpace.xl,
        bottom: TpSpace.xl + MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          TpInput(
            label: l10n.workOrderAssetLabel,
            controller: _assetController,
            hint: l10n.workOrderAssetHint,
            textCapitalization: TextCapitalization.characters,
            isRequired: true,
            errorText: _assetError,
          ),
          if (_foundAsset != null) ...<Widget>[
            const SizedBox(height: TpSpace.sm),
            _FoundAssetLine(asset: _foundAsset!),
          ],
          const SizedBox(height: TpSpace.md),
          TpDropdown<String>(
            label: l10n.workOrderWorkTypeLabel,
            value: _workType,
            isRequired: true,
            items: <TpDropdownItem<String>>[
              for (final String type in kWorkOrderWorkTypes)
                TpDropdownItem<String>(
                  value: type,
                  label: workOrderWorkTypeOptionLabel(l10n, type),
                ),
            ],
            onChanged: (String? value) =>
                setState(() => _workType = value ?? kWorkOrderDefaultWorkType),
          ),
          const SizedBox(height: TpSpace.md),
          TpDropdown<String>(
            label: l10n.workOrderPriorityLabel,
            value: _priority,
            isRequired: true,
            items: <TpDropdownItem<String>>[
              for (final String priority in kWorkOrderPriorities)
                TpDropdownItem<String>(
                  value: priority,
                  label: workOrderPriorityOptionLabel(l10n, priority),
                ),
            ],
            onChanged: (String? value) =>
                setState(() => _priority = value ?? kWorkOrderDefaultPriority),
          ),
          const SizedBox(height: TpSpace.md),
          TpInput(
            label: l10n.workOrderDescriptionLabel,
            controller: _descriptionController,
            hint: l10n.workOrderDescriptionHint,
            maxLines: 3,
            textCapitalization: TextCapitalization.sentences,
          ),
          const SizedBox(height: TpSpace.xl),
          TpButton.primary(
            label: l10n.workOrderCreateAction,
            icon: Icons.add_task,
            isBusy: _saving,
            isFullWidth: true,
            onPressed: _saving ? null : _submit,
          ),
        ],
      ),
    );
  }
}

class _FoundAssetLine extends StatelessWidget {
  const _FoundAssetLine({required this.asset});

  final VehicleAsset asset;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final String joinedMakeModel = <String?>[
      asset.make,
      asset.model,
    ].where((String? v) => v != null && v.trim().isNotEmpty).join(' ');

    final List<String> parts = <String>[
      if (asset.vehicleType != null && asset.vehicleType!.trim().isNotEmpty)
        asset.vehicleType!,
      if (joinedMakeModel.isNotEmpty) joinedMakeModel,
      if (asset.site != null && asset.site!.trim().isNotEmpty) asset.site!,
    ];
    if (parts.isEmpty) return const SizedBox.shrink();

    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: TpSpace.md,
        vertical: TpSpace.sm,
      ),
      decoration: BoxDecoration(
        color: palette.info.soft,
        borderRadius: BorderRadius.circular(TpRadius.md),
        border: Border.all(color: palette.info.base),
      ),
      child: Row(
        children: <Widget>[
          Icon(
            Icons.check_circle_outline,
            size: TpSizing.iconSm,
            color: palette.info.onSoft,
          ),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Text(
              parts.join(' · '),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: palette.info.onSoft,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
