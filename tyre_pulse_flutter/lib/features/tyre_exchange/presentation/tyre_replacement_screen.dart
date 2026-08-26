/// Tyre Replacement entry screen.
///
/// Ported from `mobile/app/(app)/tyre-change.tsx` (`mobile/` is READ-ONLY
/// reference material - see `AGENTS.md` rule "Never edit them from this
/// project"). That screen is a single form: pick the asset, pick a
/// position, describe the new tyre, and submit ONE offline-queued
/// `TYRE_CHANGE` command. See `data/tyre_replacement_repository.dart`'s own
/// library comment for the exact write shape and why it is one insert, not
/// a multi-step transaction.
///
/// # Asset auto-fill is an ADDED capability, not a straight port
///
/// The reference screen makes NO Supabase calls at all - `assetNo` is a
/// plain text field with no lookup behind it. This port adds a debounced
/// lookup against `VehicleFleetRepository.byAssetNo`, mirroring
/// `WashingScreen`'s/`MeterLogScreen`'s own established pattern
/// (350ms after typing stops, matching those screens' debounce window)
/// exactly, per this phase's explicit brief. The looked-up
/// [VehicleAsset.vehicleType] then drives the position picker below - see
/// the next section - and [VehicleAsset.site] auto-fills the site field
/// exactly the way it does on those two sibling screens (only while the
/// field is still blank and the driver has not typed into it directly).
///
/// # The position picker offers the FULL per-vehicle-type set, not the
/// # reference's fixed nine-chip list
///
/// The reference screen's own `POSITIONS` constant is
/// `['FL','FR','RL','RR','RLO','RLI','RRO','RRI','Spare']` regardless of
/// what is being worked on - correct for a 4- or 6-wheel machine, silently
/// wrong (incomplete) for a Tri-mixer (12 positions) or a Concrete pump
/// (14), recoverable there only through the reference's own free-text
/// override field. `features/tyre_exchange/domain/
/// tyre_replacement_position.dart`'s own library comment records the full
/// reasoning for replacing that fixed list with
/// `tyreReplacementPositions(vehicleType, assetNo)` - the SAME, already
/// fully parity-tested per-vehicle-type engine `features/tyre_diagram`
/// already uses - once the asset resolves. Before it resolves (or when
/// nothing is typed yet), [tyreReplacementPositions] falls back to its own
/// neutral default (`resolveVehicleType`'s own `'Pickup'` fallback: FL,
/// FR, RL, RR, plus Spare), which is a safe, honest starting point rather
/// than an empty picker.
///
/// The FREE-TEXT override field the reference offers is preserved exactly:
/// [_positionController] is the single source of truth for the position
/// value - a chip tap simply writes into it, and typing directly still
/// works for any position the derived list does not happen to offer.
///
/// # The literal position VALUE is never translated
///
/// Every chip's code - a canonical GCC label like `LHF1`/`RHCO`, or the
/// literal `Spare` - is a technical identifier this app writes to a
/// database column, rendered through [TpTyreChip] (which already isolates
/// it left-to-right via `TpIdentifierText` - repository rule 10). None of
/// them appear in the localisation files.
///
/// # The save-outcome dialog mirrors the reference's own two-button Alert
///
/// `tyre-change.tsx`'s `submit()` ends with `Alert.alert(title, message,
/// [{ text: 'Add another', onPress: ... }, { text: 'Done', onPress: ...
/// backTo(router, '/(app)') }])`. This is a genuinely different, more
/// deliberate UX than `WashingScreen`'s/`MeterLogScreen`'s own plain
/// "saved" snackbar-and-reset, and per AGENTS.md's source-of-truth order
/// (verified RN production behaviour outranks this port's own established
/// conventions on a sibling feature) it is preserved: [TpDialog.confirm]
/// offers Add another (stay, reset most fields) and Done (leave via
/// [TpBack.pop]), following `inspection_approval_review_screen.dart`'s own
/// convention that the PRIMARY (filled) button is the one that leaves the
/// screen.
///
/// One disclosed, deliberate divergence from the reference's own reset
/// list: `tyre-change.tsx`'s "Add another" handler resets position, brand,
/// size, serial, cost, km, tread and photos but never clears the removal
/// -reason field - reading as an omission in the reference rather than a
/// considered choice, since every other single-tyre field IS cleared.
/// [_resetForm] also clears the removal reason, for the same reason a
/// carried-over reason from the PREVIOUS tyre would misdescribe the next
/// one. Asset and site are kept, matching the reference exactly: a fitter
/// commonly replaces several tyres on the same vehicle, at the same site,
/// in one sitting.
///
/// # No date shown - the reference has none either
///
/// Unlike `WashingScreen`/`MeterLogScreen`, `tyre-change.tsx` never shows a
/// "today, locked" indicator even though `fitment_date`/`issue_date` are
/// both silently stamped today - see `tyre_replacement_repository.dart`.
/// This screen does not invent one either.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/tp_back.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_fleet_providers.dart';
import 'package:tyre_pulse/features/tyre_exchange/data/tyre_replacement_photo_capture.dart';
import 'package:tyre_pulse/features/tyre_exchange/data/tyre_replacement_repository.dart';
import 'package:tyre_pulse/features/tyre_exchange/domain/tyre_replacement_position.dart';
import 'package:tyre_pulse/features/tyre_exchange/presentation/widgets/tyre_replacement_photo_gallery.dart';
import 'package:tyre_pulse/features/tyre_exchange/tyre_exchange_providers.dart';
import 'package:uuid/uuid.dart';

