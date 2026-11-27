/// Issue a charge or record a traffic fine for one driver on the team.
///
/// Sent ONLINE ONLY through `driver_workspace_command` (`charge_issue` or
/// `create_fine`). The server checks the supervisor's team, the currency for
/// the driver's country, the evidence and the dates again. The driver then
/// sees the case in their own workspace and accepts, disputes or signs it.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart'
    show TpIdentifierText;
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/fleet_supervisor/domain/fleet_team.dart';
import 'package:tyre_pulse/features/fleet_supervisor/fleet_supervisor_providers.dart';
import 'package:tyre_pulse/features/fleet_supervisor/presentation/fleet_driver_detail_screen.dart';
import 'package:tyre_pulse/features/fleet_supervisor/presentation/fleet_supervisor_copy.dart';
import 'package:tyre_pulse/features/fleet_supervisor/presentation/fleet_supervisor_ui.dart';
import 'package:uuid/uuid.dart';

enum FleetIssueMode { charge, fine }

abstract final class IssueChargeKeys {
  static const Key category = Key('fleetSup.charge.category');
  static const Key amount = Key('fleetSup.charge.amount');
  static const Key basis = Key('fleetSup.charge.basis');
  static const Key reference = Key('fleetSup.charge.reference');
  static const Key authority = Key('fleetSup.fine.authority');
  static const Key notice = Key('fleetSup.fine.notice');
  static const Key description = Key('fleetSup.fine.description');
  static const Key send = Key('fleetSup.charge.send');
  static const Key camera = Key('fleetSup.charge.camera');
}

class IssueChargeScreen extends ConsumerStatefulWidget {
  const IssueChargeScreen({
    required this.driver,
    required this.mode,
    this.now,
    super.key,
  });

  final FleetTeamDriver driver;
  final FleetIssueMode mode;

  /// Fixed clock for tests and screenshots.
  final DateTime? now;

  @override
  ConsumerState<IssueChargeScreen> createState() => _IssueChargeScreenState();
}

class _IssueChargeScreenState extends ConsumerState<IssueChargeScreen> {
  static const Uuid _uuid = Uuid();
  final String _requestId = _uuid.v4();
  late final DateTime _now = widget.now ?? DateTime.now();

  String _category = fleetChargeCategories.first;
  String? _fault;
  late DateTime _incidentAt = DateTime(_now.year, _now.month, _now.day);
  DateTime? _dueDate;
  late FleetVehicleOption? _vehicle = widget.driver.vehicleId == null
      ? null
      : FleetVehicleOption(
          id: widget.driver.vehicleId!,
          assetNo: widget.driver.assetNo ?? '',
          registrationNo: widget.driver.registrationNo,
          site: widget.driver.site,
        );
  final TextEditingController _amount = TextEditingController();
  late final TextEditingController _currency = TextEditingController(
    text: fleetCurrencyFor(widget.driver.country) ?? '',
  );
  final TextEditingController _basis = TextEditingController();
  final TextEditingController _reference = TextEditingController();
  final TextEditingController _authority = TextEditingController();
  final TextEditingController _notice = TextEditingController();
  final TextEditingController _description = TextEditingController();
  final List<String> _photos = <String>[];
  bool _uploading = false;
  bool _sending = false;
  bool _tried = false;

  bool get _isFine => widget.mode == FleetIssueMode.fine;

