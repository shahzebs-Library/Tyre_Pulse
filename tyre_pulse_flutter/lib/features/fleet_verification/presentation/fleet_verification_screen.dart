/// "Verify on site" - one machine, one check.
///
/// Opened with [Navigator.push] from the vehicle detail screen (no router
/// change). Saves to the on-device outbox FIRST, so a check made with no
/// signal is never lost, then tries to send it.
library;

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/fleet_verification/data/fleet_verification_repository.dart';
import 'package:tyre_pulse/features/fleet_verification/domain/fleet_verification_rules.dart';
import 'package:tyre_pulse/features/fleet_verification/fleet_verification_providers.dart';
import 'package:tyre_pulse/features/fleet_verification/presentation/fleet_verification_copy.dart';
import 'package:tyre_pulse/features/handover/data/handover_location.dart';
import 'package:tyre_pulse/features/scanning/presentation/asset_camera_scanner_dialog.dart';

const List<String> _countries = <String>['KSA', 'UAE', 'Egypt'];

abstract final class FleetVerificationScreenKeys {
  static const Key save = Key('fleet_verification.save');
  static const Key plate = Key('fleet_verification.plate');
  static const Key chassis = Key('fleet_verification.chassis');
  static const Key assetCode = Key('fleet_verification.asset_code');
}

class FleetVerificationScreen extends ConsumerStatefulWidget {
  const FleetVerificationScreen({required this.asset, super.key});

  final VehicleAsset asset;

  static Future<void> open(BuildContext context, VehicleAsset asset) =>
      Navigator.of(context).push<void>(
        MaterialPageRoute<void>(
          builder: (_) => FleetVerificationScreen(asset: asset),
        ),
      );

  @override
  ConsumerState<FleetVerificationScreen> createState() =>
      _FleetVerificationScreenState();
}