const Duration _kLookupDebounce = Duration(milliseconds: 350);

class TyreReplacementScreen extends ConsumerStatefulWidget {
  const TyreReplacementScreen({required this.route, super.key});

  /// Carries an optional `assetNo`, `siteName` and `tyrePosition` deep-link
  /// pre-fill - matches `params.asset`/`params.site`/`params.position` in
  /// the reference screen's own `useLocalSearchParams`.
  final TyreChangeRoute route;

  @override
  ConsumerState<TyreReplacementScreen> createState() =>
      _TyreReplacementScreenState();
}

class _TyreReplacementScreenState extends ConsumerState<TyreReplacementScreen> {
  static const Uuid _uuid = Uuid();

  final TextEditingController _assetController = TextEditingController();
  final TextEditingController _siteController = TextEditingController();
  final TextEditingController _positionController = TextEditingController();
  final TextEditingController _brandController = TextEditingController();
  final TextEditingController _sizeController = TextEditingController();
  final TextEditingController _serialController = TextEditingController();
  final TextEditingController _costController = TextEditingController();
  final TextEditingController _kmController = TextEditingController();
  final TextEditingController _treadController = TextEditingController();
  final TextEditingController _reasonController = TextEditingController();

  bool _siteTouched = false;
  Timer? _lookupDebounce;
  VehicleAsset? _master;
  final List<String> _photoPaths = <String>[];
  bool _capturingPhoto = false;
  bool _submitting = false;

  late String _sessionKey;

  @override
  void initState() {
    super.initState();
    _sessionKey = _uuid.v4();

    final String? routeAsset = widget.route.assetNo?.value;
    if (routeAsset != null && routeAsset.trim().isNotEmpty) {
      _assetController.text = routeAsset.trim();
    }

    final String? routeSite = widget.route.siteName?.value;
    final WorkspaceContext? workspace = ref.read(workspaceContextProvider);
    final String? legacySite = workspace?.legacySite?.trim();
    if (routeSite != null && routeSite.trim().isNotEmpty) {
      _siteController.text = routeSite.trim();
      _siteTouched = true;
    } else if (legacySite != null && legacySite.isNotEmpty) {
      _siteController.text = legacySite;
      _siteTouched = true;
    }

    final String? routePosition = widget.route.tyrePosition?.value;
    if (routePosition != null && routePosition.trim().isNotEmpty) {
      _positionController.text = routePosition.trim();
    }

    _assetController.addListener(_onAssetChanged);
    // Rebuilds so the chip row's highlighted state and the Save button's
    // enablement track the text field live, including a programmatic set
    // from a chip tap (which does not fire TextField.onChanged).
    _positionController.addListener(_onPositionChanged);
    if (_assetController.text.trim().isNotEmpty) {
      _onAssetChanged();
    }
  }

  @override
  void dispose() {
    _lookupDebounce?.cancel();
    _assetController.removeListener(_onAssetChanged);
    _positionController.removeListener(_onPositionChanged);
    _assetController.dispose();
    _siteController.dispose();
    _positionController.dispose();
    _brandController.dispose();
    _sizeController.dispose();
    _serialController.dispose();
    _costController.dispose();
    _kmController.dispose();
    _treadController.dispose();
    _reasonController.dispose();
    super.dispose();
  }