  @override
  void dispose() {
    for (final TextEditingController c in <TextEditingController>[
      _amount,
      _currency,
      _basis,
      _reference,
      _authority,
      _notice,
      _description,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  FleetChargeDraft get _charge => FleetChargeDraft(
        driverId: widget.driver.id,
        category: _category,
        amount: _amount.text,
        currency: _currency.text,
        basis: _basis.text,
        incidentAt: _incidentAt,
        vehicleId: _vehicle?.id,
        faultFinding: _fault,
        photoRefs: List<String>.unmodifiable(_photos),
        documentRef: _reference.text,
      );

  FleetFineDraft get _fine => FleetFineDraft(
        driverId: widget.driver.id,
        vehicleId: _vehicle?.id,
        authority: _authority.text,
        noticeReference: _notice.text,
        incidentAt: _incidentAt,
        dueDate: _dueDate,
        amount: _amount.text,
        currency: _currency.text,
        description: _description.text,
        assignmentReason: _basis.text,
      );

  List<FleetFormIssue> get _issues =>
      _isFine ? _fine.issues(now: _now) : _charge.issues(now: _now);

  Future<void> _addPhoto({required bool camera}) async {
    final FleetSupervisorCopy copy = FleetSupervisorCopy.of(context);
    final String? local =
        await ref.read(fleetPhotoPickerProvider)(camera: camera);
    if (local == null || !mounted) return;
    setState(() => _uploading = true);
    try {
      final String refStr = await ref
          .read(fleetTeamRepositoryProvider)
          .uploadChargePhoto(localPath: local, driverId: widget.driver.id);
      if (mounted) setState(() => _photos.add(refStr));
    } on Object catch (e) {
      if (mounted) {
        fleetSnack(
          context,
          e is FleetOfflineFailure ? copy('offline') : copy('photoFailed'),
        );
      }
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<void> _pickDate({required bool due}) async {
    final DateTime? d = await showDatePicker(
      context: context,
      initialDate: due ? (_dueDate ?? _now) : _incidentAt,
      firstDate: DateTime(_now.year - 2),
      lastDate: due ? DateTime(_now.year + 1, 12, 31) : _now,
    );
    if (d == null || !mounted) return;
    setState(() => due ? _dueDate = d : _incidentAt = d);
  }

  Future<void> _pickVehicle() async {
    final FleetVehicleOption? v = await TpBottomSheet.show<FleetVehicleOption>(
      context: context,
      title: FleetSupervisorCopy.of(context)('chooseVehicle'),
      builder: (_) => FleetVehiclePicker(country: widget.driver.country),
    );
    if (v != null && mounted) setState(() => _vehicle = v);
  }

  Future<void> _send() async {
    final FleetSupervisorCopy copy = FleetSupervisorCopy.of(context);
    setState(() => _tried = true);
    if (_issues.isNotEmpty) return;
    setState(() => _sending = true);
    try {
      final FleetTeamRepository repo = ref.read(fleetTeamRepositoryProvider);
      if (_isFine) {
        await repo.createFine(_fine.toPayload(), _requestId);
      } else {
        await repo.issueCharge(_charge.toPayload(), _requestId);
      }
      if (!mounted) return;
      fleetSnack(context, copy(_isFine ? 'fineSent' : 'chargeSent'));
      Navigator.of(context).pop(true);
    } on Object catch (e) {
      if (mounted) fleetSnack(context, fleetErrorText(copy, e));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  String _issueText(FleetSupervisorCopy copy, FleetFormIssue i) {
    if (i == FleetFormIssue.photo && !fleetChargeNeedsPhoto(_category)) {
      return copy('issue_evidence');
    }
    return copy('issue_${i.name}');
  }

  String? _err(FleetSupervisorCopy copy, FleetFormIssue i) =>
      _tried && _issues.contains(i) ? _issueText(copy, i) : null;

  @override
  Widget build(BuildContext context) {
    final FleetSupervisorCopy copy = FleetSupervisorCopy.of(context);
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final TextStyle? muted = text.bodySmall?.copyWith(color: palette.textMuted);
    final String? fixedCurrency = fleetCurrencyFor(widget.driver.country);

    return TpScaffold(
      appBar: TpAppBar(
        title: copy(_isFine ? 'fineTitle' : 'chargeTitle'),
        subtitle: widget.driver.name,
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(TpSpace.lg),
          child: TpButton.primary(
            key: IssueChargeKeys.send,
            label: copy('send'),
            icon: Icons.send_outlined,
            isBusy: _sending,
            isFullWidth: true,
            onPressed: _sending || _uploading ? null : () => unawaited(_send()),
          ),
        ),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(
            TpSpace.lg,
            TpSpace.md,
            TpSpace.lg,
            TpSpace.huge,
          ),
          children: <Widget>[
            Text(copy('onlineOnly'), style: muted),
            const SizedBox(height: TpSpace.md),
            if (!_isFine) ...<Widget>[
              TpDropdown<String>(
                key: IssueChargeKeys.category,
                label: copy('category'),
                value: _category,
                isRequired: true,
                items: <TpDropdownItem<String>>[
                  for (final String c in fleetChargeCategories)
                    TpDropdownItem<String>(value: c, label: copy('cat_$c')),
                ],
                onChanged: (String? v) => setState(() {
                  _category = v ?? _category;
                  if (!fleetChargeIsDamage(_category)) _fault = null;
                }),
              ),
              const SizedBox(height: TpSpace.md),
            ] else ...<Widget>[
              TpInput(
                key: IssueChargeKeys.authority,
                label: copy('authority'),
                hint: copy('authorityHint'),
                controller: _authority,
                isRequired: true,
                errorText: _err(copy, FleetFormIssue.authority),
                onChanged: (_) => setState(() {}),
              ),
              const SizedBox(height: TpSpace.md),
              TpInput(
                key: IssueChargeKeys.notice,
                label: copy('noticeRef'),
                controller: _notice,
                isRequired: true,
                errorText: _err(copy, FleetFormIssue.reference),
                onChanged: (_) => setState(() {}),
              ),
              const SizedBox(height: TpSpace.md),
            ],
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Expanded(
                  flex: 3,
                  child: TpInput(
                    key: IssueChargeKeys.amount,
                    label: copy('amount'),
                    controller: _amount,
                    isRequired: true,
                    keyboardType:
                        const TextInputType.numberWithOptions(decimal: true),
                    inputFormatters: <TextInputFormatter>[
                      FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]')),
                    ],
                    errorText: _err(copy, FleetFormIssue.amount),
                    onChanged: (_) => setState(() {}),
                  ),
                ),
                const SizedBox(width: TpSpace.sm),
                Expanded(
                  flex: 2,
                  child: TpInput(
                    label: copy('currency'),
                    controller: _currency,
                    enabled: fixedCurrency == null,
                    textCapitalization: TextCapitalization.characters,
                    inputFormatters: <TextInputFormatter>[
                      LengthLimitingTextInputFormatter(3),
                    ],
                    errorText: _err(copy, FleetFormIssue.currency),
                  ),
                ),
              ],
            ),
            if (fixedCurrency != null)
              Text(
                copy.fill('currencyFixed', <String, String>{
                  'country': widget.driver.country ?? '',
                  'currency': fixedCurrency,
                }),
                style: muted,
              ),
            const SizedBox(height: TpSpace.md),
            _DateRow(
              label: copy('incidentAt'),
              value: fleetDate(_incidentAt),
              onTap: () => unawaited(_pickDate(due: false)),
              error: _err(copy, FleetFormIssue.incidentInFuture),
            ),
            if (_isFine) ...<Widget>[
              const SizedBox(height: TpSpace.sm),
              _DateRow(
                label: '${copy('dueDate')} (${copy('optional')})',
                value:
                    _dueDate == null ? copy('pickDate') : fleetDate(_dueDate),
                onTap: () => unawaited(_pickDate(due: true)),
              ),
            ],
            const SizedBox(height: TpSpace.md),
            TpCard(
              onTap: () => unawaited(_pickVehicle()),
              padding: const EdgeInsets.all(TpSpace.md),
              borderColor: _err(copy, FleetFormIssue.vehicle) == null
                  ? null
                  : palette.forStatus(TpStatus.critical).base,
              child: Row(
                children: <Widget>[
                  const Icon(Icons.local_shipping_outlined),
                  const SizedBox(width: TpSpace.sm),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(copy('vehicle'), style: muted),
                        if (_vehicle == null)
                          Text(copy('chooseVehicle'), style: text.titleSmall)
                        else
                          TpIdentifierText(
                            _vehicle!.assetNo,
                            style: text.titleSmall,
                          ),
                      ],
                    ),
                  ),
                  const Icon(Icons.chevron_right),
                ],
              ),
            ),
            if (_err(copy, FleetFormIssue.vehicle) != null)
              Padding(
                padding: const EdgeInsets.only(top: TpSpace.xs),
                child: Text(
                  _err(copy, FleetFormIssue.vehicle)!,
                  style: text.bodySmall?.copyWith(
                    color: palette.forStatus(TpStatus.critical).base,
                  ),
                ),
              ),
            const SizedBox(height: TpSpace.md),
            if (!_isFine && fleetChargeIsDamage(_category)) ...<Widget>[
              TpDropdown<String>(
                label: copy('faultFinding'),
                value: _fault,
                isRequired: true,
                errorText: _err(copy, FleetFormIssue.faultFinding),
                items: <TpDropdownItem<String>>[
                  for (final String f in fleetFaultFindings)
                    TpDropdownItem<String>(value: f, label: copy('fault_$f')),
                ],
                onChanged: (String? v) => setState(() => _fault = v),
              ),
              const SizedBox(height: TpSpace.md),
            ],
            if (_isFine) ...<Widget>[
              TpInput(
                key: IssueChargeKeys.description,
                label: copy('fineDescription'),
                controller: _description,
                maxLines: 3,
              ),
              const SizedBox(height: TpSpace.md),
            ],
            TpInput(
              key: IssueChargeKeys.basis,
              label: copy(_isFine ? 'assignmentReason' : 'basis'),
              helperText: _isFine ? null : copy('basisHint'),
              controller: _basis,
              isRequired: true,
              maxLines: 4,
              maxLength: 4000,
              errorText: _err(copy, FleetFormIssue.basis),
              onChanged: (_) => setState(() {}),
            ),
            if (!_isFine) ...<Widget>[
              const SizedBox(height: TpSpace.md),
              Text(copy('photos'), style: text.titleSmall),
              const SizedBox(height: TpSpace.sm),
              Wrap(
                spacing: TpSpace.sm,
                runSpacing: TpSpace.sm,
                children: <Widget>[
                  for (int i = 0; i < _photos.length; i++)
                    InputChip(
                      avatar: const Icon(Icons.photo_outlined, size: 18),
                      label: Text('${i + 1}'),
                      onDeleted: () => setState(() => _photos.removeAt(i)),
                    ),
                ],
              ),
              if (_uploading)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: TpSpace.sm),
                  child: Text(copy('uploading'), style: muted),
                ),
              Row(
                children: <Widget>[
                  Expanded(
                    child: TpButton.secondary(
                      key: IssueChargeKeys.camera,
                      label: copy('addPhoto'),
                      icon: Icons.photo_camera_outlined,
                      onPressed: _uploading
                          ? null
                          : () => unawaited(_addPhoto(camera: true)),
                    ),
                  ),
                  const SizedBox(width: TpSpace.sm),
                  Expanded(
                    child: TpButton.secondary(
                      label: copy('addFromGallery'),
                      icon: Icons.photo_library_outlined,
                      onPressed: _uploading
                          ? null
                          : () => unawaited(_addPhoto(camera: false)),
                    ),
                  ),
                ],
              ),
              if (_err(copy, FleetFormIssue.photo) != null)
                Padding(
                  padding: const EdgeInsets.only(top: TpSpace.xs),
                  child: Text(
                    _err(copy, FleetFormIssue.photo)!,
                    style: text.bodySmall?.copyWith(
                      color: palette.forStatus(TpStatus.critical).base,
                    ),
                  ),
                ),
              const SizedBox(height: TpSpace.md),
              TpInput(
                key: IssueChargeKeys.reference,
                label: copy('documentRef'),
                controller: _reference,
                onChanged: (_) => setState(() {}),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _DateRow extends StatelessWidget {
  const _DateRow({
    required this.label,
    required this.value,
    required this.onTap,
    this.error,
  });

  final String label;
  final String value;
  final VoidCallback onTap;
  final String? error;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    return TpCard(
      onTap: onTap,
      padding: const EdgeInsets.all(TpSpace.md),
      borderColor:
          error == null ? null : palette.forStatus(TpStatus.critical).base,
      child: Row(
        children: <Widget>[
          const Icon(Icons.event_outlined),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  label,
                  style: text.bodySmall?.copyWith(color: palette.textMuted),
                ),
                TpIdentifierText(value, style: text.titleSmall),
                if (error != null)
                  Text(
                    error!,
                    style: text.bodySmall?.copyWith(
                      color: palette.forStatus(TpStatus.critical).base,
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
