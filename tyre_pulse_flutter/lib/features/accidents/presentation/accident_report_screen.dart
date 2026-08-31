library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/accidents/accidents_providers.dart';
import 'package:tyre_pulse/features/accidents/data/accident_photo_capture.dart';
import 'package:tyre_pulse/features/accidents/data/accident_report_draft_store.dart';
import 'package:tyre_pulse/features/accidents/data/accident_report_repository.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_damage_map.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_report_intake.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_copy.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_ui.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_damage_map_section.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_report_intake_widgets.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_fleet_providers.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_photo_resolver.dart';
import 'package:uuid/uuid.dart';

class AccidentReportScreen extends ConsumerStatefulWidget {
  const AccidentReportScreen({required this.route, super.key});

  final AccidentReportRoute route;

  @override
  ConsumerState<AccidentReportScreen> createState() =>
      _AccidentReportScreenState();
}

enum _DraftState { ready, dirty, saving, saved, failed, restoring }

class _AccidentReportScreenState extends ConsumerState<AccidentReportScreen> {
  final List<TextEditingController> _ownedControllers =
      <TextEditingController>[];
  late final TextEditingController _asset;
  late final TextEditingController _incidentSite;
  late final TextEditingController _incidentLocation;
  late final TextEditingController _meterAtIncident;
  late final TextEditingController _narrative;
  late final TextEditingController _driverName;
  late final TextEditingController _driverId;
  late final TextEditingController _passengerCount;
  late final TextEditingController _passengerDetails;
  late final TextEditingController _injuryCount;
  late final TextEditingController _injuryDetails;
  late final TextEditingController _emergencyDetails;
  late final TextEditingController _authorityType;
  late final TextEditingController _authorityReportNo;
  late final TextEditingController _noReportReason;
  late final TextEditingController _thirdPartyName;
  late final TextEditingController _thirdPartyVehicle;
  late final TextEditingController _thirdPartyPlate;
  late final TextEditingController _thirdPartyContact;
  late final TextEditingController _thirdPartyInsurer;
  late final TextEditingController _policeReportNo;
  late final TextEditingController _najmReference;
  late final TextEditingController _driverStatement;
  late final TextEditingController _witnessDetails;
  late final TextEditingController _immediateAction;
  late final TextEditingController _notes;

  final String _sessionKey = const Uuid().v4();
  final Map<String, String> _evidencePaths = <String, String>{};
  final Map<AccidentReportStep, GlobalKey> _stepKeys =
      <AccidentReportStep, GlobalKey>{
    for (final AccidentReportStep step in AccidentReportStep.values)
      step: GlobalKey(),
  };

  VehicleAsset? _selectedVehicle;
  AccidentDamageMap _damageMap = const AccidentDamageMap.empty();
  DateTime _incidentAt = DateTime.now();
  String _severity = 'minor';
  String _type = '';
  String _authorityReportStatus = '';
  bool? _passengersInvolved;
  bool? _injuries;
  bool? _emergencyServices;
  bool? _vehicleMovable;
  bool? _recoveryRequired;
  bool? _safeToOperate;
  bool? _authorityInvolved;
  bool? _liabilityAvailable;
  bool? _thirdPartyInvolved;
  bool? _policeNotified;
  bool? _najmNotified;