  void _onAssetChanged() {
    _lookupDebounce?.cancel();
    final String asset = _assetController.text.trim();
    if (asset.isEmpty) {
      setState(() => _master = null);
      return;
    }
    _lookupDebounce = Timer(
      _kLookupDebounce,
      () => unawaited(_performLookup(asset)),
    );
  }

  void _onPositionChanged() {
    if (mounted) setState(() {});
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
    // A stale response for an asset the field worker has since changed away
    // from must never overwrite the panel, the position list or the site
    // field for the CURRENT one.
    if (_assetController.text.trim() != asset) return;

    VehicleAsset? resolved;
    if (outcome is VehicleDetailLoaded) {
      resolved = outcome.asset;
    } else if (outcome is VehicleDetailFromCache) {
      resolved = outcome.asset;
    }

    setState(() => _master = resolved);

    if (resolved == null) return;

    final String? masterSite = resolved.site?.trim();
    if (masterSite != null &&
        masterSite.isNotEmpty &&
        !_siteTouched &&
        _siteController.text.trim().isEmpty) {
      _siteController.text = masterSite;
    }
  }

  void _onSiteEdited(String _) {
    _siteTouched = true;
  }

  void _selectPosition(String code) {
    _positionController.text = code;
    // The listener above already schedules a rebuild; this call also moves
    // focus off any other field cleanly by not requesting focus at all -
    // a chip tap is a pointer gesture, not a keyboard one.
  }

  Future<void> _capturePhoto(TyreReplacementPhotoSource source) async {
    setState(() => _capturingPhoto = true);
    try {
      final CapturedTyreReplacementPhoto? photo = await ref
          .read(tyreReplacementPhotoCaptureProvider)
          .captureAndStore(
            sessionKey: _sessionKey,
            orderIndex: _photoPaths.length,
            source: source,
          );
      if (!mounted) return;
      if (photo != null) {
        setState(() => _photoPaths.add(photo.localPath));
      }
    } finally {
      if (mounted) setState(() => _capturingPhoto = false);
    }
  }

  void _removePhoto(int index) {
    setState(() => _photoPaths.removeAt(index));
  }

