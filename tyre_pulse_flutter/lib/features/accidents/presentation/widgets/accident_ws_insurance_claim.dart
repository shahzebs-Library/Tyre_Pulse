/// Mock M4 "Register insurance claim" (Workstream 3 of 7 - Insurance).
///
/// Four numbered sections over live rows: the claim document package, the
/// claim registration (through the verified `accident_claim_register` RPC),
/// payment and recovery, and the after-registration notify strip. Every
/// derived figure comes from `accident_claim_package.dart`; nothing here
/// invents a number, a name or a currency.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/accidents/accidents_providers.dart';
import 'package:tyre_pulse/features/accidents/data/accident_claim_package_repository.dart';
import 'package:tyre_pulse/features/accidents/data/accident_photo_capture.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_case_vocab.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_claim.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_claim_package.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_ws_header.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_ws_shared.dart';

/// "Save claim draft" keeps the typed registration fields for the session,
/// per case, on this device. It is a draft, not a claim: nothing reaches the
/// server until "Register claim with insurer".
final Map<String, Map<String, String>> _claimDrafts =
    <String, Map<String, String>>{};

class AccidentInsuranceClaimMockWorkspace extends ConsumerStatefulWidget {
  const AccidentInsuranceClaimMockWorkspace({
    required this.snapshot,
    required this.onNavigate,
    super.key,
  });

  final AccidentCaseSnapshot snapshot;
  final void Function(String workspaceKey) onNavigate;

  @override
  ConsumerState<AccidentInsuranceClaimMockWorkspace> createState() =>
      _State();
}

class _State extends ConsumerState<AccidentInsuranceClaimMockWorkspace> {
  final GlobalKey _packageKey = GlobalKey();
  late final TextEditingController _insurer;
  late final TextEditingController _policyNo;
  late final TextEditingController _claimNo;
  late final TextEditingController _claimAmount;
  late final TextEditingController _deductible;
  final TextEditingController _recoveryAmount = TextEditingController();
  final TextEditingController _recoverySource = TextEditingController();
  bool _recoveryOpen = false;
  bool _busy = false;

  AccidentRecord get _record => widget.snapshot.accident;

  @override
  void initState() {
    super.initState();
    final Map<String, String> draft =
        _claimDrafts[_record.id] ?? const <String, String>{};
    _insurer = TextEditingController(
      text: draft['insurer'] ?? _record.insurer ?? '',
    );
    _policyNo = TextEditingController(
      text: draft['policy_no'] ?? _record.policyNo ?? '',
    );
    _claimNo = TextEditingController(text: draft['claim_no'] ?? '');
    _claimAmount = TextEditingController(
      text: draft['claim_amount'] ?? _record.claimAmount?.toString() ?? '',
    );
    _deductible = TextEditingController(
      text: draft['deductible'] ?? _record.deductible?.toString() ?? '',
    );
  }

  @override
  void dispose() {
    _insurer.dispose();
    _policyNo.dispose();
    _claimNo.dispose();
    _claimAmount.dispose();
    _deductible.dispose();
    _recoveryAmount.dispose();
    _recoverySource.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<AccidentClaimPackage> state =
        ref.watch(accidentClaimPackageProvider(_record.id));
    return state.when(
      loading: () => const Padding(
        padding: EdgeInsets.all(TpSpace.xl),
        child: Center(child: CircularProgressIndicator()),
      ),
      error: (Object error, StackTrace _) => TpStateView(
        icon: Icons.cloud_off_outlined,
        tone: TpStatus.critical,
        title: 'The claim could not be loaded',
        message: accidentWsErrorText(error),
        primaryActionLabel: 'Retry',
        onPrimaryAction: () =>
            ref.invalidate(accidentClaimPackageProvider(_record.id)),
      ),
      data: (AccidentClaimPackage package) => _body(context, package),
    );
  }