  AccidentReportStep _currentStep = AccidentReportStep.identify;
  _DraftState _draftState = _DraftState.ready;
  DateTime? _draftSavedAt;
  Timer? _saveDebounce;
  String? _restoredScope;
  String? _busyEvidenceKey;
  String? _error;
  int _draftRevision = 0;
  bool _suppressDraftChanges = false;
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    _asset = _controller();
    _incidentSite = _controller();
    _incidentLocation = _controller();
    _meterAtIncident = _controller();
    _narrative = _controller();
    _driverName = _controller();
    _driverId = _controller();
    _passengerCount = _controller();
    _passengerDetails = _controller();
    _injuryCount = _controller();
    _injuryDetails = _controller();
    _emergencyDetails = _controller();
    _authorityType = _controller();
    _authorityReportNo = _controller();
    _noReportReason = _controller();
    _thirdPartyName = _controller();
    _thirdPartyVehicle = _controller();
    _thirdPartyPlate = _controller();
    _thirdPartyContact = _controller();
    _thirdPartyInsurer = _controller();
    _policeReportNo = _controller();
    _najmReference = _controller();
    _driverStatement = _controller();
    _witnessDetails = _controller();
    _immediateAction = _controller();
    _notes = _controller();
  }

  TextEditingController _controller() {
    final TextEditingController controller = TextEditingController();
    controller.addListener(_markDraftDirty);
    _ownedControllers.add(controller);
    return controller;
  }

  @override
  void dispose() {
    _saveDebounce?.cancel();
    for (final TextEditingController controller in _ownedControllers) {
      controller.dispose();
    }
    super.dispose();
  }

  List<VehicleAsset> _assetsFrom(VehicleFleetListOutcome outcome) =>
      switch (outcome) {
        VehicleFleetListLoaded(assets: final List<VehicleAsset> assets) =>
          assets,
        VehicleFleetListFromCache(assets: final List<VehicleAsset> assets) =>
          assets,
        _ => const <VehicleAsset>[],
      };

  String? _draftScope(WorkspaceContext? workspace) {
    if (workspace == null) return null;
    final String workspaceId =
        (workspace.companyId ?? workspace.tenantId ?? '').trim();
    if (workspaceId.isEmpty || workspace.userId.trim().isEmpty) return null;
    return AccidentReportDraftStore.scopeKey(
      workspaceId: workspaceId,
      userId: workspace.userId,
      country: workspace.activeCountry,
    );
  }

  void _scheduleDraftRestore(WorkspaceContext? workspace) {
    final String? scope = _draftScope(workspace);
    if (scope == null || scope == _restoredScope) return;
    _restoredScope = scope;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(_restoreDraft(scope));
    });
  }

  Future<void> _restoreDraft(String scope) async {
    setState(() => _draftState = _DraftState.restoring);
    try {
      final AccidentReportIntakeDraft? draft =
          await ref.read(accidentReportDraftStoreProvider).load(scope);
      if (!mounted || scope != _restoredScope) return;
      if (draft == null) {
        setState(() => _draftState = _DraftState.ready);
        return;
      }
      _applyDraft(draft);
    } on Object {
      if (!mounted) return;
      setState(() {
        _draftState = _DraftState.failed;
        _error = 'The saved report draft could not be restored. '
            'Your existing saved data was not overwritten.';
      });
    }
  }

  void _applyDraft(AccidentReportIntakeDraft draft) {
    _suppressDraftChanges = true;
    _selectedVehicle = draft.vehicle;
    _asset.text = draft.manualAssetNo.isNotEmpty
        ? draft.manualAssetNo
        : draft.effectiveAssetNo;
    _incidentAt = draft.incidentAt;
    _incidentSite.text = draft.incidentSite;
    _incidentLocation.text = draft.incidentLocation;
    _meterAtIncident.text = draft.meterAtIncident;
    _type = draft.accidentType;
    _severity = draft.severity;
    _narrative.text = draft.narrative;
    _driverName.text = draft.driverName;
    _driverId.text = draft.driverId;
    _passengersInvolved = draft.passengersInvolved;
    _passengerCount.text = draft.passengerCount;
    _passengerDetails.text = draft.passengerDetails;
    _injuries = draft.injuries;
    _injuryCount.text = draft.injuryCount;
    _injuryDetails.text = draft.injuryDetails;
    _emergencyServices = draft.emergencyServices;
    _emergencyDetails.text = draft.emergencyDetails;
    _vehicleMovable = draft.vehicleMovable;
    _recoveryRequired = draft.recoveryRequired;
    _safeToOperate = draft.safeToOperate;
    _authorityInvolved = draft.authorityInvolved;
    _authorityType.text = draft.authorityType;
    _authorityReportStatus = draft.authorityReportStatus;
    _authorityReportNo.text = draft.authorityReportNo;
    _noReportReason.text = draft.noReportReason;
    _liabilityAvailable = draft.liabilityAvailable;
    _thirdPartyInvolved = draft.thirdPartyInvolved;
    _thirdPartyName.text = draft.thirdPartyName;
    _thirdPartyVehicle.text = draft.thirdPartyVehicle;
    _thirdPartyPlate.text = draft.thirdPartyPlate;
    _thirdPartyContact.text = draft.thirdPartyContact;
    _thirdPartyInsurer.text = draft.thirdPartyInsurer;
    _policeNotified = draft.policeNotified;
    _policeReportNo.text = draft.policeReportNo;
    _najmNotified = draft.najmNotified;
    _najmReference.text = draft.najmReference;
    _driverStatement.text = draft.driverStatement;
    _witnessDetails.text = draft.witnessDetails;
    _immediateAction.text = draft.immediateAction;
    _notes.text = draft.notes;
    _damageMap = draft.damageMap;
    _evidencePaths
      ..clear()
      ..addAll(draft.evidencePaths);
    _draftSavedAt = draft.savedAt;
    _suppressDraftChanges = false;
    setState(() {
      _draftState = _DraftState.saved;
      _error = null;
    });
  }

  void _markDraftDirty() {
    if (_suppressDraftChanges || !mounted) return;
    _draftRevision++;
    setState(() {
      _draftState = _DraftState.dirty;
      _error = null;
    });
    _saveDebounce?.cancel();
    _saveDebounce = Timer(
      const Duration(milliseconds: 700),
      () => unawaited(_saveDraft()),
    );
  }

  void _change(VoidCallback mutation) {
    setState(mutation);
    _markDraftDirty();
  }

  Future<bool> _saveDraft({bool surfaceError = false}) async {
    _saveDebounce?.cancel();
    final WorkspaceContext? workspace = ref.read(workspaceContextProvider);
    final String? scope = _draftScope(workspace);
    if (scope == null) {
      if (surfaceError && mounted) {
        setState(() => _error = 'Your workspace is still loading. Try again.');
      }
      return false;
    }
    final int savingRevision = _draftRevision;
    final DateTime savedAt = DateTime.now();
    if (mounted) setState(() => _draftState = _DraftState.saving);
    try {
      await ref.read(accidentReportDraftStoreProvider).save(
            scope,
            _snapshot(savedAt: savedAt),
          );
      if (!mounted) return true;
      if (_draftRevision == savingRevision) {
        setState(() {
          _draftSavedAt = savedAt;
          _draftState = _DraftState.saved;
        });
      } else {
        setState(() => _draftState = _DraftState.dirty);
        _saveDebounce = Timer(
          const Duration(milliseconds: 300),
          () => unawaited(_saveDraft()),
        );
      }
      return true;
    } on Object {
      if (!mounted) return false;
      setState(() {
        _draftState = _DraftState.failed;
        if (surfaceError) {
          _error = 'This device could not save the draft. Nothing previously '
              'saved was overwritten. Try again.';
        }
      });
      return false;
    }
  }

  AccidentReportIntakeDraft _snapshot({DateTime? savedAt}) =>
      AccidentReportIntakeDraft(
        vehicle: _selectedVehicle,
        manualAssetNo: _selectedVehicle == null ? _asset.text : '',
        incidentAt: _incidentAt,
        incidentSite: _incidentSite.text,
        incidentLocation: _incidentLocation.text,
        meterAtIncident: _meterAtIncident.text,
        accidentType: _type,
        severity: _severity,
        narrative: _narrative.text,
        driverName: _driverName.text,
        driverId: _driverId.text,
        passengersInvolved: _passengersInvolved,
        passengerCount: _passengerCount.text,
        passengerDetails: _passengerDetails.text,
        injuries: _injuries,
        injuryCount: _injuryCount.text,
        injuryDetails: _injuryDetails.text,
        emergencyServices: _emergencyServices,
        emergencyDetails: _emergencyDetails.text,
        vehicleMovable: _vehicleMovable,
        recoveryRequired: _recoveryRequired,
        safeToOperate: _safeToOperate,
        authorityInvolved: _authorityInvolved,
        authorityType: _authorityType.text,
        authorityReportStatus: _authorityReportStatus,
        authorityReportNo: _authorityReportNo.text,
        noReportReason: _noReportReason.text,
        liabilityAvailable: _liabilityAvailable,
        thirdPartyInvolved: _thirdPartyInvolved,
        thirdPartyName: _thirdPartyName.text,
        thirdPartyVehicle: _thirdPartyVehicle.text,
        thirdPartyPlate: _thirdPartyPlate.text,
        thirdPartyContact: _thirdPartyContact.text,
        thirdPartyInsurer: _thirdPartyInsurer.text,
        policeNotified: _policeNotified,
        policeReportNo: _policeReportNo.text,
        najmNotified: _najmNotified,
        najmReference: _najmReference.text,
        driverStatement: _driverStatement.text,
        witnessDetails: _witnessDetails.text,
        immediateAction: _immediateAction.text,
        notes: _notes.text,
        damageMap: _damageMap,
        evidencePaths: Map<String, String>.unmodifiable(_evidencePaths),
        savedAt: savedAt ?? _draftSavedAt,
      );

  Future<void> _pickVehicle(List<VehicleAsset> assets) async {
    final AccidentCopy copy = AccidentCopy.of(context);
    final VehicleAsset? selected = await showModalBottomSheet<VehicleAsset>(
      context: context,
      isScrollControlled: true,
      builder: (BuildContext context) => _VehiclePickerSheet(
        assets: assets,
        copy: copy,
      ),
    );
    if (selected == null || !mounted) return;
    final VehicleAsset? previous = _selectedVehicle;
    _suppressDraftChanges = true;
    _selectedVehicle = selected;
    _asset.text = selected.assetNo ?? selected.fleetNumber ?? '';
    _incidentSite.text = selected.site?.trim() ?? '';
    final String previousDriver = previous?.operatorName?.trim() ?? '';
    if (_driverName.text.trim().isEmpty ||
        _driverName.text.trim() == previousDriver) {
      _driverName.text = selected.operatorName?.trim() ?? '';
    }
    if (previous?.id != selected.id) {
      _damageMap = const AccidentDamageMap.empty();
      _meterAtIncident.clear();
      _evidencePaths.clear();
    }
    _suppressDraftChanges = false;
    _change(() {});
  }

  Future<void> _openScanner() async {
    await context.push(const ScannerRoute().location);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text(
          'Use the scanned asset number to select the matching fleet record.',
        ),
      ),
    );
  }

  Future<void> _selectIncidentDate() async {
    final DateTime now = DateTime.now();
    final DateTime? selected = await showDatePicker(
      context: context,
      firstDate: DateTime(now.year - 5),
      lastDate: now,
      initialDate: _incidentAt.isAfter(now) ? now : _incidentAt,
    );
    if (selected == null || !mounted) return;
    _change(() {
      _incidentAt = DateTime(
        selected.year,
        selected.month,
        selected.day,
        _incidentAt.hour,
        _incidentAt.minute,
      );
    });
  }

  Future<void> _selectIncidentTime() async {
    final TimeOfDay? selected = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(_incidentAt),
    );
    if (selected == null || !mounted) return;
    _change(() {
      _incidentAt = DateTime(
        _incidentAt.year,
        _incidentAt.month,
        _incidentAt.day,
        selected.hour,
        selected.minute,
      );
    });
  }

  Future<void> _capture(
    AccidentEvidenceRequirement requirement,
    AccidentPhotoSource source,
  ) async {
    setState(() {
      _busyEvidenceKey = requirement.key;
      _error = null;
    });
    try {
      final String? path = await ref.read(accidentPhotoCaptureProvider).capture(
            sessionKey: '${_sessionKey}_${requirement.key}',
            source: source,
          );
      if (!mounted || path == null) return;
      _change(() => _evidencePaths[requirement.key] = path);
    } on Object {
      if (!mounted) return;
      setState(() {
        _error = AccidentCopy.of(context)('photoFailed');
      });
    } finally {
      if (mounted) setState(() => _busyEvidenceKey = null);
    }
  }

  void _removeEvidence(AccidentEvidenceRequirement requirement) {
    _change(() => _evidencePaths.remove(requirement.key));
  }

  void _goToStep(AccidentReportStep step) {
    setState(() => _currentStep = step);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final BuildContext? target = _stepKeys[step]?.currentContext;
      if (target != null) {
        unawaited(
          Scrollable.ensureVisible(
            target,
            duration: const Duration(milliseconds: 300),
            curve: Curves.easeOut,
            alignment: .02,
          ),
        );
      }
    });
  }

  Future<void> _saveAndContinue() async {
    final List<String> messages =
        _snapshot().validationMessagesFor(_currentStep);
    if (messages.isNotEmpty) {
      setState(() => _error = messages.join('\n'));
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(messages.first)),
      );
      _goToStep(_currentStep);
      return;
    }
    await _saveDraft(surfaceError: true);
    if (!mounted) return;
    final int next = _currentStep.index + 1;
    if (next < AccidentReportStep.values.length) {
      _goToStep(AccidentReportStep.values[next]);
    }
  }

  void _backStep() {
    if (_currentStep.index == 0) return;
    _goToStep(AccidentReportStep.values[_currentStep.index - 1]);
  }

  Future<void> _submit() async {
    final AccidentReportIntakeDraft draft = _snapshot();
    final List<String> missing = draft.allValidationMessages;
    if (missing.isNotEmpty) {
      AccidentReportStep first = AccidentReportStep.identify;
      for (final AccidentReportStep step in AccidentReportStep.values) {
        if (draft.validationMessagesFor(step).isNotEmpty) {
          first = step;
          break;
        }
      }
      setState(() => _error = missing.join('\n'));
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(missing.first)),
      );
      _goToStep(first);
      return;
    }
    final WorkspaceContext? workspace = ref.read(workspaceContextProvider);
    if (workspace == null) {
      setState(() => _error = AccidentCopy.of(context)('workspaceLoading'));
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final List<AccidentEvidenceRequirement> required =
          evidenceRequirementsFor(draft);
      final List<String> photoPaths = <String>[
        for (final AccidentEvidenceRequirement item in required)
          if (_evidencePaths[item.key]?.trim().isNotEmpty == true)
            _evidencePaths[item.key]!.trim(),
        for (final AccidentEvidenceRequirement item
            in accidentOptionalDocuments)
          if (_evidencePaths[item.key]?.trim().isNotEmpty == true)
            _evidencePaths[item.key]!.trim(),
      ];
      final Set<String> dropped =
          await ref.read(accidentReportRepositoryProvider).submit(
                workspace: workspace,
                input: SubmitAccidentReportInput(
                  assetNo: draft.effectiveAssetNo,
                  vehicleId: draft.vehicle?.id,
                  vehicleType: draft.vehicle?.vehicleType,
                  plateNumber: draft.vehicle?.registrationNo,
                  site: draft.incidentSite,
                  location: draft.incidentLocation,
                  incidentAt: draft.incidentAt,
                  description: draft.narrative,
                  severity: draft.severity,
                  accidentType: draft.accidentType,
                  driverName: draft.driverName,
                  injuries: draft.injuries,
                  injuryCount: int.tryParse(draft.injuryCount.trim()),
                  thirdPartyInvolved: draft.thirdPartyInvolved,
                  policeReportNo: draft.policeNotified == true
                      ? draft.policeReportNo
                      : null,
                  najmStatus: draft.najmNotified == null
                      ? null
                      : draft.najmNotified!
                          ? 'Najm report'
                          : 'No Najm',
                  photoLocalPaths: photoPaths,
                  damageMap: draft.damageMap,
                  notes: draft.composeSubmissionNotes(),
                ),
              );
      if (!mounted) return;
      final String? scope = _draftScope(workspace);
      if (scope != null) {
        try {
          await ref.read(accidentReportDraftStoreProvider).clear(scope);
        } on Object {
          // The report is already durably queued. A stale local draft is safer
          // than claiming the queue failed or issuing the same report twice.
        }
      }
      if (!mounted) return;
      ref.invalidate(accidentRepositoryProvider);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            dropped.isEmpty
                ? 'Report saved to the offline queue.'
                : 'Report queued. Some unsupported optional fields were '
                    'kept in the intake notes.',
          ),
        ),
      );
      context.go(const AccidentDashboardRoute().location);
    } on Object {
      if (mounted) {
        setState(() => _error = AccidentCopy.of(context)('saveFailed'));
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final String fallback = TpBackFallbacks.forRoute(widget.route);
    final AccidentCopy copy = AccidentCopy.of(context);
    final AppLocalizations l10n = AppLocalizations.of(context);
    final WorkspaceContext? workspace = ref.watch(workspaceContextProvider);
    _scheduleDraftRestore(workspace);
    final AsyncValue<VehicleFleetListOutcome> fleet =
        ref.watch(vehicleFleetListProvider);
    final List<VehicleAsset> assets = fleet.value == null
        ? const <VehicleAsset>[]
        : _assetsFrom(fleet.value!);
    final AccidentReportIntakeDraft snapshot = _snapshot();
    final List<AccidentEvidenceRequirement> evidenceRequirements =
        evidenceRequirementsFor(snapshot);

    return TpScaffold(
      backFallback: fallback,
      resizeToAvoidBottomInset: true,
      appBar: TpAppBar(
        title: copy('reportTitle'),
        subtitle: l10n.accidentReportCaptureSubtitle,
        backFallback: fallback,
      ),
      bottomNavigationBar: _bottomBar(),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.xxxl,
        ),
        children: <Widget>[
          AccidentReportProgress(
            current: _currentStep,
            onSelect: _goToStep,
          ),
          if (_error != null) ...<Widget>[
            const SizedBox(height: TpSpace.md),
            _ValidationBanner(message: _error!),
          ],
          const SizedBox(height: TpSpace.lg),
          AccidentHero(
            eyebrow: 'Safety first',
            title: 'Capture facts at the scene',
            message: 'This seven-step report saves an encrypted device draft '
                'and enters the existing offline queue only after review.',
            icon: Icons.health_and_safety_outlined,
            trailing: Icon(
              Icons.offline_bolt_outlined,
              color: TpPalette.of(context).info.onSoft,
            ),
          ),
          const SizedBox(height: TpSpace.lg),
          KeyedSubtree(
            key: _stepKeys[AccidentReportStep.identify],
            child: AccidentSection(
              title: '1 · Identify asset',
              subtitle: 'Scan or search the fleet master before recording '
                  'incident-specific information.',
              icon: Icons.local_shipping_outlined,
              child: _identifyStep(fleet, assets, copy),
            ),
          ),
          const SizedBox(height: TpSpace.md),
          KeyedSubtree(
            key: _stepKeys[AccidentReportStep.incident],
            child: AccidentSection(
              title: '2 · Incident details',
              subtitle: 'Where, when and what happened.',
              icon: Icons.warning_amber_rounded,
              child: _incidentStep(),
            ),
          ),
          const SizedBox(height: TpSpace.md),
          KeyedSubtree(
            key: _stepKeys[AccidentReportStep.peopleSafety],
            child: AccidentSection(
              title: '3 · People & safety',
              subtitle: 'Driver, passengers, injuries and immediate response.',
              icon: Icons.people_outline,
              child: _peopleStep(),
            ),
          ),
          const SizedBox(height: TpSpace.md),
          KeyedSubtree(
            key: _stepKeys[AccidentReportStep.authorityThirdParty],
            child: AccidentSection(
              title: '4 · Authority & third party',
              subtitle: 'Police, Najm, local authority and other-party facts.',
              icon: Icons.account_balance_outlined,
              child: _authorityStep(),
            ),
          ),
          const SizedBox(height: TpSpace.md),
          KeyedSubtree(
            key: _stepKeys[AccidentReportStep.damage],
            child: AccidentSection(
              title: '5 · Map vehicle damage',
              subtitle: 'Tap the existing fleet-specific damage mapper. '
                  'A no-damage or near-miss report may remain unmarked.',
              icon: Icons.car_crash_outlined,
              child: AccidentDamageMapSection(
                map: _damageMap,
                vehicle: _selectedVehicle,
                onChanged: (AccidentDamageMap next) =>
                    _change(() => _damageMap = next),
              ),
            ),
          ),
          const SizedBox(height: TpSpace.md),
          KeyedSubtree(
            key: _stepKeys[AccidentReportStep.evidence],
            child: AccidentSection(
              title: '6 · Evidence checklist',
              subtitle: 'Required photo slots follow the documented offline '
                  'baseline, with conditional third-party and incident slots.',
              icon: Icons.fact_check_outlined,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  AccidentEvidenceChecklist(
                    requirements: evidenceRequirements,
                    paths: _evidencePaths,
                    busyKey: _busyEvidenceKey,
                    onCamera: (AccidentEvidenceRequirement item) =>
                        _capture(item, AccidentPhotoSource.camera),
                    onGallery: (AccidentEvidenceRequirement item) =>
                        _capture(item, AccidentPhotoSource.gallery),
                    onRemove: _removeEvidence,
                  ),
                  const SizedBox(height: TpSpace.lg),
                  const Divider(),
                  const SizedBox(height: TpSpace.md),
                  AccidentOptionalDocumentList(
                    paths: _evidencePaths,
                    busyKey: _busyEvidenceKey,
                    onAdd: (AccidentEvidenceRequirement item) =>
                        _capture(item, AccidentPhotoSource.gallery),
                    onRemove: _removeEvidence,
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: TpSpace.md),
          KeyedSubtree(
            key: _stepKeys[AccidentReportStep.review],
            child: AccidentSection(
              title: '7 · Statement, review & submit',
              subtitle: 'Confirm completeness before the report enters the '
                  'offline sync queue.',
              icon: Icons.assignment_turned_in_outlined,
              child: _reviewStep(snapshot, evidenceRequirements),
            ),
          ),
        ],
      ),
    );
  }

  Widget _identifyStep(
    AsyncValue<VehicleFleetListOutcome> fleet,
    List<VehicleAsset> assets,
    AccidentCopy copy,
  ) {
    final VehicleFleetListOutcome? outcome = fleet.value;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Row(
          children: <Widget>[
            Expanded(
              child: TpButton.primary(
                label: 'Scan QR / barcode',
                icon: Icons.qr_code_scanner_rounded,
                onPressed: _openScanner,
                isFullWidth: true,
              ),
            ),
            const SizedBox(width: TpSpace.sm),
            Expanded(
              child: TpButton.secondary(
                label: _selectedVehicle == null
                    ? copy('selectAsset')
                    : copy('changeAsset'),
                icon: Icons.search,
                onPressed: assets.isEmpty ? null : () => _pickVehicle(assets),
                isFullWidth: true,
              ),
            ),
          ],
        ),
        if (outcome is VehicleFleetListFromCache) ...<Widget>[
          const SizedBox(height: TpSpace.sm),
          const Align(
            alignment: AlignmentDirectional.centerStart,
            child: TpStatusChip(
              status: TpStatus.info,
              label: 'Showing saved fleet data',
              icon: Icons.offline_bolt_outlined,
              isCompact: true,
            ),
          ),
        ],
        if (fleet.isLoading) ...<Widget>[
          const SizedBox(height: TpSpace.md),
          const LinearProgressIndicator(),
        ],
        if (fleet.hasError || outcome is VehicleFleetListFailed) ...<Widget>[
          const SizedBox(height: TpSpace.md),
          Text(
            copy('fleetUnavailable'),
            style: TextStyle(color: TpPalette.of(context).critical.base),
          ),
        ],
        const SizedBox(height: TpSpace.md),
        if (_selectedVehicle != null)
          AccidentFleetMasterCard(
            asset: _selectedVehicle!,
            onChange: () => _pickVehicle(assets),
            changeLabel: copy('changeAsset'),
            unavailableLabel: copy('notRecorded'),
          )
        else
          TpInput(
            label: 'Asset number (manual fallback)',
            controller: _asset,
            isRequired: true,
            hint: 'Use only when a fleet match is unavailable',
            prefixIcon: Icons.pin_outlined,
            textCapitalization: TextCapitalization.characters,
          ),
        const SizedBox(height: TpSpace.md),
        TpInput(
          label: 'Meter at incident',
          controller: _meterAtIncident,
          hint: _selectedVehicle?.currentKm == null
              ? 'Odometer or hour-meter reading'
              : 'Fleet master: '
                  '${formatVehicleOdometer(_selectedVehicle!.currentKm!)} km',
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          prefixIcon: Icons.speed_outlined,
        ),
        const SizedBox(height: TpSpace.xs),
        Text(
          'Fleet-master fields above are locked. Incident site and location '
          'remain separately editable in step 2.',
          style: Theme.of(context).textTheme.bodySmall,
        ),
      ],
    );
  }

  Widget _incidentStep() => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: _PickerField(
                  label: 'Incident date',
                  value: MaterialLocalizations.of(context).formatMediumDate(
                    _incidentAt,
                  ),
                  icon: Icons.calendar_today_outlined,
                  onTap: _selectIncidentDate,
                ),
              ),
              const SizedBox(width: TpSpace.sm),
              Expanded(
                child: _PickerField(
                  label: 'Incident time',
                  value: MaterialLocalizations.of(context).formatTimeOfDay(
                    TimeOfDay.fromDateTime(_incidentAt),
                  ),
                  icon: Icons.schedule_outlined,
                  onTap: _selectIncidentTime,
                ),
              ),
            ],
          ),
          const SizedBox(height: TpSpace.md),
          TpInput(
            label: 'Incident site',
            controller: _incidentSite,
            isRequired: true,
            prefixIcon: Icons.business_outlined,
            helperText: 'Editable incident site; independent of the locked '
                'fleet home site.',
          ),
          const SizedBox(height: TpSpace.md),
          TpInput(
            label: 'Road / exact location',
            controller: _incidentLocation,
            prefixIcon: Icons.location_on_outlined,
            hint: 'Gate, road, project area or GPS description',
          ),
          const SizedBox(height: TpSpace.md),
          _DropdownField(
            label: 'Event type',
            value: _type,
            hint: 'Select event type',
            items: _accidentTypeOptions,
            onChanged: (String value) => _change(() => _type = value),
          ),
          const SizedBox(height: TpSpace.md),
          _DropdownField(
            label: 'Initial severity',
            value: _severity,
            items: const <String, String>{
              'minor': 'Minor',
              'moderate': 'Moderate',
              'severe': 'Major / severe',
              'fatal': 'Fatal',
            },
            onChanged: (String value) => _change(() => _severity = value),
          ),
          const SizedBox(height: TpSpace.md),
          TpInput(
            label: 'What happened?',
            controller: _narrative,
            isRequired: true,
            maxLines: 5,
            textCapitalization: TextCapitalization.sentences,
            hint: 'Describe the sequence of events and immediate conditions',
          ),
        ],
      );

  Widget _peopleStep() => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          TpInput(
            label: 'Driver name',
            controller: _driverName,
            isRequired: true,
            prefixIcon: Icons.badge_outlined,
          ),
          const SizedBox(height: TpSpace.md),
          TpInput(
            label: 'Driver employee / licence ID',
            controller: _driverId,
            prefixIcon: Icons.credit_card_outlined,
          ),
          const SizedBox(height: TpSpace.lg),
          AccidentYesNoField(
            label: 'Were passengers involved?',
            value: _passengersInvolved,
            onChanged: (bool value) =>
                _change(() => _passengersInvolved = value),
          ),
          if (_passengersInvolved == true) ...<Widget>[
            const SizedBox(height: TpSpace.md),
            TpInput(
              label: 'Passenger count',
              controller: _passengerCount,
              isRequired: true,
              keyboardType: TextInputType.number,
              inputFormatters: <TextInputFormatter>[
                FilteringTextInputFormatter.digitsOnly,
              ],
            ),
            const SizedBox(height: TpSpace.md),
            TpInput(
              label: 'Passenger details',
              controller: _passengerDetails,
              maxLines: 3,
            ),
          ],
          const SizedBox(height: TpSpace.lg),
          AccidentYesNoField(
            label: 'Were there injuries?',
            value: _injuries,
            onChanged: (bool value) => _change(() => _injuries = value),
          ),
          if (_injuries == true) ...<Widget>[
            const SizedBox(height: TpSpace.md),
            TpInput(
              label: 'Injury count',
              controller: _injuryCount,
              isRequired: true,
              keyboardType: TextInputType.number,
              inputFormatters: <TextInputFormatter>[
                FilteringTextInputFormatter.digitsOnly,
              ],
            ),
            const SizedBox(height: TpSpace.md),
            TpInput(
              label: 'Injury details',
              controller: _injuryDetails,
              isRequired: true,
              maxLines: 3,
            ),
          ],
          const SizedBox(height: TpSpace.lg),
          AccidentYesNoField(
            label: 'Were emergency services contacted?',
            value: _emergencyServices,
            onChanged: (bool value) =>
                _change(() => _emergencyServices = value),
          ),
          if (_emergencyServices == true) ...<Widget>[
            const SizedBox(height: TpSpace.md),
            TpInput(
              label: 'Emergency response details',
              controller: _emergencyDetails,
              isRequired: true,
              maxLines: 3,
            ),
          ],
          const SizedBox(height: TpSpace.lg),
          AccidentYesNoField(
            label: 'Is the vehicle movable?',
            value: _vehicleMovable,
            onChanged: (bool value) => _change(() => _vehicleMovable = value),
          ),
          const SizedBox(height: TpSpace.md),
          AccidentYesNoField(
            label: 'Is recovery / towing required?',
            value: _recoveryRequired,
            onChanged: (bool value) => _change(() => _recoveryRequired = value),
          ),
          const SizedBox(height: TpSpace.md),
          AccidentYesNoField(
            label: 'Is the vehicle safe to operate?',
            value: _safeToOperate,
            onChanged: (bool value) => _change(() => _safeToOperate = value),
          ),
        ],
      );

  Widget _authorityStep() => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          AccidentYesNoField(
            label: 'Was a local authority involved?',
            value: _authorityInvolved,
            helper: 'Use the authority applicable to the active country and '
                'site; country rules remain server-configured.',
            onChanged: (bool value) =>
                _change(() => _authorityInvolved = value),
          ),
          if (_authorityInvolved == true) ...<Widget>[
            const SizedBox(height: TpSpace.md),
            TpInput(
              label: 'Authority type',
              controller: _authorityType,
              isRequired: true,
              hint: 'Najm, Traffic Police, Police, Site Security, etc.',
            ),
            const SizedBox(height: TpSpace.md),
            _DropdownField(
              label: 'Authority report status',
              value: _authorityReportStatus,
              hint: 'Select status',
              items: const <String, String>{
                'available': 'Report available',
                'pending': 'Report pending',
                'none': 'No report',
              },
              onChanged: (String value) =>
                  _change(() => _authorityReportStatus = value),
            ),
            if (_authorityReportStatus == 'available') ...<Widget>[
              const SizedBox(height: TpSpace.md),
              TpInput(
                label: 'Authority report / reference number',
                controller: _authorityReportNo,
                isRequired: true,
              ),
            ],
            if (_authorityReportStatus == 'none') ...<Widget>[
              const SizedBox(height: TpSpace.md),
              TpInput(
                label: 'Reason no report exists',
                controller: _noReportReason,
                isRequired: true,
                maxLines: 3,
              ),
            ],
            const SizedBox(height: TpSpace.md),
            AccidentYesNoField(
              label: 'Is an authority liability decision available?',
              value: _liabilityAvailable,
              onChanged: (bool value) =>
                  _change(() => _liabilityAvailable = value),
            ),
          ],
          const SizedBox(height: TpSpace.lg),
          AccidentYesNoField(
            label: 'Was a third party involved?',
            value: _thirdPartyInvolved,
            onChanged: (bool value) =>
                _change(() => _thirdPartyInvolved = value),
          ),
          if (_thirdPartyInvolved == true) ...<Widget>[
            const SizedBox(height: TpSpace.md),
            TpInput(
              label: 'Third-party name',
              controller: _thirdPartyName,
              isRequired: true,
            ),
            const SizedBox(height: TpSpace.md),
            TpInput(
              label: 'Third-party vehicle',
              controller: _thirdPartyVehicle,
            ),
            const SizedBox(height: TpSpace.md),
            TpInput(
              label: 'Third-party plate',
              controller: _thirdPartyPlate,
            ),
            const SizedBox(height: TpSpace.md),
            TpInput(
              label: 'Third-party contact',
              controller: _thirdPartyContact,
              isRequired: true,
              keyboardType: TextInputType.phone,
            ),
            const SizedBox(height: TpSpace.md),
            TpInput(
              label: 'Third-party insurer',
              controller: _thirdPartyInsurer,
            ),
          ],
          const SizedBox(height: TpSpace.lg),
          AccidentYesNoField(
            label: 'Were police notified?',
            value: _policeNotified,
            onChanged: (bool value) => _change(() => _policeNotified = value),
          ),
          if (_policeNotified == true) ...<Widget>[
            const SizedBox(height: TpSpace.md),
            TpInput(
              label: 'Police report number',
              controller: _policeReportNo,
              isRequired: true,
            ),
          ],
          const SizedBox(height: TpSpace.lg),
          AccidentYesNoField(
            label: 'Was a Najm case opened?',
            value: _najmNotified,
            helper: 'Record only when Najm applies to this incident.',
            onChanged: (bool value) => _change(() => _najmNotified = value),
          ),
          if (_najmNotified == true) ...<Widget>[
            const SizedBox(height: TpSpace.md),
            TpInput(
              label: 'Najm reference',
              controller: _najmReference,
              isRequired: true,
            ),
          ],
        ],
      );

  Widget _reviewStep(
    AccidentReportIntakeDraft snapshot,
    List<AccidentEvidenceRequirement> requirements,
  ) {
    final List<String> missing = snapshot.allValidationMessages;
    final int photos = snapshot.completedEvidenceCount(requirements);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        TpInput(
          label: 'Driver statement',
          controller: _driverStatement,
          isRequired: true,
          maxLines: 5,
          textCapitalization: TextCapitalization.sentences,
        ),
        const SizedBox(height: TpSpace.md),
        TpInput(
          label: 'Witness details',
          controller: _witnessDetails,
          maxLines: 3,
        ),
        const SizedBox(height: TpSpace.md),
        TpInput(
          label: 'Immediate action taken',
          controller: _immediateAction,
          maxLines: 3,
        ),
        const SizedBox(height: TpSpace.md),
        TpInput(
          label: 'Additional notes',
          controller: _notes,
          maxLines: 3,
        ),
        const SizedBox(height: TpSpace.lg),
        TpCard(
          borderColor: missing.isEmpty
              ? TpPalette.of(context).ok.base
              : TpPalette.of(context).warning.base,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Row(
                children: <Widget>[
                  Icon(
                    missing.isEmpty
                        ? Icons.check_circle_outline
                        : Icons.rule_folder_outlined,
                  ),
                  const SizedBox(width: TpSpace.sm),
                  Expanded(
                    child: Text(
                      missing.isEmpty
                          ? 'Ready to submit'
                          : 'Missing before submission',
                      style: Theme.of(context).textTheme.titleSmall,
                    ),
                  ),
                  TpStatusChip(
                    status: missing.isEmpty ? TpStatus.ok : TpStatus.warning,
                    label: missing.isEmpty ? 'Complete' : '${missing.length}',
                    isCompact: true,
                  ),
                ],
              ),
              if (missing.isNotEmpty) ...<Widget>[
                const SizedBox(height: TpSpace.sm),
                for (final String message in missing)
                  Padding(
                    padding: const EdgeInsets.only(bottom: TpSpace.xs),
                    child: Text('• $message'),
                  ),
              ],
            ],
          ),
        ),
        const SizedBox(height: TpSpace.md),
        TpCard(
          child: Column(
            children: <Widget>[
              AccidentReviewRow(
                label: 'Asset',
                value: snapshot.effectiveAssetNo.isEmpty
                    ? 'Not recorded'
                    : snapshot.effectiveAssetNo,
                icon: Icons.local_shipping_outlined,
              ),
              AccidentReviewRow(
                label: 'Incident',
                value: '${_eventTypeLabel(snapshot.accidentType)} · '
                    '${snapshot.severity}',
                icon: Icons.warning_amber_rounded,
              ),
              AccidentReviewRow(
                label: 'Site / location',
                value: <String>[
                  snapshot.incidentSite.trim(),
                  snapshot.incidentLocation.trim(),
                ].where((String value) => value.isNotEmpty).join(' · '),
                icon: Icons.location_on_outlined,
              ),
              AccidentReviewRow(
                label: 'People',
                value:
                    'Driver ${snapshot.driverName.trim().isEmpty ? '—' : snapshot.driverName.trim()} · '
                    'Injuries ${_yesNo(snapshot.injuries)}',
                icon: Icons.people_outline,
              ),
              AccidentReviewRow(
                label: 'Damage marks',
                value: '${snapshot.damageMap.count}',
                icon: Icons.car_crash_outlined,
              ),
              AccidentReviewRow(
                label: 'Required photos',
                value: '$photos of ${requirements.length}',
                icon: Icons.photo_library_outlined,
              ),
            ],
          ),
        ),
        const SizedBox(height: TpSpace.md),
        const TpCard(
          isDashed: true,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Icon(Icons.schedule_send_outlined),
              SizedBox(width: TpSpace.sm),
              Expanded(
                child: Text(
                  'Recipients, route and initial SLA are resolved by the '
                  'configured accident workflow when this queued report syncs.',
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _bottomBar() {
    final String statusLabel = switch (_draftState) {
      _DraftState.ready => 'Draft auto-saves on this device',
      _DraftState.dirty => 'Unsaved changes',
      _DraftState.saving => 'Saving draft…',
      _DraftState.saved => _draftSavedAt == null
          ? 'Draft saved on this device'
          : 'Draft saved · '
              '${MaterialLocalizations.of(context).formatTimeOfDay(TimeOfDay.fromDateTime(_draftSavedAt!))}',
      _DraftState.failed => 'Draft save failed',
      _DraftState.restoring => 'Restoring saved draft…',
    };
    final Widget status = AccidentDraftStatus(
      label: statusLabel,
      saving: _draftState == _DraftState.saving ||
          _draftState == _DraftState.restoring,
      failed: _draftState == _DraftState.failed,
    );
    final Widget actions = Row(
      children: <Widget>[
        if (_currentStep.index > 0) ...<Widget>[
          Expanded(
            child: TpButton.secondary(
              label: 'Back',
              icon: Icons.arrow_back_rounded,
              onPressed: _submitting ? null : _backStep,
              isFullWidth: true,
            ),
          ),
          const SizedBox(width: TpSpace.sm),
        ],
        Expanded(
          flex: 2,
          child: TpButton.primary(
            label: _currentStep == AccidentReportStep.review
                ? 'Submit report'
                : 'Save & Continue',
            icon: _currentStep == AccidentReportStep.review
                ? Icons.shield_outlined
                : Icons.arrow_forward_rounded,
            isBusy: _submitting,
            onPressed: _submitting
                ? null
                : _currentStep == AccidentReportStep.review
                    ? _submit
                    : _saveAndContinue,
            isFullWidth: true,
          ),
        ),
      ],
    );
    return Material(
      color: TpPalette.of(context).surface,
      elevation: 8,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.all(TpSpace.sm),
          child: LayoutBuilder(
            builder: (BuildContext context, BoxConstraints constraints) {
              if (constraints.maxWidth < 520) {
                return Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    Align(
                      alignment: AlignmentDirectional.centerStart,
                      child: status,
                    ),
                    const SizedBox(height: TpSpace.xs),
                    actions,
                  ],
                );
              }
              return Row(
                children: <Widget>[
                  Expanded(child: status),
                  const SizedBox(width: TpSpace.md),
                  SizedBox(width: 380, child: actions),
                ],
              );
            },
          ),
        ),
      ),
    );
  }
}

