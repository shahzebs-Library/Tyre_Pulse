/// Mock M4 "Register insurance claim" (Workstream 3 of 7 - Insurance).
///
/// Four numbered sections over live rows: the claim document package, the
/// claim registration (through the verified `accident_claim_register` RPC),
/// payment and recovery, and the after-registration notify strip. Every
/// derived figure comes from `accident_claim_package.dart`; nothing here
/// invents a number, a name, a claim number or a currency.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/accidents/accidents_providers.dart';
import 'package:tyre_pulse/features/accidents/data/accident_capability.dart';
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

/// Width at which the registration and recovery sections split into the
/// mock's two columns. Below it they stack, so a phone never squeezes two
/// money columns into 180 dp each.
const double _twoColumnMinWidth = 560;

class AccidentInsuranceClaimMockWorkspace extends ConsumerStatefulWidget {
  const AccidentInsuranceClaimMockWorkspace({
    required this.snapshot,
    required this.onNavigate,
    this.showWorkstreamHeader = true,
    super.key,
  });

  final AccidentCaseSnapshot snapshot;
  final void Function(String workspaceKey) onNavigate;

  /// False when the case screen already shows the single workstream header
  /// above this workspace, so the step is never stated twice.
  final bool showWorkstreamHeader;

  @override
  ConsumerState<AccidentInsuranceClaimMockWorkspace> createState() => _State();
}