  Future<void> _handleSave() async {
    if (_submitting) return;
    final AppLocalizations l10n = AppLocalizations.of(context);

    final WorkspaceContext? workspace = ref.read(workspaceContextProvider);
    if (workspace == null) {
      _showSnack(l10n.tyreReplaceWorkspaceLoadingMessage);
      return;
    }

    final String asset = _assetController.text.trim();
    if (asset.isEmpty) {
      await _showInfoDialog(
        title: l10n.tyreReplaceAssetRequiredTitle,
        message: l10n.tyreReplaceAssetRequiredMessage,
      );
      return;
    }
    final String position = _positionController.text.trim();
    if (position.isEmpty) {
      await _showInfoDialog(
        title: l10n.tyreReplacePositionRequiredTitle,
        message: l10n.tyreReplacePositionRequiredMessage,
      );
      return;
    }

    setState(() => _submitting = true);
    try {
      await ref
          .read(tyreReplacementRepositoryProvider)
          .submitTyreReplacement(
            workspace: workspace,
            input: SubmitTyreReplacementInput(
              assetNo: asset,
              position: position,
              site: _siteController.text.trim().isEmpty
                  ? null
                  : _siteController.text.trim(),
              country: workspace.activeCountry,
              brand: _brandController.text.trim().isEmpty
                  ? null
                  : _brandController.text.trim(),
              size: _sizeController.text.trim().isEmpty
                  ? null
                  : _sizeController.text.trim(),
              serialNo: _serialController.text.trim().isEmpty
                  ? null
                  : _serialController.text.trim(),
              costPerTyre: _parseNum(_costController.text),
              kmAtFitment: _parseNum(_kmController.text),
              treadDepthMm: _parseNum(_treadController.text),
              removalReason: _reasonController.text.trim().isEmpty
                  ? null
                  : _reasonController.text.trim(),
              photoLocalPaths: _photoPaths,
            ),
          );
      if (!mounted) return;

      final AppLocalizations currentL10n = AppLocalizations.of(context);
      final bool leave = await TpDialog.confirm(
        context: context,
        title: currentL10n.tyreReplaceSavedTitle,
        message: currentL10n.tyreReplaceSavedMessage,
        cancelLabel: currentL10n.tyreReplaceAddAnotherAction,
        confirmLabel: currentL10n.tyreReplaceDoneAction,
      );
      if (!mounted) return;
      if (leave) {
        TpBack.pop(context, fallback: TpBackFallbacks.forRoute(widget.route));
      } else {
        _resetForm();
      }
    } on Object {
      if (!mounted) return;
      await _showInfoDialog(
        title: l10n.tyreReplaceSaveFailedTitle,
        message: l10n.tyreReplaceTryAgainFallback,
      );
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  /// "Add another": clears every SINGLE-TYRE field, but keeps asset and
  /// site - see the library comment for why, and for the one deliberate
  /// divergence from the reference's own reset list (removal reason IS
  /// cleared here).
  void _resetForm() {
    _positionController.clear();
    _brandController.clear();
    _sizeController.clear();
    _serialController.clear();
    _costController.clear();
    _kmController.clear();
    _treadController.clear();
    _reasonController.clear();
    setState(() {
      _photoPaths.clear();
      _sessionKey = _uuid.v4();
    });
  }

  Future<void> _showInfoDialog({
    required String title,
    required String message,
  }) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return showDialog<void>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: <Widget>[
          TpButton.primary(
            label: l10n.actionClose,
            onPressed: () => Navigator.of(dialogContext).pop(),
          ),
        ],
      ),
    );
  }

  void _showSnack(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String fallback = TpBackFallbacks.forRoute(widget.route);
    final TpPalette palette = TpPalette.of(context);

    final String assetForPositions = _assetController.text.trim();
    final List<TyreReplacementPositionOption> positions =
        tyreReplacementPositions(
          _master?.vehicleType,
          assetForPositions.isEmpty ? null : assetForPositions,
        );
    final String selectedPosition = _positionController.text.trim();

    return TpScaffold(
      backFallback: fallback,
      appBar: TpAppBar(title: l10n.tyreReplaceNavTitle, backFallback: fallback),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.xxl,
        ),
        children: <Widget>[
          TpCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                TpInput(
                  label: l10n.tyreReplaceAssetLabel,
                  controller: _assetController,
                  hint: l10n.tyreReplaceAssetHint,
                  textCapitalization: TextCapitalization.characters,
                  isRequired: true,
                ),
                if (_master != null) ...<Widget>[
                  const SizedBox(height: TpSpace.sm),
                  _MasterInfoLine(master: _master!, l10n: l10n),
                ],
                const SizedBox(height: TpSpace.md),
                TpInput(
                  label: l10n.tyreReplaceSiteLabel,
                  controller: _siteController,
                  hint: l10n.tyreReplaceSiteHint,
                  onChanged: _onSiteEdited,
                ),
                const SizedBox(height: TpSpace.xs),
                Text(
                  l10n.tyreReplaceSiteHelp,
                  style: Theme.of(context).textTheme.bodySmall
                      ?.copyWith(color: palette.textMuted),
                ),
              ],
            ),
          ),
          const SizedBox(height: TpSpace.md),
          TpCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  l10n.tyreReplacePositionLabel,
                  style: Theme.of(context).textTheme.labelMedium,
                ),
                const SizedBox(height: TpSpace.xs),
                Text(
                  l10n.tyreReplacePositionHint,
                  style: Theme.of(context).textTheme.bodySmall
                      ?.copyWith(color: palette.textMuted),
                ),
                const SizedBox(height: TpSpace.sm),
                Wrap(
                  spacing: TpSpace.sm,
                  runSpacing: TpSpace.sm,
                  children: <Widget>[
                    for (final TyreReplacementPositionOption option
                        in positions)
                      TpTyreChip(
                        data: TpTyreChipData(position: option.code),
                        isSelected:
                            option.code.toUpperCase() ==
                            selectedPosition.toUpperCase(),
                        onTap: () => _selectPosition(option.code),
                      ),
                  ],
                ),
                const SizedBox(height: TpSpace.md),
                TpInput(
                  label: l10n.tyreReplacePositionInputLabel,
                  controller: _positionController,
                  textCapitalization: TextCapitalization.characters,
                  isRequired: true,
                ),
              ],
            ),
          ),
          const SizedBox(height: TpSpace.md),
          TpCard(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Expanded(
                  child: TpInput(
                    label: l10n.tyreReplaceBrandLabel,
                    controller: _brandController,
                    hint: l10n.tyreReplaceBrandHint,
                  ),
                ),
                const SizedBox(width: TpSpace.md),
                Expanded(
                  child: TpInput(
                    label: l10n.tyreReplaceSizeLabel,
                    controller: _sizeController,
                    hint: l10n.tyreReplaceSizeHint,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: TpSpace.md),
          TpCard(
            child: TpInput(
              label: l10n.tyreReplaceSerialLabel,
              controller: _serialController,
              hint: l10n.tyreReplaceSerialHint,
              textCapitalization: TextCapitalization.characters,
            ),
          ),
          const SizedBox(height: TpSpace.md),
          TpCard(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Expanded(
                  child: TpInput(
                    label: l10n.tyreReplaceCostLabel,
                    controller: _costController,
                    hint: l10n.tyreReplaceCostHint,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                  ),
                ),
                const SizedBox(width: TpSpace.sm),
                Expanded(
                  child: TpInput(
                    label: l10n.tyreReplaceOdometerLabel,
                    controller: _kmController,
                    hint: l10n.tyreReplaceOdometerHint,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                  ),
                ),
                const SizedBox(width: TpSpace.sm),
                Expanded(
                  child: TpInput(
                    label: l10n.tyreReplaceTreadLabel,
                    controller: _treadController,
                    hint: l10n.tyreReplaceTreadHint,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: TpSpace.md),
          TpCard(
            child: TpInput(
              label: l10n.tyreReplaceReasonLabel,
              controller: _reasonController,
              hint: l10n.tyreReplaceReasonHint,
              maxLines: 3,
              textCapitalization: TextCapitalization.sentences,
            ),
          ),
          const SizedBox(height: TpSpace.md),
          TpCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  l10n.tyreReplacePhotosLabel,
                  style: Theme.of(context).textTheme.labelMedium,
                ),
                const SizedBox(height: TpSpace.sm),
                TyreReplacementPhotoGallery(
                  localPaths: _photoPaths,
                  isCapturing: _capturingPhoto,
                  onAdd: _capturePhoto,
                  onRemove: _removePhoto,
                  addLabel: l10n.tyreReplaceAddPhoto,
                ),
              ],
            ),
          ),
          const SizedBox(height: TpSpace.xl),
          TpButton.primary(
            label: l10n.tyreReplaceSaveAction,
            icon: Icons.save_outlined,
            isBusy: _submitting,
            isFullWidth: true,
            onPressed: _submitting ? null : _handleSave,
          ),
        ],
      ),
    );
  }
}