const Map<String, String> _accidentTypeOptions = <String, String>{
  'collision': 'Collision',
  'rollover': 'Rollover',
  'rear_end': 'Rear-end',
  'side_swipe': 'Side-swipe',
  'reversing': 'Reversing',
  'fire': 'Fire',
  'vandalism': 'Vandalism',
  'weather': 'Weather',
  'tyre_failure': 'Tyre failure',
  'mechanical': 'Mechanical',
  'near_miss': 'Near miss',
  'property_damage': 'Property damage',
  'other': 'Other',
};

class _PickerField extends StatelessWidget {
  const _PickerField({
    required this.label,
    required this.value,
    required this.icon,
    required this.onTap,
  });

  final String label;
  final String value;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(label, style: Theme.of(context).textTheme.labelMedium),
          const SizedBox(height: TpSpace.xs),
          Material(
            color: TpPalette.of(context).surface,
            borderRadius: BorderRadius.circular(TpRadius.md),
            child: InkWell(
              onTap: onTap,
              borderRadius: BorderRadius.circular(TpRadius.md),
              child: Container(
                constraints: const BoxConstraints(
                  minHeight: TpSizing.controlHeight,
                ),
                padding: const EdgeInsets.symmetric(horizontal: TpSpace.md),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(TpRadius.md),
                  border: Border.all(
                    color: TpPalette.of(context).borderStrong,
                  ),
                ),
                child: Row(
                  children: <Widget>[
                    Icon(icon, size: TpSizing.iconMd),
                    const SizedBox(width: TpSpace.sm),
                    Expanded(
                      child: Text(
                        value,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    const Icon(Icons.expand_more),
                  ],
                ),
              ),
            ),
          ),
        ],
      );
}