class _State extends ConsumerState<AccidentInsuranceClaimMockWorkspace> {
  final GlobalKey _packageKey = GlobalKey();
  late final TextEditingController _insurer;
  late final TextEditingController _policyNo;
  late final TextEditingController _claimNo;
  late final TextEditingController _claimAmount;
  late final TextEditingController _deductible;
  final TextEditingController _recoveryAmount = TextEditingController();
  String _recoverySource = claimRecoverySources.first;
  bool _recoveryOpen = false;
  bool _editing = false;
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
    _claimNo = TextEditingController(
      text: draft['claim_no'] ?? _record.insuranceClaimNo ?? '',
    );
    _claimAmount = TextEditingController(
      text: draft['claim_amount'] ?? _record.claimAmount?.toString() ?? '',
    );
    _deductible = TextEditingController(
      text: draft['deductible'] ?? _record.deductible?.toString() ?? '',
    );
    // Open the fields for typing when anything registration needs is blank;
    // otherwise the recorded values read as facts, as the mock prints them.
    _editing = _insurer.text.trim().isEmpty ||
        _policyNo.text.trim().isEmpty ||
        num.tryParse(_claimAmount.text.trim()) == null;
  }

  @override
  void dispose() {
    _insurer.dispose();
    _policyNo.dispose();
    _claimNo.dispose();
    _claimAmount.dispose();
    _deductible.dispose();
    _recoveryAmount.dispose();
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
        title: AppLocalizations.of(context).accClaimLoadFailed,
        message: accidentWsErrorText(context, error),
        primaryActionLabel: AppLocalizations.of(context).actionRetry,
        onPrimaryAction: () =>
            ref.invalidate(accidentClaimPackageProvider(_record.id)),
      ),
      data: (AccidentClaimPackage package) => _body(context, package),
    );
  }

  /// The currency of the CASE's country. The workspace carries the server's
  /// `country_currency` answer for its active country only, so it is used
  /// only when that country is the case's; otherwise the figure stands
  /// alone rather than wearing another country's code.
  String? _caseCurrency(AccidentClaimPackage package) {
    final String? caseCountry = package.caseCountry;
    final String? active =
        ref.watch(workspaceContextProvider)?.activeCountry?.trim();
    if (caseCountry == null || active == null) return null;
    if (active.toLowerCase() != caseCountry.trim().toLowerCase()) return null;
    return ref.watch(activeCurrencyProvider);
  }

  Widget _body(BuildContext context, AccidentClaimPackage package) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final String? currency = _caseCurrency(package);
    final ClaimPackageStatus docs =
        ClaimPackageStatus.fromEvidence(package.evidence);
    final AccidentClaim? claim = package.claim;
    final bool registered = claim != null;
    final bool canRegister = canRegisterClaim(
      package: docs,
      alreadyRegistered: registered,
    );
    // Registration and recovery are written by the insurance and finance
    // teams; a role without those rights is not offered the buttons.
    final bool mayRegister = ref
            .watch(accidentCapabilityProvider(AccidentCapability.editInsurance))
            .value ??
        false;
    final bool mayRecord = ref
            .watch(accidentCapabilityProvider(AccidentCapability.postCost))
            .value ??
        false;
    final num? claimAmount = claim != null
        ? (claim.claimAmount ?? _record.claimAmount)
        : (num.tryParse(_claimAmount.text.trim()) ?? _record.claimAmount);
    final num? deductible = claim != null
        ? (claim.deductible ?? _record.deductible)
        : (_deductible.text.trim().isEmpty
            ? null
            : num.tryParse(_deductible.text.trim()));
    final num recovered = package.recoveries.isEmpty
        ? (_record.recoveredAmount ?? 0)
        : recoveredTotal(package.recoveries);
    final num? approved = claim?.approvedAmount ?? _record.claimApprovedAmount;
    final num? outstanding =
        outstandingAmount(approved, recovered, claimAmount: claimAmount);
    final AccidentClaimRecovery? lastRecovery =
        package.recoveries.isEmpty ? null : package.recoveries.first;
    final String liability = package.liabilityType == null
        ? accidentWsText(context, _record.liableParty)
        : faultTiles
                .where((FaultTile t) => t.key == package.liabilityType)
                .firstOrNull
                ?.label ??
            accidentWsText(context, package.liabilityType);
    final ClaimDocumentStatus? firstMissing = docs.missingRequired.firstOrNull;
    final String? routeBanner = _routeBanner(l10n, package.repairRoute);
    final ClaimNotifyRecipient? monitor = package.recipients
        .where((ClaimNotifyRecipient r) => r.roleKey == 'command_center')
        .firstOrNull;

    final List<Widget> registrationLeft = <Widget>[
      if (registered || !_editing) ...<Widget>[
        _Fact(
          label: l10n.accInsurer,
          value: accidentWsText(
            context,
            registered ? (claim.insurer ?? _record.insurer) : _insurer.text,
          ),
        ),
        _Fact(
          label: l10n.accPolicyNo,
          value: accidentWsText(
            context,
            registered ? (claim.policyNo ?? _record.policyNo) : _policyNo.text,
          ),
        ),
        _Fact(
          label: l10n.accClaimNumber,
          value: _claimNumberText(context, l10n, claim),
          muted: _claimNumberText(context, l10n, claim) ==
              l10n.accClaimNumberPending,
        ),
      ] else ...<Widget>[
        TpInput(
          label: l10n.accInsurer,
          controller: _insurer,
          isRequired: true,
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: TpSpace.sm),
        TpInput(
          label: l10n.accPolicyNo,
          controller: _policyNo,
          isRequired: true,
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: TpSpace.sm),
        TpInput(
          label: l10n.accClaimNumberOptional,
          controller: _claimNo,
          hint: l10n.accClaimNumberPending,
        ),
        const SizedBox(height: TpSpace.sm),
      ],
      _Fact(label: l10n.accLiability, value: liability),
      _Fact(
        label: l10n.accGccLiabilityPct,
        value: package.ourLiabilityPct == null
            ? accidentWsNotSet(context)
            : '${package.ourLiabilityPct}%',
      ),
    ];

    final List<Widget> registrationRight = <Widget>[
      if (registered || !_editing) ...<Widget>[
        _Fact(
          label: l10n.accClaimAmount,
          value: accidentWsMoney(context, claimAmount, currency),
        ),
        _Fact(
          label: l10n.accDeductible,
          value: accidentWsMoney(context, deductible, currency),
        ),
      ] else ...<Widget>[
        TpInput(
          label: l10n.accClaimAmount,
          controller: _claimAmount,
          isRequired: true,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: TpSpace.sm),
        TpInput(
          label: l10n.accDeductible,
          controller: _deductible,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: TpSpace.sm),
      ],
      Divider(height: TpSpace.md, color: palette.border),
      _Fact(
        label: l10n.accNetClaimable,
        value: accidentWsMoney(
          context,
          netClaimable(claimAmount, deductible),
          currency,
        ),
        valueColor: palette.ok.onSoft,
        emphasis: true,
      ),
      const SizedBox(height: TpSpace.sm),
      if (registered || mayRegister) ...<Widget>[
        TpButton.primary(
          key: const Key('accident.ws.insurance.register'),
          label: registered ? l10n.accClaimRegistered : l10n.accRegisterClaim,
          icon: registered
              ? Icons.verified_outlined
              : canRegister
                  ? Icons.how_to_reg_outlined
                  : Icons.lock_outline_rounded,
          isFullWidth: true,
          isBusy: _busy,
          onPressed: canRegister && !_busy ? () => _register(context) : null,
        ),
        if (!canRegister && !registered)
          Padding(
            padding: const EdgeInsets.only(top: TpSpace.xs),
            child: Text(
              l10n.accClaimEnableWhenComplete,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: palette.textSecondary,
                  ),
            ),
          ),
      ],
    ];

    final List<Widget> recoveryLeft = <Widget>[
      _Fact(
        label: l10n.accClaimStatus,
        value: '',
        trailing: _ClaimStatusPill(registered: registered, claim: claim),
      ),
      _Fact(
        label: l10n.accRecoveredAmount,
        value: accidentWsMoney(context, recovered, currency),
        valueColor: palette.ok.onSoft,
      ),
    ];
    final List<Widget> recoveryRight = <Widget>[
      _Fact(
        label: l10n.accApprovedAmount,
        value: accidentWsMoney(context, approved, currency),
      ),
      _Fact(
        key: const Key('accident.ws.insurance.outstanding'),
        label: l10n.accOutstanding,
        value: accidentWsMoney(context, outstanding, currency),
        valueColor: (outstanding ?? 0) > 0 ? palette.critical.base : null,
        emphasis: true,
      ),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        if (widget.showWorkstreamHeader) ...<Widget>[
          AccidentWorkstreamHeader(
            snapshot: widget.snapshot,
            workstreamKey: 'insurance',
          ),
          const SizedBox(height: TpSpace.md),
        ],
        if (routeBanner != null) ...<Widget>[
          _RouteBanner(
            key: const Key('accident.ws.insurance.banner'),
            text: routeBanner,
          ),
          const SizedBox(height: TpSpace.md),
        ],
        AccidentWsNotes(notes: package.notes),
        Semantics(
          header: true,
          child: Text(
            l10n.accClaimTitle,
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
          ),
        ),
        const SizedBox(height: TpSpace.md),

        // 1 Claim document package
        KeyedSubtree(
          key: _packageKey,
          child: AccidentWsSection(
            number: 1,
            title: l10n.accClaimDocumentPackage,
            trailing: Text(
              l10n.accClaimProgress(docs.requiredReceived, docs.requiredTotal),
              key: const Key('accident.ws.insurance.package.progress'),
              style: Theme.of(context).textTheme.labelMedium?.copyWith(
                    fontWeight: FontWeight.w800,
                    color: docs.isComplete
                        ? palette.ok.onSoft
                        : palette.warning.onSoft,
                  ),
            ),
            children: <Widget>[
              DecoratedBox(
                decoration: BoxDecoration(
                  border: Border.all(color: palette.border),
                  borderRadius: BorderRadius.circular(TpRadius.md),
                ),
                child: Column(
                  children: <Widget>[
                    for (int i = 0; i < docs.rows.length; i++) ...<Widget>[
                      if (i > 0) Divider(height: 1, color: palette.border),
                      _DocumentRow(row: docs.rows[i]),
                    ],
                  ],
                ),
              ),
              if (!docs.isComplete) ...<Widget>[
                const SizedBox(height: TpSpace.sm),
                AccidentWsWarning(message: l10n.accClaimRegistrationLocked),
              ],
              const SizedBox(height: TpSpace.sm),
              AccidentWsTwoUp(
                children: <Widget>[
                  if (firstMissing != null)
                    _WarningOutlinedButton(
                      key: const Key('accident.ws.insurance.request'),
                      label: l10n.accRequestDocument(
                        _requestLabel(context, firstMissing.doc.key),
                      ),
                      icon: Icons.person_search_outlined,
                      onPressed: _busy ? null : () => _request(firstMissing),
                    ),
                  TpButton.secondary(
                    key: const Key('accident.ws.insurance.upload'),
                    label: l10n.accUploadDocument,
                    icon: Icons.upload_outlined,
                    isFullWidth: true,
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
          title: l10n.accClaimRegistration,
          trailing: registered || docs.isComplete
              ? null
              : _LockNote(text: l10n.accClaimLockedHint),
          children: <Widget>[
            _Columns(left: registrationLeft, right: registrationRight),
            if (!registered)
              Align(
                alignment: AlignmentDirectional.centerStart,
                child: TpButton.text(
                  key: const Key('accident.ws.insurance.editDetails'),
                  label: _editing
                      ? l10n.accClaimDoneEditing
                      : l10n.accClaimEditDetails,
                  icon: _editing ? Icons.check_rounded : Icons.edit_outlined,
                  onPressed:
                      _busy ? null : () => setState(() => _editing = !_editing),
                ),
              ),
          ],
        ),
        const SizedBox(height: TpSpace.md),

        // 3 Payment and recovery
        AccidentWsSection(
          number: 3,
          title: l10n.accPaymentAndRecovery,
          children: <Widget>[
            _Columns(left: recoveryLeft, right: recoveryRight),
            Divider(height: TpSpace.lg, color: palette.border),
            Wrap(
              spacing: TpSpace.lg,
              runSpacing: TpSpace.xs,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: <Widget>[
                _InlineFact(
                  label: l10n.accRecoverySource,
                  value: lastRecovery?.source == null
                      ? accidentWsNotSet(context)
                      : _sourceLabel(l10n, lastRecovery!.source!),
                ),
                _InlineFact(
                  label: l10n.accLastUpdated,
                  value: accidentWsDateTime(context, lastRecovery?.updatedAt),
                ),
              ],
            ),
            const SizedBox(height: TpSpace.xs),
            if (_recoveryOpen)
              _RecoveryForm(
                amount: _recoveryAmount,
                source: _recoverySource,
                busy: _busy,
                onSource: (String s) => setState(() => _recoverySource = s),
                onCancel: () => setState(() => _recoveryOpen = false),
                onSave: _saveRecovery,
                sourceLabel: (String s) => _sourceLabel(l10n, s),
              )
            else if (mayRecord)
              Align(
                alignment: AlignmentDirectional.centerEnd,
                child: TpButton.text(
                  key: const Key('accident.ws.insurance.updateRecovery'),
                  label: l10n.accClaimUpdateRecoveryLink,
                  icon: Icons.chevron_right_rounded,
                  onPressed: registered && !_busy
                      ? () => setState(() => _recoveryOpen = true)
                      : null,
                ),
              ),
            if (!registered)
              Padding(
                padding: const EdgeInsets.only(top: TpSpace.xs),
                child: Text(
                  l10n.accRegisterClaimFirst,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: palette.textSecondary,
                      ),
                ),
              ),
            const SizedBox(height: TpSpace.sm),
            AccidentWsWarning(
              tone: TpStatus.info,
              message: l10n.accRecoveryEditableNote,
            ),
          ],
        ),
        const SizedBox(height: TpSpace.md),

        // 4 After registration notify
        AccidentWsSection(
          number: 4,
          title: l10n.accAfterRegistrationNotify,
          children: <Widget>[
            AccidentWsTwoUp(
              minHalfWidth: 166,
              children: <Widget>[
                for (final ClaimNotifyRecipient r in package.recipients)
                  _RecipientTile(recipient: r),
              ],
            ),
            if (package.recipients.isEmpty)
              AccidentWsNotifyChips(
                snapshot: widget.snapshot,
                keys: claimNotifyRoleKeys,
              ),
            const SizedBox(height: TpSpace.sm),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Icon(
                  Icons.mail_outline_rounded,
                  size: TpSizing.iconSm,
                  color: palette.textSecondary,
                ),
                const SizedBox(width: TpSpace.sm),
                Expanded(
                  child: Text(
                    l10n.accClaimNotificationIncludes,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: palette.textSecondary,
                        ),
                  ),
                ),
              ],
            ),
          ],
        ),
        const SizedBox(height: TpSpace.md),
        if (!registered)
          AccidentWsFooterPair(
            labels: <String>[
              l10n.accSaveClaimDraft,
              if (docs.isComplete)
                l10n.accClaimRegisterShort
              else
                l10n.accCompleteDocuments,
            ],
            first: TpButton.secondary(
              key: const Key('accident.ws.insurance.saveDraft'),
              label: l10n.accSaveClaimDraft,
              icon: Icons.bookmark_border_rounded,
              onPressed: _busy ? null : _saveDraft,
            ),
            second: docs.isComplete
                ? TpButton.primary(
                    key: const Key('accident.ws.insurance.completeDocuments'),
                    label: l10n.accClaimRegisterShort,
                    icon: Icons.check_circle_outline_rounded,
                    isBusy: _busy,
                    onPressed:
                        canRegister && !_busy ? () => _register(context) : null,
                  )
                : TpButton.primary(
                    key: const Key('accident.ws.insurance.completeDocuments'),
                    label: l10n.accCompleteDocuments,
                    icon: Icons.check_circle_outline_rounded,
                    onPressed: _scrollToPackage,
                  ),
          ),
        if (monitor?.singleName != null) ...<Widget>[
          const SizedBox(height: TpSpace.md),
          _MonitorNote(
            key: const Key('accident.ws.insurance.monitor'),
            text: l10n.accCommandCenterMonitoring(monitor!.singleName!),
          ),
        ],
      ],
    );
  }

  String _claimNumberText(
    BuildContext context,
    AppLocalizations l10n,
    AccidentClaim? claim,
  ) {
    final String number = (claim?.claimNo ?? _claimNo.text).trim();
    return number.isEmpty ? l10n.accClaimNumberPending : number;
  }

  String? _routeBanner(AppLocalizations l10n, String? route) =>
      switch (route?.trim().toLowerCase()) {
        'external' => l10n.accClaimExternalRepairBanner,
        'internal' => l10n.accClaimRouteInternal,
        'on_site' => l10n.accClaimRouteOnSite,
        _ => null,
      };

  /// "Request driving licence": lower case in languages that have case.
  /// Only the first letter is lowered, so acronyms and names inside the label
  /// ("Accident report PDF", "Police / Najm report") keep their spelling.
  String _requestLabel(BuildContext context, String key) {
    final String label = claimDocLabel(AppLocalizations.of(context), key);
    if (label.isEmpty || Localizations.localeOf(context).languageCode != 'en') {
      return label;
    }
    return label[0].toLowerCase() + label.substring(1);
  }

  String _sourceLabel(AppLocalizations l10n, String token) => switch (token) {
        'insurer' => l10n.accClaimSourceInsurer,
        'third_party' => l10n.accClaimSourceThirdParty,
        'driver' => l10n.accClaimSourceDriver,
        'other' => l10n.accClaimSourceOther,
        _ => token,
      };

  void _scrollToPackage() {
    final BuildContext? target = _packageKey.currentContext;
    if (target == null) return;
    Scrollable.ensureVisible(
      target,
      duration: MediaQuery.disableAnimationsOf(context)
          ? Duration.zero
          : const Duration(milliseconds: 300),
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
    _snack(AppLocalizations.of(context).accClaimDraftSaved);
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
      ref.invalidate(accidentClaimPackageProvider(_record.id));
    } on Object catch (error) {
      if (mounted) _snack(accidentWsErrorText(context, error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _request(ClaimDocumentStatus row) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return _run(() async {
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
      _snack(l10n.accDocumentRequestLogged(claimDocLabel(l10n, row.doc.key)));
    });
  }

  Future<void> _upload(ClaimPackageStatus docs) async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final VocabItem? doc = await showModalBottomSheet<VocabItem>(
      context: context,
      builder: (BuildContext sheet) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.all(TpSpace.md),
              child: Text(
                l10n.accWhichDocument,
                style: Theme.of(sheet).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
              ),
            ),
            for (final ClaimDocumentStatus row in docs.rows)
              ListTile(
                leading: Icon(claimDocIcon(row.doc.key)),
                title: Text(claimDocLabel(l10n, row.doc.key)),
                subtitle: Text(claimDocStateLabel(l10n, row)),
                onTap: () => Navigator.of(sheet).pop(row.doc),
              ),
          ],
        ),
      ),
    );
    if (doc == null || !mounted) return;
    final AccidentPhotoSource? source = await pickAccidentEvidenceSource(
      context,
      claimDocLabel(l10n, doc.key),
    );
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
      _snack(l10n.accDocumentUploaded(claimDocLabel(l10n, doc.key)));
    });
  }

  Future<void> _register(BuildContext context) async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final num? amount = num.tryParse(_claimAmount.text.trim());
    final String deductibleText = _deductible.text.trim();
    final num? deductible =
        deductibleText.isEmpty ? null : num.tryParse(deductibleText);
    if (_insurer.text.trim().isEmpty ||
        _policyNo.text.trim().isEmpty ||
        amount == null ||
        (deductibleText.isNotEmpty && deductible == null)) {
      setState(() => _editing = true);
      _snack(l10n.accClaimRegisterMissing);
      return;
    }
    // The claim number is the insurer's; none is invented when blank.
    final String claimNo = _claimNo.text.trim();
    final bool? ok = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialog) => AlertDialog(
        title: Text(l10n.accRegisterClaim),
        content: Text(
          claimNo.isEmpty
              ? l10n.accClaimRegisterConfirmNoNumber(
                  _insurer.text.trim(),
                  _policyNo.text.trim(),
                )
              : l10n.accRegisterClaimConfirm(
                  claimNo,
                  _insurer.text.trim(),
                  _policyNo.text.trim(),
                ),
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialog).pop(false),
            child: Text(l10n.actionCancel),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialog).pop(true),
            child: Text(l10n.accRegister),
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
            claimNo: claimNo.isEmpty ? null : claimNo,
            claimAmount: amount,
            deductible: deductible,
          );
      _claimDrafts.remove(_record.id);
      _snack(
        claimNo.isEmpty
            ? l10n.accClaimRegisteredNoNumberSnack
            : l10n.accClaimRegisteredSnack(claimNo),
      );
    });
  }

  Future<void> _saveRecovery() async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final num? amount = num.tryParse(_recoveryAmount.text.trim());
    if (amount == null || amount < 0) {
      _snack(l10n.accRecoveryMissing);
      return;
    }
    final AccidentClaimPackage? package =
        ref.read(accidentClaimPackageProvider(_record.id)).value;
    final String? currency = package == null ? null : _caseCurrency(package);
    await _run(() async {
      await ref.read(accidentClaimPackageRepositoryProvider).addRecovery(
            accidentId: _record.id,
            amount: amount,
            source: _recoverySource,
            currency: currency,
            country: package?.caseCountry ??
                ref.read(workspaceContextProvider)?.activeCountry,
            site: _record.site,
          );
      _recoveryAmount.clear();
      if (mounted) setState(() => _recoveryOpen = false);
      _snack(l10n.accRecoveryRecorded);
    });
  }

  void _snack(String message) {
    if (!mounted) return;
    ScaffoldMessenger.maybeOf(context)
        ?.showSnackBar(SnackBar(content: Text(message)));
  }
}