/// Parses a typed reading exactly like `Number(value) || null` in the
/// reference: blank is "not entered" (`null`), anything that does not
/// parse is also `null`, never zero-guessed. This feature's own copy of
/// the identical technique `MeterLogScreen`'s/`WashingScreen`'s own
/// `_parseNum` already establish - see either's own doc comment.
num? _parseNum(String raw) {
  final String trimmed = raw.trim();
  if (trimmed.isEmpty) return null;
  return num.tryParse(trimmed);
}

class _MasterInfoLine extends StatelessWidget {
  const _MasterInfoLine({required this.master, required this.l10n});

  final VehicleAsset master;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final String joinedMakeModel = <String?>[
      master.make,
      master.model,
    ].where((String? v) => v != null && v.trim().isNotEmpty).join(' ');
    final String? makeModel = joinedMakeModel.isEmpty ? null : joinedMakeModel;

    final List<String> parts = <String>[
      if (master.vehicleType != null && master.vehicleType!.trim().isNotEmpty)
        master.vehicleType!,
      if (makeModel != null) makeModel,
      if (master.fleetNumber != null && master.fleetNumber!.trim().isNotEmpty)
        l10n.tyreReplaceMasterFleetNumber(master.fleetNumber!),
      if (master.site != null && master.site!.trim().isNotEmpty) master.site!,
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
      child: Text(
        parts.join(' · '),
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
        style: Theme.of(context).textTheme.bodySmall
            ?.copyWith(color: palette.info.onSoft, fontWeight: FontWeight.w700),
      ),
    );
  }
}