class _FleetVerificationScreenState
    extends ConsumerState<FleetVerificationScreen> {
  late final String _id = FleetVerificationService.newId();
  late final TextEditingController _asset =
      TextEditingController(text: widget.asset.assetNo ?? '');
  final TextEditingController _plate = TextEditingController();
  final TextEditingController _chassis = TextEditingController();
  final TextEditingController _note = TextEditingController();

  FleetVerificationOutcome _outcome = FleetVerificationOutcome.present;
  String? _otherCountry;
  String? _photo;
  bool _busy = false;
  String? _message;
  bool _done = false;
  String? _fileChassis;
  String? _filePlate;
  List<VerificationVehicle> _peers = const <VerificationVehicle>[];
  List<QueuedVerification> _waiting = const <QueuedVerification>[];

  @override
  void initState() {
    super.initState();
    _filePlate = widget.asset.registrationNo;
    _loadFacts();
    _loadWaiting();
  }

  Future<void> _loadWaiting() async {
    final FleetVerificationService? service =
        await ref.read(fleetVerificationServiceProvider.future);
    if (!mounted || service == null) return;
    setState(() {
      _waiting = service
          .waiting()
          .where((QueuedVerification q) => q.vehicleId == widget.asset.id)
          .toList();
    });
  }

  Future<void> _discard(String id) async {
    final FleetVerificationService? service =
        await ref.read(fleetVerificationServiceProvider.future);
    await service?.discard(id);
    await _loadWaiting();
  }

  Future<void> _sendNow() async {
    final FleetVerificationService? service =
        await ref.read(fleetVerificationServiceProvider.future);
    await service?.flush();
    await _loadWaiting();
  }

  Future<void> _loadFacts() async {
    final FleetVerificationRemote remote =
        ref.read(fleetVerificationRemoteProvider);
    try {
      final ({String? registrationNo, String? chassisNo}) id =
          await remote.identity(widget.asset.id);
      final String? org = widget.asset.organisationId;
      final List<VerificationVehicle> peers = org == null
          ? const <VerificationVehicle>[]
          : await remote.peers(orgId: org, country: widget.asset.country);
      if (!mounted) return;
      setState(() {
        _filePlate = id.registrationNo ?? _filePlate;
        _fileChassis = id.chassisNo;
        _peers = peers;
      });
    } on Object {
      // Offline: the preview runs on what the asset row carries; the server decides anyway.
    }
  }

  @override
  void dispose() {
    _asset.dispose();
    _plate.dispose();
    _chassis.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _scanInto(TextEditingController c) async {
    final String? code = await showAssetCameraScanner(context);
    if (code != null && code.trim().isNotEmpty) {
      setState(() => c.text = code.trim());
    }
  }

  Future<void> _pickPhoto({required bool camera}) async {
    final String? path =
        await ref.read(verificationPhotoPickerProvider)(camera: camera);
    if (path != null && mounted) setState(() => _photo = path);
  }

  Future<void> _save(FleetVerificationCopy copy) async {
    if (_outcome == FleetVerificationOutcome.otherCountry &&
        _otherCountry == null) {
      setState(() => _message = copy('needCountry'));
      return;
    }
    setState(() {
      _busy = true;
      _message = null;
    });
    final FleetVerificationService? service =
        await ref.read(fleetVerificationServiceProvider.future);
    if (service == null) {
      setState(() => _busy = false);
      return;
    }
    final HandoverLocationReading gps =
        await ref.read(verificationLocationProvider).read();
    final bool present = _outcome == FleetVerificationOutcome.present;
    final QueuedVerification item = QueuedVerification(
      id: _id,
      vehicleId: widget.asset.id,
      assetNo: widget.asset.assetNo ?? '',
      outcome: _outcome.wire,
      createdAt: DateTime.now(),
      orgId: widget.asset.organisationId,
      country: widget.asset.country,
      observedAssetNo: present ? _asset.text : null,
      observedPlate: present ? _plate.text : null,
      observedChassis: present ? _chassis.text : null,
      otherCountry: _otherCountry,
      note: _note.text,
      lat: gps.captured ? gps.latitude : null,
      lng: gps.captured ? gps.longitude : null,
      accuracyM: gps.captured ? gps.accuracyMeters : null,
      localPhotoPath: _photo,
    );
    final SendOutcome outcome = await service.save(item);
    await _loadWaiting();
    if (!mounted) return;
    final String failedReason = service
            .waiting()
            .where((QueuedVerification q) => q.id == _id)
            .map((QueuedVerification q) => q.failedMessage ?? '')
            .firstOrNull ??
        '';
    final String reason =
        failedReason.startsWith('@') ? copy(failedReason) : failedReason;
    setState(() {
      _busy = false;
      _done = outcome != SendOutcome.failed;
      _message = switch (outcome) {
        SendOutcome.sent => copy('sent'),
        SendOutcome.retryLater => copy('queued'),
        SendOutcome.notSetUp => copy('notSetUp'),
        SendOutcome.failed =>
          copy.fill('failed', <String, String>{'reason': reason}),
      };
    });
  }

  @override
  Widget build(BuildContext context) {
    final FleetVerificationCopy copy = FleetVerificationCopy.of(context);
    final TpPalette palette = TpPalette.of(context);
    final bool allowed = ref.watch(canVerifyOnSiteProvider);
    final VerificationPreview preview = previewVerification(
      vehicle: VerificationVehicle(
        id: widget.asset.id,
        assetNo: widget.asset.assetNo,
        registrationNo: _filePlate,
        chassisNo: _fileChassis,
      ),
      outcome: _outcome,
      observedAssetNo: _asset.text,
      observedPlate: _plate.text,
      observedChassis: _chassis.text,
      hasPhoto: _photo != null,
      others: _peers,
    );
    String list(List<String> keys, String prefix) =>
        keys.map((String k) => copy('$prefix.$k')).join(', ');
    String onFile(String? v) => copy.fill(
          'onFile',
          <String, String>{
            'value': (v == null || v.trim().isEmpty) ? copy('blank') : v,
          },
        );

    return TpScaffold(
      appBar: TpAppBar(
        title: copy('title'),
        subtitle: copy.fill(
          'subtitle',
          <String, String>{'asset': widget.asset.assetNo ?? ''},
        ),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(TpSpace.lg),
          children: <Widget>[
            if (!allowed)
              Padding(
                padding: const EdgeInsets.only(bottom: TpSpace.md),
                child: Text(
                  copy('noAccess'),
                  style: TextStyle(color: palette.critical.base),
                ),
              ),
            if (_waiting.isNotEmpty) ...<Widget>[
              _WaitingList(
                items: _waiting,
                copy: copy,
                onDiscard: _discard,
                onSendNow: _sendNow,
              ),
              const SizedBox(height: TpSpace.lg),
            ],
            Text(
              copy('outcome'),
              style: Theme.of(context).textTheme.titleSmall,
            ),
            const SizedBox(height: TpSpace.sm),
            TpSegmented<FleetVerificationOutcome>(
              expanded: true,
              value: _outcome,
              onChanged: _done
                  ? (_) {}
                  : (FleetVerificationOutcome v) =>
                      setState(() => _outcome = v),
              options: <TpSegmentedOption<FleetVerificationOutcome>>[
                TpSegmentedOption<FleetVerificationOutcome>(
                  value: FleetVerificationOutcome.present,
                  label: copy('present'),
                ),
                TpSegmentedOption<FleetVerificationOutcome>(
                  value: FleetVerificationOutcome.notFound,
                  label: copy('notFound'),
                ),
                TpSegmentedOption<FleetVerificationOutcome>(
                  value: FleetVerificationOutcome.otherCountry,
                  label: copy('otherCountry'),
                ),
              ],
            ),
            const SizedBox(height: TpSpace.lg),
            if (_outcome == FleetVerificationOutcome.otherCountry) ...<Widget>[
              Text(copy('whichCountry')),
              Wrap(
                spacing: TpSpace.sm,
                children: <Widget>[
                  for (final String c in _countries
                      .where((String c) => c != widget.asset.country))
                    ChoiceChip(
                      label: Text(c),
                      selected: _otherCountry == c,
                      onSelected: (_) => setState(() => _otherCountry = c),
                    ),
                ],
              ),
              const SizedBox(height: TpSpace.md),
              Text(
                copy('otherCountryHint'),
                style: TextStyle(color: palette.textSecondary),
              ),
            ],
            if (_outcome == FleetVerificationOutcome.notFound)
              Text(
                copy('notFoundHint'),
                style: TextStyle(color: palette.textSecondary),
              ),
            if (_outcome == FleetVerificationOutcome.present) ...<Widget>[
              _scanRow(
                copy,
                FleetVerificationScreenKeys.assetCode,
                copy('assetCode'),
                _asset,
                null,
              ),
              _scanRow(
                copy,
                FleetVerificationScreenKeys.plate,
                copy('plate'),
                _plate,
                onFile(_filePlate),
              ),
              _scanRow(
                copy,
                FleetVerificationScreenKeys.chassis,
                copy('chassis'),
                _chassis,
                onFile(_fileChassis),
              ),
            ],
            const SizedBox(height: TpSpace.md),
            Text(copy('photo'), style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: TpSpace.sm),
            if (_photo != null)
              ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child:
                    Image.file(File(_photo!), height: 180, fit: BoxFit.cover),
              ),
            Wrap(
              spacing: TpSpace.sm,
              children: <Widget>[
                TpButton.secondary(
                  label:
                      _photo == null ? copy('takePhoto') : copy('retakePhoto'),
                  icon: Icons.photo_camera_outlined,
                  onPressed: _done ? null : () => _pickPhoto(camera: true),
                ),
                TpButton.text(
                  label: copy('gallery'),
                  onPressed: _done ? null : () => _pickPhoto(camera: false),
                ),
              ],
            ),
            Text(
              copy('photoHint'),
              style: TextStyle(color: palette.textMuted, fontSize: 12),
            ),
            const SizedBox(height: TpSpace.md),
            TpInput(label: copy('note'), controller: _note),
            const SizedBox(height: TpSpace.md),
            if (_outcome == FleetVerificationOutcome.present) ...<Widget>[
              if (preview.applyNow.isNotEmpty)
                Text(
                  copy.fill(
                    'willFill',
                    <String, String>{'fields': list(preview.applyNow, 'f')},
                  ),
                ),
              if (preview.status == 'pending')
                Text(
                  copy.fill(
                    'willWait',
                    <String, String>{'reasons': list(preview.flags, 'r')},
                  ),
                  style: TextStyle(color: palette.warning.base),
                ),
              if (preview.status == 'auto_applied') Text(copy('willApply')),
            ],
            Text(
              copy('gps'),
              style: TextStyle(color: palette.textMuted, fontSize: 12),
            ),
            const SizedBox(height: TpSpace.lg),
            if (_message != null)
              Padding(
                padding: const EdgeInsets.only(bottom: TpSpace.md),
                child: Semantics(liveRegion: true, child: Text(_message!)),
              ),
            TpButton.primary(
              key: FleetVerificationScreenKeys.save,
              label: _busy ? copy('saving') : copy('save'),
              isBusy: _busy,
              isFullWidth: true,
              onPressed:
                  (!allowed || _busy || _done) ? null : () => _save(copy),
            ),
          ],
        ),
      ),
    );
  }

  Widget _scanRow(
    FleetVerificationCopy copy,
    Key key,
    String label,
    TextEditingController c,
    String? helper,
  ) =>
      Padding(
        padding: const EdgeInsets.only(bottom: TpSpace.md),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Expanded(
              child: TpInput(
                key: key,
                label: label,
                controller: c,
                helperText: helper,
                onChanged: (_) => setState(() {}),
              ),
            ),
            const SizedBox(width: TpSpace.sm),
            Padding(
              padding: const EdgeInsets.only(top: TpSpace.xl),
              child: IconButton(
                tooltip: copy('scan'),
                icon: const Icon(Icons.qr_code_scanner),
                onPressed: _done ? null : () => _scanInto(c),
              ),
            ),
          ],
        ),
      );
}