/// Localized label of one claim package document, keyed by requirement key.
String claimDocLabel(AppLocalizations l10n, String key) => switch (key) {
      'accident_report_pdf' => l10n.accClaimDocAccidentReport,
      'fleet_validation' => l10n.accClaimDocFleetValidation,
      'workshop_assessment_pdf' => l10n.accClaimDocWorkshopAssessment,
      'damage_photographs' => l10n.accClaimDocDamagePhotos,
      'police_najm_report' => l10n.accClaimDocPoliceNajm,
      'vehicle_registration' => l10n.accClaimDocRegistration,
      'driving_licence' => l10n.accClaimDocLicence,
      'policy_document' => l10n.accClaimDocPolicy,
      _ => claimPackageDocs
              .where((VocabItem d) => d.key == key)
              .firstOrNull
              ?.label ??
          key,
    };

IconData claimDocIcon(String key) => switch (key) {
      'accident_report_pdf' => Icons.description_outlined,
      'fleet_validation' => Icons.verified_user_outlined,
      'workshop_assessment_pdf' => Icons.build_outlined,
      'damage_photographs' => Icons.photo_camera_outlined,
      'police_najm_report' => Icons.local_police_outlined,
      'vehicle_registration' => Icons.directions_car_outlined,
      'driving_licence' => Icons.badge_outlined,
      'policy_document' => Icons.article_outlined,
      _ => Icons.insert_drive_file_outlined,
    };