class _DropdownField extends StatelessWidget {
  const _DropdownField({
    required this.label,
    required this.value,
    required this.items,
    required this.onChanged,
    this.hint,
  });

  final String label;
  final String value;
  final Map<String, String> items;
  final ValueChanged<String> onChanged;
  final String? hint;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(label, style: Theme.of(context).textTheme.labelMedium),
          const SizedBox(height: TpSpace.xs),
          DropdownButtonFormField<String>(
            key: ValueKey<String>('$label:$value'),
            initialValue: items.containsKey(value) ? value : null,
            hint: hint == null ? null : Text(hint!),
            decoration: const InputDecoration(),
            isExpanded: true,
            items: <DropdownMenuItem<String>>[
              for (final MapEntry<String, String> item in items.entries)
                DropdownMenuItem<String>(
                  value: item.key,
                  child: Text(item.value),
                ),
            ],
            onChanged: (String? next) {
              if (next != null) onChanged(next);
            },
          ),
        ],
      );
}

class _ValidationBanner extends StatelessWidget {
  const _ValidationBanner({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final TpStatusColors colors = TpPalette.of(context).critical;
    return Semantics(
      liveRegion: true,
      child: TpCard(
        borderColor: colors.base,
        background: colors.soft,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Icon(Icons.error_outline, color: colors.onSoft),
            const SizedBox(width: TpSpace.sm),
            Expanded(
              child: Text(
                message,
                style: TextStyle(color: colors.onSoft),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Owns the search controller for exactly as long as the bottom-sheet route
/// is mounted. The reverse animation may outlive `showModalBottomSheet`'s
/// future, so the caller must not own or eagerly dispose this controller.
class _VehiclePickerSheet extends StatefulWidget {
  const _VehiclePickerSheet({required this.assets, required this.copy});

  final List<VehicleAsset> assets;
  final AccidentCopy copy;

  @override
  State<_VehiclePickerSheet> createState() => _VehiclePickerSheetState();
}

class _VehiclePickerSheetState extends State<_VehiclePickerSheet> {
  final TextEditingController _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final String query = _search.text.trim().toLowerCase();
    final List<VehicleAsset> shown = widget.assets
        .where(
          (VehicleAsset asset) =>
              query.isEmpty || vehicleMatchesSearch(asset, query),
        )
        .take(40)
        .toList(growable: false);
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          left: TpSpace.lg,
          right: TpSpace.lg,
          top: TpSpace.lg,
          bottom: MediaQuery.viewInsetsOf(context).bottom + TpSpace.lg,
        ),
        child: SizedBox(
          height: MediaQuery.sizeOf(context).height * .76,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                children: <Widget>[
                  Expanded(
                    child: Text(
                      widget.copy('selectAsset'),
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                  ),
                  IconButton(
                    tooltip:
                        MaterialLocalizations.of(context).closeButtonTooltip,
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
              const SizedBox(height: TpSpace.sm),
              TpSearchField(
                controller: _search,
                hint: widget.copy('assetSearch'),
                onChanged: (_) => setState(() {}),
              ),
              const SizedBox(height: TpSpace.xs),
              Text(
                '${shown.length} fleet result${shown.length == 1 ? '' : 's'} · '
                'search asset, fleet, plate, type, make, model or site',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const SizedBox(height: TpSpace.md),
              Expanded(
                child: shown.isEmpty
                    ? const Center(
                        child: Text('No matching fleet asset'),
                      )
                    : ListView.separated(
                        itemCount: shown.length,
                        separatorBuilder: (_, __) =>
                            const SizedBox(height: TpSpace.sm),
                        itemBuilder: (BuildContext context, int index) {
                          final VehicleAsset asset = shown[index];
                          return _VehicleSearchResult(
                            asset: asset,
                            unavailableLabel: widget.copy('unrecordedAsset'),
                            onTap: () {
                              FocusManager.instance.primaryFocus?.unfocus();
                              Navigator.of(context).pop(asset);
                            },
                          );
                        },
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _VehicleSearchResult extends StatelessWidget {
  const _VehicleSearchResult({
    required this.asset,
    required this.unavailableLabel,
    required this.onTap,
  });

  final VehicleAsset asset;
  final String unavailableLabel;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final String? photo = vehiclePhotoAsset(asset);
    final String identity = asset.displayIdentity ?? unavailableLabel;
    final String details = <String?>[
      asset.vehicleType,
      asset.registrationNo == null ? null : 'Plate ${asset.registrationNo}',
      asset.make,
      asset.model,
      asset.site,
    ]
        .whereType<String>()
        .map((String value) => value.trim())
        .where((String value) => value.isNotEmpty)
        .join(' · ');
    final TpPalette palette = TpPalette.of(context);
    return TpCard(
      padding: EdgeInsets.zero,
      child: Material(
        color: Colors.transparent,
        child: ListTile(
          onTap: onTap,
          contentPadding: const EdgeInsets.all(TpSpace.sm),
          leading: Container(
            width: 78,
            height: 62,
            clipBehavior: Clip.antiAlias,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: palette.surfaceAlt,
              borderRadius: BorderRadius.circular(TpRadius.sm),
            ),
            child: photo == null
                ? Icon(
                    vehicleFallbackIcon(asset),
                    color: palette.primary,
                    size: 32,
                  )
                : Image.asset(
                    photo,
                    fit: BoxFit.cover,
                    width: double.infinity,
                    height: double.infinity,
                    semanticLabel: identity,
                  ),
          ),
          title: Directionality(
            textDirection: TextDirection.ltr,
            child: Text(
              identity,
              style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
            ),
          ),
          subtitle: details.isEmpty
              ? null
              : Text(
                  details,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
          trailing: const Icon(Icons.chevron_right_rounded),
        ),
      ),
    );
  }
}

String _yesNo(bool? value) => switch (value) {
      true => 'Yes',
      false => 'No',
      null => 'Not answered',
    };

String _eventTypeLabel(String value) {
  final String token = value.trim();
  if (token.isEmpty) return 'Not recorded';
  return _accidentTypeOptions[token] ?? token.replaceAll('_', ' ');
}
