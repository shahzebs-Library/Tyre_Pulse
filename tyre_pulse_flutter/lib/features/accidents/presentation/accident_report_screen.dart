library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/accidents/accidents_providers.dart';
import 'package:tyre_pulse/features/accidents/data/accident_photo_capture.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_copy.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_ui.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_fleet_providers.dart';
import 'package:uuid/uuid.dart';

class AccidentReportScreen extends ConsumerStatefulWidget {
  const AccidentReportScreen({required this.route, super.key});
  final AccidentReportRoute route;

  @override
  ConsumerState<AccidentReportScreen> createState() =>
      _AccidentReportScreenState();
}

class _AccidentReportScreenState extends ConsumerState<AccidentReportScreen> {
  final TextEditingController _asset = TextEditingController();
  final TextEditingController _site = TextEditingController();
  final TextEditingController _location = TextEditingController();
  final TextEditingController _description = TextEditingController();
  final TextEditingController _notes = TextEditingController();
  final String _sessionKey = const Uuid().v4();
  final List<String> _photos = <String>[];
  VehicleAsset? _selectedVehicle;
  String _severity = 'minor';
  String _type = 'other';
  String? _error;

  @override
  void dispose() {
    _asset.dispose();
    _site.dispose();
    _location.dispose();
    _description.dispose();
    _notes.dispose();
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

  Future<void> _pickVehicle(List<VehicleAsset> assets) async {
    final AccidentCopy copy = AccidentCopy.of(context);
    final TextEditingController search = TextEditingController();
    final VehicleAsset? selected = await showModalBottomSheet<VehicleAsset>(
      context: context,
      isScrollControlled: true,
      builder: (BuildContext context) => StatefulBuilder(
        builder: (BuildContext context, StateSetter setSheetState) {
          final String query = search.text.trim().toLowerCase();
          final List<VehicleAsset> shown = assets
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
                height: MediaQuery.sizeOf(context).height * .72,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      copy('selectAsset'),
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    const SizedBox(height: TpSpace.md),
                    TpSearchField(
                      controller: search,
                      hint: copy('assetSearch'),
                      onChanged: (_) => setSheetState(() {}),
                    ),
                    const SizedBox(height: TpSpace.md),
                    Expanded(
                      child: ListView.builder(
                        itemCount: shown.length,
                        itemBuilder: (BuildContext context, int index) {
                          final VehicleAsset asset = shown[index];
                          return ListTile(
                            leading: const Icon(Icons.local_shipping_outlined),
                            title:
                                Text(asset.assetNo ?? copy('unrecordedAsset')),
                            subtitle: Text(
                              <String?>[
                                asset.fleetNumber,
                                asset.registrationNo,
                                asset.vehicleType,
                                asset.site,
                              ].whereType<String>().join(' • '),
                            ),
                            onTap: () => Navigator.of(context).pop(asset),
                          );
                        },
                      ),
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
    search.dispose();
    if (selected == null || !mounted) return;
    setState(() {
      _selectedVehicle = selected;
      _asset.text = selected.assetNo ?? '';
      if ((selected.site ?? '').trim().isNotEmpty) _site.text = selected.site!;
    });
  }

  Future<void> _capture(AccidentPhotoSource source) async {
    try {
      final String? path = await ref.read(accidentPhotoCaptureProvider).capture(
            sessionKey: _sessionKey,
            source: source,
          );
      if (!mounted || path == null) return;
      setState(() {
        _photos.add(path);
        _error = null;
      });
    } on Object {
      if (mounted) {
        setState(
          () => _error = AccidentCopy.of(context)('photoFailed'),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final String fallback = TpBackFallbacks.forRoute(widget.route);
    final AccidentCopy copy = AccidentCopy.of(context);
    final AsyncValue<VehicleFleetListOutcome> fleet =
        ref.watch(vehicleFleetListProvider);
    final List<VehicleAsset> assets = fleet.value == null
        ? const <VehicleAsset>[]
        : _assetsFrom(fleet.value!);
    return TpScaffold(
      backFallback: fallback,
      resizeToAvoidBottomInset: true,
      appBar: TpAppBar(
        title: copy('reportTitle'),
        subtitle: AppLocalizations.of(context).accidentReportCaptureSubtitle,
        backFallback: fallback,
      ),
      body: ListView(
        padding: const EdgeInsets.all(TpSpace.lg),
        children: <Widget>[
          AccidentHero(
            eyebrow: copy('firstResponse'),
            title: copy('captureFacts'),
            message: copy('captureFactsMessage'),
            icon: Icons.add_a_photo_outlined,
          ),
          const SizedBox(height: TpSpace.lg),
          AccidentSection(
            title: copy('assetLocation'),
            subtitle: copy('assetLocationHint'),
            icon: Icons.local_shipping_outlined,
            child: Column(
              children: <Widget>[
                if (assets.isNotEmpty)
                  TpButton.secondary(
                    label: _selectedVehicle == null
                        ? copy('selectAsset')
                        : copy('changeAsset'),
                    icon: Icons.search,
                    onPressed: () => _pickVehicle(assets),
                    isFullWidth: true,
                  ),
                if (fleet.hasError)
                  Padding(
                    padding: const EdgeInsets.only(bottom: TpSpace.sm),
                    child: Text(copy('fleetUnavailable')),
                  ),
                const SizedBox(height: TpSpace.md),
                TpInput(
                  label: copy('assetNo'),
                  controller: _asset,
                  isRequired: true,
                  enabled: _selectedVehicle == null,
                  prefixIcon: Icons.pin_outlined,
                  onChanged: (_) => setState(() {}),
                ),
                const SizedBox(height: TpSpace.md),
                TpInput(
                  label: copy('site'),
                  controller: _site,
                  isRequired: true,
                  prefixIcon: Icons.location_city_outlined,
                  onChanged: (_) => setState(() {}),
                ),
                const SizedBox(height: TpSpace.md),
                TpInput(
                  label: copy('exactLocation'),
                  controller: _location,
                ),
              ],
            ),
          ),
          const SizedBox(height: TpSpace.md),
          AccidentSection(
            title: copy('classification'),
            subtitle: copy('classificationHint'),
            icon: Icons.rule_outlined,
            child: Column(
              children: <Widget>[
                DropdownButtonFormField<String>(
                  initialValue: _severity,
                  decoration: InputDecoration(labelText: copy('severity')),
                  items: <DropdownMenuItem<String>>[
                    DropdownMenuItem(
                      value: 'minor',
                      child: Text(copy('minor')),
                    ),
                    DropdownMenuItem(
                      value: 'moderate',
                      child: Text(copy('moderate')),
                    ),
                    DropdownMenuItem(
                      value: 'severe',
                      child: Text(copy('severe')),
                    ),
                    DropdownMenuItem(
                      value: 'fatal',
                      child: Text(copy('fatal')),
                    ),
                  ],
                  onChanged: (String? value) =>
                      setState(() => _severity = value ?? _severity),
                ),
                const SizedBox(height: TpSpace.md),
                DropdownButtonFormField<String>(
                  initialValue: _type,
                  decoration: InputDecoration(labelText: copy('type')),
                  items: <DropdownMenuItem<String>>[
                    DropdownMenuItem(
                      value: 'collision',
                      child: Text(copy('collision')),
                    ),
                    DropdownMenuItem(
                      value: 'rollover',
                      child: Text(copy('rollover')),
                    ),
                    DropdownMenuItem(
                      value: 'property_damage',
                      child: Text(copy('propertyDamage')),
                    ),
                    DropdownMenuItem(
                      value: 'other',
                      child: Text(copy('other')),
                    ),
                  ],
                  onChanged: (String? value) =>
                      setState(() => _type = value ?? _type),
                ),
                const SizedBox(height: TpSpace.md),
                TpInput(
                  label: copy('whatHappened'),
                  controller: _description,
                  isRequired: true,
                  maxLines: 5,
                  onChanged: (_) => setState(() {}),
                ),
                const SizedBox(height: TpSpace.md),
                TpInput(
                  label: copy('notes'),
                  controller: _notes,
                  maxLines: 3,
                ),
              ],
            ),
          ),
          const SizedBox(height: TpSpace.md),
          AccidentSection(
            title: copy('evidence'),
            subtitle: '${_photos.length} ${copy('evidenceAttached')}',
            icon: Icons.photo_library_outlined,
            child: Column(
              children: <Widget>[
                Row(
                  children: <Widget>[
                    Expanded(
                      child: TpButton.secondary(
                        label: copy('camera'),
                        icon: Icons.camera_alt_outlined,
                        onPressed: () => _capture(AccidentPhotoSource.camera),
                      ),
                    ),
                    const SizedBox(width: TpSpace.sm),
                    Expanded(
                      child: TpButton.secondary(
                        label: copy('gallery'),
                        icon: Icons.photo_outlined,
                        onPressed: () => _capture(AccidentPhotoSource.gallery),
                      ),
                    ),
                  ],
                ),
                for (int i = 0; i < _photos.length; i++)
                  ListTile(
                    leading: const Icon(Icons.image_outlined),
                    title: Text('${copy('evidencePhoto')} ${i + 1}'),
                    trailing: IconButton(
                      tooltip: copy('removePhoto'),
                      icon: const Icon(Icons.close),
                      onPressed: () => setState(() => _photos.removeAt(i)),
                    ),
                  ),
              ],
            ),
          ),
          if (_error != null) ...<Widget>[
            const SizedBox(height: TpSpace.md),
            Text(
              _error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ],
          const SizedBox(height: TpSpace.lg),
          Text(AppLocalizations.of(context).accidentSubmitUnavailable),
          const SizedBox(height: TpSpace.sm),
          TpButton.primary(
            label: copy('saveReport'),
            icon: Icons.shield_outlined,
            isFullWidth: true,
            onPressed: null,
          ),
          const SizedBox(height: TpSpace.xxxl),
        ],
      ),
    );
  }
}