/// "Received" / "Missing" / "9 received", localized.
String claimDocStateLabel(AppLocalizations l10n, ClaimDocumentStatus row) =>
    switch (row.state) {
      ClaimDocumentState.missing => l10n.accClaimDocMissing,
      ClaimDocumentState.received when row.doc.countable =>
        l10n.accClaimDocCount(row.count),
      ClaimDocumentState.received => l10n.accClaimDocReceived,
    };

class _DocumentRow extends StatelessWidget {
  const _DocumentRow({required this.row});

  final ClaimDocumentStatus row;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final bool received = row.state == ClaimDocumentState.received;
    final TpStatusColors tone = received
        ? palette.ok
        : row.doc.required
            ? palette.warning
            : palette.forStatus(TpStatus.unknown);
    final String label = row.doc.required
        ? claimDocLabel(l10n, row.doc.key)
        : l10n.accOptionalSuffix(claimDocLabel(l10n, row.doc.key));
    final String state = claimDocStateLabel(l10n, row);
    return MergeSemantics(
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: TpSizing.minTouchTarget),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: TpSpace.md,
            vertical: TpSpace.sm,
          ),
          child: Row(
            children: <Widget>[
              Icon(
                claimDocIcon(row.doc.key),
                size: TpSizing.iconMd,
                color: palette.primary,
              ),
              const SizedBox(width: TpSpace.md),
              Expanded(child: Text(label)),
              const SizedBox(width: TpSpace.sm),
              // The countable row prints its count alone; the others pair
              // an icon with the word, so state never rests on colour.
              if (!(received && row.doc.countable)) ...<Widget>[
                Icon(
                  received
                      ? Icons.check_circle_outline_rounded
                      : Icons.error_outline_rounded,
                  size: TpSizing.iconSm,
                  color: tone.onSoft,
                ),
                const SizedBox(width: TpSpace.xs),
              ],
              Text(
                state,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: tone.onSoft,
                      fontWeight: FontWeight.w700,
                    ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A label/value line; [valueColor] colours only the value, never the label.
class _Fact extends StatelessWidget {
  const _Fact({
    required this.label,
    required this.value,
    this.trailing,
    this.valueColor,
    this.emphasis = false,
    this.muted = false,
    super.key,
  });

  final String label;
  final String value;
  final Widget? trailing;
  final Color? valueColor;
  final bool emphasis;
  final bool muted;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    return MergeSemantics(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: TpSpace.xs),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Expanded(
              child: Text(
                label,
                style: text.bodyMedium?.copyWith(color: palette.textSecondary),
              ),
            ),
            const SizedBox(width: TpSpace.sm),
            if (value.isNotEmpty)
              Flexible(
                child: Text(
                  value,
                  textAlign: TextAlign.end,
                  style: text.bodyMedium?.copyWith(
                    color: muted ? palette.textMuted : valueColor,
                    fontWeight: muted
                        ? FontWeight.w400
                        : emphasis
                            ? FontWeight.w800
                            : FontWeight.w600,
                  ),
                ),
              ),
            if (trailing != null) trailing!,
          ],
        ),
      ),
    );
  }
}