/// Checks for this machine that are still on the phone: waiting (with tries)
/// or failed (with the reason). Failed ones can be discarded; nothing is ever
/// dropped silently.
class _WaitingList extends StatelessWidget {
  const _WaitingList({
    required this.items,
    required this.copy,
    required this.onDiscard,
    required this.onSendNow,
  });

  final List<QueuedVerification> items;
  final FleetVerificationCopy copy;
  final Future<void> Function(String id) onDiscard;
  final Future<void> Function() onSendNow;

  String _reason(String raw) => raw.startsWith('@') ? copy(raw) : raw;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return TpCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(
            copy('waitingFor'),
            style: Theme.of(context).textTheme.titleSmall,
          ),
          const SizedBox(height: TpSpace.sm),
          for (final QueuedVerification q in items)
            Padding(
              padding: const EdgeInsets.only(bottom: TpSpace.sm),
              child: Row(
                children: <Widget>[
                  Icon(
                    q.failed ? Icons.error_outline : Icons.schedule,
                    color:
                        q.failed ? palette.critical.base : palette.warning.base,
                  ),
                  const SizedBox(width: TpSpace.sm),
                  Expanded(
                    child: Text(
                      q.failed
                          ? copy.fill('stateFailed', <String, String>{
                              'reason': _reason(q.failedMessage!),
                            })
                          : copy.fill(
                              'stateWaiting',
                              <String, String>{'n': '${q.attempts}'},
                            ),
                    ),
                  ),
                  if (q.failed)
                    TpButton.text(
                      label: copy('discard'),
                      onPressed: () => onDiscard(q.id),
                    ),
                ],
              ),
            ),
          if (items.any((QueuedVerification q) => !q.failed))
            TpButton.secondary(
              label: copy('retryNow'),
              icon: Icons.sync,
              onPressed: onSendNow,
            ),
        ],
      ),
    );
  }
}