  Widget _body(BuildContext context, AccidentClaimPackage package) {
    final String? currency = ref.watch(activeCurrencyProvider);
    final ClaimPackageStatus docs =
        ClaimPackageStatus.fromEvidence(package.evidence);
    final AccidentClaim? claim = package.claim;
    final bool registered = claim != null;
    final bool canRegister = canRegisterClaim(
      package: docs,
      alreadyRegistered: registered,
    );
    final num? claimAmount = claim != null
        ? (claim.claimAmount ?? _record.claimAmount)
        : (num.tryParse(_claimAmount.text.trim()) ?? _record.claimAmount);
    final num? deductible = claim != null
        ? (claim.deductible ?? _record.deductible)
        : (num.tryParse(_deductible.text.trim()) ?? _record.deductible);
    final num recovered = package.recoveries.isEmpty
        ? (_record.recoveredAmount ?? 0)
        : recoveredTotal(package.recoveries);
    final num? approved = claim?.approvedAmount ?? _record.claimApprovedAmount;
    final AccidentClaimRecovery? lastRecovery =
        package.recoveries.isEmpty ? null : package.recoveries.first;
    final AccidentWorkstream? stream = widget.snapshot.workstreams
        .where((AccidentWorkstream w) => w.key == 'insurance')
        .firstOrNull;
    final String liability = package.liabilityType == null
        ? accidentWsText(_record.liableParty)
        : faultTiles
                .where((FaultTile t) => t.key == package.liabilityType)
                .firstOrNull
                ?.label ??
            accidentWsText(package.liabilityType);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        AccidentWorkstreamHeader(
          snapshot: widget.snapshot,
          workstreamKey: 'insurance',
        ),
        const SizedBox(height: TpSpace.md),
        if (package.repairRoute == 'external') ...<Widget>[
          const AccidentWsWarning(
            key: Key('accident.ws.insurance.banner'),
            tone: TpStatus.info,
            message: 'External repair assessment',
          ),
          const SizedBox(height: TpSpace.md),
        ],
        AccidentWsNotes(notes: package.notes),

        // 1 Claim document package
        KeyedSubtree(
          key: _packageKey,
          child: AccidentWsSection(
            number: 1,
            title: 'Claim document package',
            trailing: Text(
              docs.progressLabel,
              key: const Key('accident.ws.insurance.package.progress'),
              style: Theme.of(context).textTheme.labelMedium?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
            ),
            children: <Widget>[
              for (final ClaimDocumentStatus row in docs.rows)
                _DocumentRow(
                  row: row,
                  onRequest: row.isMissingRequired && !_busy
                      ? () => _request(row)
                      : null,
                ),
              const SizedBox(height: TpSpace.sm),
              if (!docs.isComplete)
                const AccidentWsWarning(
                  message: 'Claim registration unlocks when all required '
                      'documents are complete.',
                ),
              const SizedBox(height: TpSpace.sm),
              Wrap(
                spacing: TpSpace.sm,
                runSpacing: TpSpace.xs,
                children: <Widget>[
                  for (final ClaimDocumentStatus row in docs.missingRequired)
                    TpButton.secondary(
                      label: 'Request ${row.doc.label.toLowerCase()}',
                      icon: Icons.forward_to_inbox_outlined,
                      isCompact: true,
                      onPressed: _busy ? null : () => _request(row),
                    ),
                  TpButton.secondary(
                    label: 'Upload document',
                    icon: Icons.upload_file_outlined,
                    isCompact: true,
                    onPressed: _busy ? null : () => _upload(docs),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: TpSpace.md),

        // 2 Claim registration
        AccidentWsSection(
          number: 2,
          title: 'Claim registration',
          children: <Widget>[
            if (registered) ...<Widget>[
              AccidentWsFact(
                label: 'Insurer',
                value: accidentWsText(claim?.insurer ?? _record.insurer),
              ),
              AccidentWsFact(
                label: 'Policy no.',
                value: accidentWsText(claim?.policyNo ?? _record.policyNo),
              ),
            ] else ...<Widget>[
              TpInput(label: 'Insurer', controller: _insurer, isRequired: true),
              const SizedBox(height: TpSpace.sm),
              TpInput(
                label: 'Policy no.',
                controller: _policyNo,
                isRequired: true,
              ),
              const SizedBox(height: TpSpace.sm),
            ],
            AccidentWsFact(
              label: 'Claim number',
              value: registered
                  ? accidentWsText(claim?.claimNo ?? _record.insuranceClaimNo)
                  : 'Auto-generated after registration',
            ),
            AccidentWsFact(label: 'Liability', value: liability),
            AccidentWsFact(
              label: 'GCC liability %',
              value: package.ourLiabilityPct == null
                  ? accidentWsNotSet
                  : '${package.ourLiabilityPct}%',
            ),
            if (registered) ...<Widget>[
              AccidentWsFact(
                label: 'Claim amount',
                value: accidentWsMoney(context, claimAmount, currency),
              ),
              AccidentWsFact(
                label: 'Deductible',
                value: accidentWsMoney(context, deductible, currency),
              ),
            ] else ...<Widget>[
              const SizedBox(height: TpSpace.sm),
              TpInput(
                label: 'Claim amount',
                controller: _claimAmount,
                isRequired: true,
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
                onChanged: (_) => setState(() {}),
              ),
              const SizedBox(height: TpSpace.sm),
              TpInput(
                label: 'Deductible',
                controller: _deductible,
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
                onChanged: (_) => setState(() {}),
              ),
              const SizedBox(height: TpSpace.sm),
            ],
            AccidentWsFact(
              label: 'Net claimable',
              value: accidentWsMoney(
                context,
                netClaimable(claimAmount, deductible),
                currency,
              ),
              emphasis: true,
            ),
            const SizedBox(height: TpSpace.sm),
            TpButton.primary(
              key: const Key('accident.ws.insurance.register'),
              label: registered
                  ? 'Claim registered with insurer'
                  : 'Register claim with insurer',
              icon: Icons.verified_outlined,
              isFullWidth: true,
              isBusy: _busy,
              onPressed:
                  canRegister && !_busy ? () => _register(context) : null,
            ),
            if (!canRegister && !registered)
              Padding(
                padding: const EdgeInsets.only(top: TpSpace.xs),
                child: Text(
                  'Enable once all required documents are complete.',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: TpPalette.of(context).textSecondary,
                      ),
                ),
              ),
          ],
        ),
        const SizedBox(height: TpSpace.md),

        // 3 Payment and recovery
        AccidentWsSection(
          number: 3,
          title: 'Payment and recovery',
          trailing: TpStatusChip(
            status: registered ? TpStatus.info : TpStatus.unknown,
            label: claimStatusLabel(
              registered: registered,
              decision: claim?.decision,
            ),
            isCompact: true,
          ),
          children: <Widget>[
            AccidentWsFact(
              label: 'Approved amount',
              value: accidentWsMoney(context, approved, currency),
            ),
            AccidentWsFact(
              label: 'Recovered amount',
              value: accidentWsMoney(context, recovered, currency),
            ),
            AccidentWsFact(
              label: 'Outstanding',
              value: accidentWsMoney(
                context,
                outstandingAmount(approved, recovered),
                currency,
              ),
              emphasis: true,
            ),
            AccidentWsFact(
              label: 'Recovery source',
              value: accidentWsText(
                lastRecovery?.source ?? _record.recoveryStatus,
              ),
            ),
            AccidentWsFact(
              label: 'Last updated',
              value: accidentWsDateTime(
                context,
                lastRecovery?.recoveredAt ?? stream?.updatedAt,
              ),
            ),
            const SizedBox(height: TpSpace.sm),
            if (_recoveryOpen) ...<Widget>[
              TpInput(
                label: 'Recovered amount',
                controller: _recoveryAmount,
                isRequired: true,
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
              ),
              const SizedBox(height: TpSpace.sm),
              TpInput(
                label: 'Recovery source',
                controller: _recoverySource,
                isRequired: true,
                hint: 'Insurer, third party, driver',
              ),
              const SizedBox(height: TpSpace.sm),
              Row(
                children: <Widget>[
                  Expanded(
                    child: TpButton.secondary(
                      label: 'Cancel',
                      onPressed: _busy
                          ? null
                          : () => setState(() => _recoveryOpen = false),
                    ),
                  ),
                  const SizedBox(width: TpSpace.sm),
                  Expanded(
                    child: TpButton.primary(
                      label: 'Save recovery',
                      isBusy: _busy,
                      onPressed: _busy || claim == null
                          ? null
                          : () => _saveRecovery(claim),
                    ),
                  ),
                ],
              ),
            ] else
              TpButton.secondary(
                key: const Key('accident.ws.insurance.updateRecovery'),
                label: 'Update recovery amount',
                icon: Icons.edit_outlined,
                isFullWidth: true,
                onPressed: registered && !_busy
                    ? () => setState(() => _recoveryOpen = true)
                    : null,
              ),
            if (!registered)
              Padding(
                padding: const EdgeInsets.only(top: TpSpace.xs),
                child: Text(
                  'Register the claim first.',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: TpPalette.of(context).textSecondary,
                      ),
                ),
              ),
            const SizedBox(height: TpSpace.sm),
            const AccidentWsWarning(
              tone: TpStatus.info,
              message: 'Recovery amounts remain editable after operational '
                  'case closure. Every adjustment is timestamped and audited.',
            ),
          ],
        ),
        const SizedBox(height: TpSpace.md),

        // 4 After registration notify
        AccidentWsSection(
          number: 4,
          title: 'After registration notify',
          children: <Widget>[
            AccidentWsNotifyChips(
              snapshot: widget.snapshot,
              keys: const <String>[
                'fleet',
                'workshop',
                'command_center',
                'pmv_manager',
              ],
            ),
            const SizedBox(height: TpSpace.sm),
            Text(
              'Notification includes the claim number, document status, '
              'claim amount and next action.',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: TpPalette.of(context).textSecondary,
                  ),
            ),
          ],
        ),
        const SizedBox(height: TpSpace.md),
        Row(
          children: <Widget>[
            Expanded(
              child: TpButton.secondary(
                key: const Key('accident.ws.insurance.saveDraft'),
                label: 'Save claim draft',
                icon: Icons.save_outlined,
                onPressed: registered || _busy ? null : _saveDraft,
              ),
            ),
            const SizedBox(width: TpSpace.sm),
            Expanded(
              child: TpButton.primary(
                key: const Key('accident.ws.insurance.completeDocuments'),
                label: 'Complete documents',
                icon: Icons.checklist_rounded,
                onPressed: docs.isComplete ? null : _scrollToPackage,
              ),
            ),
          ],
        ),
        const SizedBox(height: TpSpace.md),
        Row(
          children: <Widget>[
            Icon(
              Icons.monitor_heart_outlined,
              size: TpSizing.iconSm,
              color: TpPalette.of(context).textSecondary,
            ),
            const SizedBox(width: TpSpace.xs),
            Expanded(
              child: Text(
                '${_commandCenterLabel()} is monitoring SLA and missing '
                'documents.',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: TpPalette.of(context).textSecondary,
                    ),
              ),
            ),
          ],
        ),
      ],
    );
  }

  String _commandCenterLabel() {
    final NotifyRole role = notifyRoles
        .firstWhere((NotifyRole r) => r.key == 'command_center');
    return role.roles.isEmpty
        ? role.label
        : '${role.roles.first} (Command Center)';
  }

  void _scrollToPackage() {
    final BuildContext? target = _packageKey.currentContext;
    if (target == null) return;
    Scrollable.ensureVisible(
      target,
      duration: const Duration(milliseconds: 300),
    ).ignore();
  }

  void _saveDraft() {
    _claimDrafts[_record.id] = <String, String>{
      'insurer': _insurer.text,
      'policy_no': _policyNo.text,
      'claim_no': _claimNo.text,
      'claim_amount': _claimAmount.text,
      'deductible': _deductible.text,
    };
    _snack('Claim draft saved on this device. Nothing was sent.');
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
      ref.invalidate(accidentClaimPackageProvider(_record.id));
    } on Object catch (error) {
      _snack(accidentWsErrorText(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _request(ClaimDocumentStatus row) => _run(() async {
        final String toParty =
            row.doc.key == 'workshop_assessment_pdf' ? 'workshop' : 'fleet';
        await ref.read(accidentClaimPackageRepositoryProvider).requestDocument(
              accidentId: _record.id,
              requirementKey: row.doc.key,
              documentLabel: row.doc.label,
              toParty: toParty,
              country: ref.read(workspaceContextProvider)?.activeCountry,
              site: _record.site,
            );
        _snack('Request for ${row.doc.label} logged on the case.');
      });

  Future<void> _upload(ClaimPackageStatus docs) async {
    final VocabItem? doc = await showModalBottomSheet<VocabItem>(
      context: context,
      builder: (BuildContext sheet) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.all(TpSpace.md),
              child: Text(
                'Which document is this?',
                style: Theme.of(sheet).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
              ),
            ),
            for (final ClaimDocumentStatus row in docs.rows)
              ListTile(
                leading: Icon(
                  row.state == ClaimDocumentState.received
                      ? Icons.check_circle_outline
                      : Icons.radio_button_unchecked,
                ),
                title: Text(row.doc.label),
                subtitle: Text(row.label),
                onTap: () => Navigator.of(sheet).pop(row.doc),
              ),
          ],
        ),
      ),
    );
    if (doc == null || !mounted) return;
    final AccidentPhotoSource? source =
        await pickAccidentEvidenceSource(context, doc.label);
    if (source == null || !mounted) return;
    await _run(() async {
      final String? path = await ref.read(accidentPhotoCaptureProvider).capture(
            sessionKey: 'claim_${_record.id}',
            source: source,
          );
      if (path == null) return;
      await ref.read(accidentClaimPackageRepositoryProvider).uploadDocument(
            accidentId: _record.id,
            requirementKey: doc.key,
            localPath: path,
            isPhoto: doc.countable,
            country: ref.read(workspaceContextProvider)?.activeCountry,
            site: _record.site,
          );
      _snack('${doc.label} uploaded to the claim package.');
    });
  }

  Future<void> _register(BuildContext context) async {
    final num? amount = num.tryParse(_claimAmount.text.trim());
    final num? deductible = _deductible.text.trim().isEmpty
        ? null
        : num.tryParse(_deductible.text.trim());
    if (_insurer.text.trim().isEmpty ||
        _policyNo.text.trim().isEmpty ||
        amount == null) {
      _snack('Enter the insurer, policy number and claim amount first.');
      return;
    }
    final String claimNo = _claimNo.text.trim().isEmpty
        ? 'CLM-${_record.reference}'
        : _claimNo.text.trim();
    final bool? ok = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialog) => AlertDialog(
        title: const Text('Register claim with insurer'),
        content: Text(
          'Claim $claimNo for ${_insurer.text.trim()} under policy '
          '${_policyNo.text.trim()} will be registered on the case. '
          'This cannot be undone from the app.',
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialog).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialog).pop(true),
            child: const Text('Register'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    await _run(() async {
      await ref.read(accidentClaimPackageRepositoryProvider).register(
            accidentId: _record.id,
            insurer: _insurer.text,
            policyNo: _policyNo.text,
            claimNo: claimNo,
            claimAmount: amount,
            deductible: deductible,
          );
      _claimDrafts.remove(_record.id);
      _snack('Claim $claimNo registered with the insurer.');
    });
  }

  Future<void> _saveRecovery(AccidentClaim claim) async {
    final num? amount = num.tryParse(_recoveryAmount.text.trim());
    if (amount == null || _recoverySource.text.trim().isEmpty) {
      _snack('Enter the recovered amount and its source.');
      return;
    }
    await _run(() async {
      await ref.read(accidentClaimPackageRepositoryProvider).addRecovery(
            claimId: claim.id,
            amount: amount,
            source: _recoverySource.text,
            country: ref.read(workspaceContextProvider)?.activeCountry,
            site: _record.site,
          );
      _recoveryAmount.clear();
      _recoverySource.clear();
      if (mounted) setState(() => _recoveryOpen = false);
      _snack('Recovery recorded.');
    });
  }

  void _snack(String message) {
    if (!mounted) return;
    ScaffoldMessenger.maybeOf(context)
        ?.showSnackBar(SnackBar(content: Text(message)));
  }
}

class _DocumentRow extends StatelessWidget {
  const _DocumentRow({required this.row, this.onRequest});

  final ClaimDocumentStatus row;
  final VoidCallback? onRequest;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final bool received = row.state == ClaimDocumentState.received;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: TpSpace.xs),
      child: Row(
        children: <Widget>[
          Icon(
            received
                ? Icons.check_circle_rounded
                : row.doc.required
                    ? Icons.error_outline_rounded
                    : Icons.radio_button_unchecked,
            size: TpSizing.iconMd,
            color: received
                ? palette.ok.base
                : row.doc.required
                    ? palette.critical.base
                    : palette.textMuted,
          ),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Text(
              row.doc.required ? row.doc.label : '${row.doc.label} (Optional)',
            ),
          ),
          TpStatusChip(
            status: received
                ? TpStatus.ok
                : row.doc.required
                    ? TpStatus.critical
                    : TpStatus.unknown,
            label: row.label,
            isCompact: true,
          ),
          if (onRequest != null)
            IconButton(
              tooltip: 'Request ${row.doc.label}',
              onPressed: onRequest,
              icon: const Icon(Icons.forward_to_inbox_outlined),
            ),
        ],
      ),
    );
  }
}