class _InlineFact extends StatelessWidget {
  const _InlineFact({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final TextTheme text = Theme.of(context).textTheme;
    return MergeSemantics(
      child: Text.rich(
        TextSpan(
          children: <InlineSpan>[
            TextSpan(
              text: '$label  ',
              style: text.bodyMedium?.copyWith(
                color: TpPalette.of(context).textSecondary,
              ),
            ),
            TextSpan(
              text: value,
              style: text.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
            ),
          ],
        ),
      ),
    );
  }
}

/// Two columns with a divider between them on a wide card, stacked on a
/// phone.
class _Columns extends StatelessWidget {
  const _Columns({required this.left, required this.right});

  final List<Widget> left;
  final List<Widget> right;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
        builder: (BuildContext context, BoxConstraints constraints) {
          final Widget l = Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: left,
          );
          final Widget r = Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: right,
          );
          if (constraints.maxWidth < _twoColumnMinWidth) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[l, const SizedBox(height: TpSpace.sm), r],
            );
          }
          return IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Expanded(child: l),
                VerticalDivider(
                  width: TpSpace.lg,
                  color: TpPalette.of(context).border,
                ),
                Expanded(child: r),
              ],
            ),
          );
        },
      );
}

/// Two equal buttons or tiles per row when they fit, one per row when not.
class _RouteBanner extends StatelessWidget {
  const _RouteBanner({required this.text, super.key});

  final String text;

  @override
  Widget build(BuildContext context) {
    final TpStatusColors colors = TpPalette.of(context).warning;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.soft,
        borderRadius: BorderRadius.circular(TpRadius.md),
        border: Border.all(color: colors.base),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: TpSpace.md,
          vertical: TpSpace.sm,
        ),
        child: Row(
          children: <Widget>[
            Icon(
              Icons.assignment_turned_in_outlined,
              size: TpSizing.iconMd,
              color: colors.onSoft,
            ),
            const SizedBox(width: TpSpace.sm),
            Expanded(
              child: Text(
                text,
                style: Theme.of(context).textTheme.titleSmall?.copyWith(
                      color: colors.onSoft,
                      fontWeight: FontWeight.w700,
                    ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _LockNote extends StatelessWidget {
  const _LockNote({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    final Color color = TpPalette.of(context).textSecondary;
    return Row(
      children: <Widget>[
        Icon(Icons.lock_outline_rounded, size: TpSizing.iconSm, color: color),
        const SizedBox(width: TpSpace.xs),
        Flexible(
          child: Text(
            text,
            style:
                Theme.of(context).textTheme.bodySmall?.copyWith(color: color),
          ),
        ),
      ],
    );
  }
}

class _WarningOutlinedButton extends StatelessWidget {
  const _WarningOutlinedButton({
    required this.label,
    required this.icon,
    required this.onPressed,
    super.key,
  });

  final String label;
  final IconData icon;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final TpStatusColors colors = TpPalette.of(context).warning;
    return OutlinedButton.icon(
      onPressed: onPressed,
      icon: Icon(icon, size: TpSizing.iconMd),
      label: Text(label, textAlign: TextAlign.center),
      style: OutlinedButton.styleFrom(
        foregroundColor: colors.onSoft,
        backgroundColor: colors.soft,
        side: BorderSide(color: colors.base, width: 1.5),
        minimumSize: const Size.fromHeight(TpSizing.minTouchTarget),
        padding: const EdgeInsets.symmetric(
          horizontal: TpSpace.md,
          vertical: TpSpace.sm,
        ),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(TpRadius.md),
        ),
      ),
    );
  }
}

class _ClaimStatusPill extends StatelessWidget {
  const _ClaimStatusPill({required this.registered, required this.claim});

  final bool registered;
  final AccidentClaim? claim;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String token = claim?.decision?.trim().toLowerCase() ?? '';
    final TpStatus tone = !registered
        ? TpStatus.critical
        : switch (token) {
            'rejected' || 'disputed' || 'legal_escalation' => TpStatus.critical,
            'fully_approved' || 'settled' => TpStatus.ok,
            'partially_approved' ||
            'documents_incomplete' ||
            'withdrawn' =>
              TpStatus.warning,
            _ => TpStatus.info,
          };
    final String label = !registered
        ? l10n.accClaimStatusNotRegistered
        : token.isEmpty || token == 'registered'
            ? l10n.accClaimStatusRegistered
            : claimStatusLabel(registered: true, decision: token);
    return TpStatusChip(status: tone, label: label, isCompact: true);
  }
}

class _RecoveryForm extends StatelessWidget {
  const _RecoveryForm({
    required this.amount,
    required this.source,
    required this.busy,
    required this.onSource,
    required this.onCancel,
    required this.onSave,
    required this.sourceLabel,
  });

  final TextEditingController amount;
  final String source;
  final bool busy;
  final ValueChanged<String> onSource;
  final VoidCallback onCancel;
  final VoidCallback onSave;
  final String Function(String token) sourceLabel;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        const SizedBox(height: TpSpace.sm),
        TpInput(
          label: l10n.accRecoveredAmount,
          controller: amount,
          isRequired: true,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
        ),
        const SizedBox(height: TpSpace.sm),
        Text(
          l10n.accRecoverySource,
          style: Theme.of(context).textTheme.labelLarge,
        ),
        const SizedBox(height: TpSpace.xs),
        Wrap(
          spacing: TpSpace.sm,
          runSpacing: TpSpace.xs,
          children: <Widget>[
            for (final String token in claimRecoverySources)
              ChoiceChip(
                key: Key('accident.ws.insurance.source.$token'),
                label: Text(sourceLabel(token)),
                selected: source == token,
                materialTapTargetSize: MaterialTapTargetSize.padded,
                onSelected: busy ? null : (_) => onSource(token),
              ),
          ],
        ),
        const SizedBox(height: TpSpace.sm),
        Row(
          children: <Widget>[
            Expanded(
              child: TpButton.secondary(
                label: l10n.actionCancel,
                onPressed: busy ? null : onCancel,
              ),
            ),
            const SizedBox(width: TpSpace.sm),
            Expanded(
              child: TpButton.primary(
                key: const Key('accident.ws.insurance.saveRecovery'),
                label: l10n.accSaveRecovery,
                isBusy: busy,
                onPressed: busy ? null : onSave,
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class _RecipientTile extends StatelessWidget {
  const _RecipientTile({required this.recipient});

  final ClaimNotifyRecipient recipient;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String who = switch (recipient.names.length) {
      0 => recipient.fallbackRole,
      1 => recipient.names.single,
      final int n => l10n.accClaimNotifyPeople(n),
    };
    return AccidentWsPersonTile(
      who: who,
      team: recipient.visibilityOnly
          ? l10n.accClaimNotifyVisibility
          : accidentWsTeamLabel(l10n, recipient.roleKey),
      visibilityOnly: recipient.visibilityOnly,
      tooltip: recipient.names.length > 1 ? recipient.names.join(', ') : '',
    );
  }
}

class _MonitorNote extends StatelessWidget {
  const _MonitorNote({required this.text, super.key});

  final String text;

  @override
  Widget build(BuildContext context) {
    final TpStatusColors colors = TpPalette.of(context).info;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.soft,
        borderRadius: BorderRadius.circular(TpRadius.md),
      ),
      child: Padding(
        padding: const EdgeInsets.all(TpSpace.md),
        child: Row(
          children: <Widget>[
            Icon(
              Icons.person_outline_rounded,
              size: TpSizing.iconMd,
              color: colors.onSoft,
            ),
            const SizedBox(width: TpSpace.sm),
            Expanded(
              child: Text(
                text,
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
