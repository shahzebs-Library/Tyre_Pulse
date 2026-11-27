/// Settings > Devices: the gauges, handheld scanners and label printers this
/// person has added on this phone. Add (scan), test (read once / print a test
/// label), forget.
///
/// Pushed with Navigator from Profile; no route is added. Admin-only by
/// default - it checks [devicesAccessProvider] itself, so a deep push by a
/// person without access shows a refusal, not the screen.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/devices/device_adapters.dart';
import 'package:tyre_pulse/core/devices/device_models.dart';
import 'package:tyre_pulse/core/devices/device_providers.dart';
import 'package:tyre_pulse/core/devices/gauge_parser.dart';
import 'package:tyre_pulse/core/devices/known_device_profiles.dart';
import 'package:tyre_pulse/core/devices/label_encoder.dart';
import 'package:tyre_pulse/core/devices/simulator_device_adapter.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/features/devices/presentation/device_copy.dart';
import 'package:uuid/uuid.dart';

abstract final class DevicesScreenKeys {
  static const ValueKey<String> add = ValueKey<String>('devices.add');
  static const ValueKey<String> empty = ValueKey<String>('devices.empty');
  static const ValueKey<String> radioNotice =
      ValueKey<String>('devices.radio-notice');
  static const ValueKey<String> save = ValueKey<String>('devices.save');
  static const ValueKey<String> denied = ValueKey<String>('devices.denied');
  static ValueKey<String> tile(String id) =>
      ValueKey<String>('devices.tile.$id');
  static ValueKey<String> test(String id) =>
      ValueKey<String>('devices.test.$id');
  static ValueKey<String> forget(String id) =>
      ValueKey<String>('devices.forget.$id');
  static ValueKey<String> kind(DeviceKind k) =>
      ValueKey<String>('devices.kind.${k.name}');
  static ValueKey<String> transport(DeviceTransport t) =>
      ValueKey<String>('devices.transport.${t.name}');
  static ValueKey<String> found(String id) =>
      ValueKey<String>('devices.found.$id');
}

/// The Bluetooth state, re-read when the screen asks.
final FutureProvider<RadioState> deviceRadioStateProvider =
    FutureProvider<RadioState>(
  (ref) => ref.watch(deviceRadioProvider).state(),
);

class DevicesScreen extends ConsumerWidget {
  const DevicesScreen({super.key});

  static Route<void> route() => MaterialPageRoute<void>(
        builder: (_) => const DevicesScreen(),
        settings: const RouteSettings(name: 'profile/devices'),
      );

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final bool allowed = ref.watch(devicesAccessProvider);
    return TpScaffold(
      appBar: TpAppBar(
        title: l10n.devicesTitle,
        onBack: () => Navigator.of(context).maybePop(),
      ),
      floatingActionButton: allowed
          ? FloatingActionButton.extended(
              key: DevicesScreenKeys.add,
              onPressed: () => unawaited(_addDevice(context)),
              icon: const Icon(Icons.add_rounded),
              label: Text(l10n.devicesAdd),
            )
          : null,
      body: allowed
          ? const _DevicesBody()
          : TpEmptyState(
              key: DevicesScreenKeys.denied,
              icon: Icons.lock_outline_rounded,
              message: l10n.deniedNotGranted,
            ),
    );
  }

  Future<void> _addDevice(BuildContext context) async {
    await TpBottomSheet.show<void>(
      context: context,
      title: AppLocalizations.of(context).devicesAdd,
      builder: (_) => const _AddDeviceSheet(),
    );
  }
}

class _DevicesBody extends ConsumerWidget {
  const _DevicesBody();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AsyncValue<List<PairedDevice>> devices =
        ref.watch(pairedDevicesProvider);
    final RadioState? radio = ref.watch(deviceRadioStateProvider).asData?.value;
    final String? radioMessage =
        radio == null ? null : radioStateMessage(l10n, radio);

    final List<Widget> header = <Widget>[
      Text(
        l10n.devicesIntro,
        style: Theme.of(context).textTheme.bodyMedium,
      ),
      if (radioMessage != null) ...<Widget>[
        const SizedBox(height: TpSpace.md),
        _RadioNotice(
          message: radioMessage,
          canRequest: radio == RadioState.unauthorized,
        ),
      ],
      const SizedBox(height: TpSpace.lg),
    ];

    return devices.when(
      loading: () => const TpLoadingState(),
      error: (Object e, StackTrace st) => TpErrorState(
        error: AppError(
          kind: AppErrorKind.storage,
          message: l10n.devicesLoadFailed,
          cause: e,
          isRetryable: true,
        ),
        onRetry: () => ref.invalidate(pairedDevicesProvider),
      ),
      data: (List<PairedDevice> list) => ListView(
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.xxxl * 2,
        ),
        children: <Widget>[
          ...header,
          if (list.isEmpty)
            TpEmptyState(
              key: DevicesScreenKeys.empty,
              icon: Icons.devices_other_rounded,
              title: l10n.devicesEmptyTitle,
              message: l10n.devicesEmptyMessage,
            )
          else
            for (final PairedDevice d in list) ...<Widget>[
              _DeviceTile(device: d),
              const SizedBox(height: TpSpace.md),
            ],
        ],
      ),
    );
  }
}

class _RadioNotice extends ConsumerWidget {
  const _RadioNotice({required this.message, required this.canRequest});

  final String message;
  final bool canRequest;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final TpPalette palette = TpPalette.of(context);
    final AppLocalizations l10n = AppLocalizations.of(context);
    return TpCard(
      key: DevicesScreenKeys.radioNotice,
      background: palette.warning.soft,
      borderColor: palette.warning.base,
      padding: const EdgeInsets.all(TpSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Icon(
                Icons.bluetooth_disabled_rounded,
                color: palette.warning.onSoft,
              ),
              const SizedBox(width: TpSpace.sm),
              Expanded(
                child: Text(
                  message,
                  style: TextStyle(color: palette.warning.onSoft),
                ),
              ),
            ],
          ),
          if (canRequest) ...<Widget>[
            const SizedBox(height: TpSpace.sm),
            TpButton.secondary(
              label: l10n.devicesAllowBluetooth,
              isCompact: true,
              onPressed: () async {
                await ref.read(deviceRadioProvider).requestPermission();
                ref.invalidate(deviceRadioStateProvider);
              },
            ),
          ],
        ],
      ),
    );
  }
}

class _DeviceTile extends ConsumerStatefulWidget {
  const _DeviceTile({required this.device});

  final PairedDevice device;

  @override
  ConsumerState<_DeviceTile> createState() => _DeviceTileState();
}

class _DeviceTileState extends ConsumerState<_DeviceTile> {
  bool _busy = false;
  String? _result;
  bool _resultIsError = false;
  int? _battery;

  PairedDevice get d => widget.device;

  Future<void> _test() async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final DeviceService service = ref.read(deviceServiceProvider);
    setState(() {
      _busy = true;
      _result = null;
    });
    try {
      if (d.kind == DeviceKind.labelPrinter) {
        await service.printLabel(
          d,
          LabelData(code: 'TP-TEST-0001', name: l10n.devicesTestLabelName),
        );
        _setResult(l10n.devicesTestPrinted, isError: false);
      } else if (d.kind.isGauge) {
        final GaugeReading reading = await service.readGauge(
          d,
          d.kind.readsPressure ? GaugeQuantity.pressure : GaugeQuantity.tread,
        );
        final int? battery = await service.batteryLevel(d);
        if (mounted) setState(() => _battery = battery);
        _setResult(
          l10n.devicesTestReading(gaugeValueText(l10n, reading)),
          isError: false,
        );
      } else if (d.kind == DeviceKind.rfidReader &&
          d.transport != DeviceTransport.hid) {
        throw const DeviceFailure(DeviceFailureReason.needsVendorSdk);
      } else {
        _setResult(l10n.hidScannerReady, isError: false);
      }
    } on Object catch (error) {
      _setResult(deviceFailureMessage(l10n, error), isError: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _setResult(String text, {required bool isError}) {
    if (!mounted) return;
    setState(() {
      _result = text;
      _resultIsError = isError;
    });
  }

  Future<void> _forget() async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final bool? ok = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialog) => AlertDialog(
        content: Text(l10n.devicesForgetConfirm(d.name)),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialog).pop(false),
            child: Text(l10n.actionCancel),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialog).pop(true),
            child: Text(l10n.devicesForget),
          ),
        ],
      ),
    );
    if (ok ?? false) {
      await ref.read(pairedDevicesProvider.notifier).forget(d);
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final TpPalette palette = TpPalette.of(context);
    final bool testable = d.transport != DeviceTransport.hid || !d.kind.isGauge;
    return TpCard(
      key: DevicesScreenKeys.tile(d.id),
      padding: const EdgeInsets.all(TpSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Icon(deviceKindIcon(d.kind), color: palette.primary),
              const SizedBox(width: TpSpace.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      d.name,
                      style: Theme.of(context).textTheme.titleMedium,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    Text(
                      '${deviceKindLabel(l10n, d.kind)} · '
                      '${deviceTransportLabel(l10n, d.transport)}',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: palette.textSecondary,
                          ),
                    ),
                    if (_battery != null)
                      Text(
                        l10n.devicesBattery(_battery!),
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                  ],
                ),
              ),
            ],
          ),
          if (_result != null) ...<Widget>[
            const SizedBox(height: TpSpace.sm),
            Text(
              _result!,
              style: TextStyle(
                color:
                    _resultIsError ? palette.critical.base : palette.ok.onSoft,
              ),
            ),
          ],
          const SizedBox(height: TpSpace.sm),
          Wrap(
            spacing: TpSpace.sm,
            runSpacing: TpSpace.sm,
            children: <Widget>[
              if (testable)
                TpButton.secondary(
                  key: DevicesScreenKeys.test(d.id),
                  label: d.kind == DeviceKind.labelPrinter
                      ? l10n.devicesTestPrint
                      : d.kind.isGauge
                          ? l10n.devicesTestRead
                          : l10n.devicesTest,
                  isCompact: true,
                  isBusy: _busy,
                  onPressed: _busy ? null : () => unawaited(_test()),
                ),
              TpButton(
                key: DevicesScreenKeys.forget(d.id),
                label: l10n.devicesForget,
                variant: TpButtonVariant.secondary,
                icon: Icons.link_off_rounded,
                isCompact: true,
                onPressed: _busy ? null : () => unawaited(_forget()),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Add flow: kind -> connection -> (scan | address | name) -> save.
class _AddDeviceSheet extends ConsumerStatefulWidget {
  const _AddDeviceSheet();

  @override
  ConsumerState<_AddDeviceSheet> createState() => _AddDeviceSheetState();
}

class _AddDeviceSheetState extends ConsumerState<_AddDeviceSheet> {
  DeviceKind? _kind;
  DeviceTransport? _transport;
  DiscoveredDevice? _picked;
  final List<DiscoveredDevice> _found = <DiscoveredDevice>[];
  StreamSubscription<DiscoveredDevice>? _scan;
  bool _scanning = false;
  String? _scanError;
  final TextEditingController _name = TextEditingController();
  final TextEditingController _host = TextEditingController();
  final TextEditingController _port = TextEditingController(text: '9100');
  PrinterLanguage _language = PrinterLanguage.zpl;
  LabelSize _size = defaultLabelSize;
  bool _showErrors = false;

  @override
  void dispose() {
    unawaited(_scan?.cancel());
    _name.dispose();
    _host.dispose();
    _port.dispose();
    super.dispose();
  }

  List<DeviceTransport> _transportsFor(DeviceKind kind) => <DeviceTransport>[
        if (kind != DeviceKind.scanner) DeviceTransport.ble,
        if (kind != DeviceKind.labelPrinter) DeviceTransport.hid,
        if (kind == DeviceKind.labelPrinter) DeviceTransport.network,
        if (simulatorDevicesAvailable &&
            (kind.isGauge || kind == DeviceKind.labelPrinter))
          DeviceTransport.simulator,
      ];

  Future<void> _startScan() async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    await _scan?.cancel();
    setState(() {
      _found.clear();
      _scanError = null;
      _scanning = true;
    });
    final DeviceRadio radio = _transport == DeviceTransport.simulator
        ? ref.read(simulatorAdapterProvider)!
        : ref.read(deviceRadioProvider);
    RadioState state = await radio.state();
    if (state == RadioState.unauthorized) {
      state = await radio.requestPermission();
    }
    final String? blocked = radioStateMessage(l10n, state);
    if (blocked != null) {
      ref.invalidate(deviceRadioStateProvider);
      if (mounted) {
        setState(() {
          _scanError = blocked;
          _scanning = false;
        });
      }
      return;
    }
    _scan = radio.scan(duration: const Duration(seconds: 12)).listen(
      (DiscoveredDevice d) {
        if (mounted) setState(() => _found.add(d));
      },
      onError: (Object e) {
        if (mounted) setState(() => _scanError = deviceFailureMessage(l10n, e));
      },
      onDone: () {
        if (mounted) setState(() => _scanning = false);
      },
    );
  }

  void _chooseTransport(DeviceTransport t) {
    setState(() {
      _transport = t;
      _picked = null;
    });
    if (t == DeviceTransport.ble || t == DeviceTransport.simulator) {
      unawaited(_startScan());
    }
  }

  DeviceProfile _profile() {
    final DeviceKind kind = _kind!;
    if (kind == DeviceKind.labelPrinter) {
      final DeviceProfile base =
          _transport == DeviceTransport.ble && _picked != null
              ? printerProfileFor(_picked!)
              : DeviceProfile(printerLanguage: _language);
      return base.copyWith(
        printerLanguage: _language,
        labelSize: _size,
        host: _transport == DeviceTransport.network ? _host.text.trim() : null,
        port: int.tryParse(_port.text.trim()) ?? 9100,
      );
    }
    if (kind.isGauge && _transport == DeviceTransport.ble) {
      return genericBleGaugeProfile(kind);
    }
    return const DeviceProfile();
  }

  Future<void> _save() async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final DeviceTransport t = _transport!;
    final bool needsPick =
        t == DeviceTransport.ble || t == DeviceTransport.simulator;
    final bool missingHost =
        t == DeviceTransport.network && _host.text.trim().isEmpty;
    if ((needsPick && _picked == null) ||
        missingHost ||
        (!needsPick && _name.text.trim().isEmpty)) {
      setState(() => _showErrors = true);
      return;
    }
    final String id = switch (t) {
      DeviceTransport.ble || DeviceTransport.simulator => _picked!.id,
      DeviceTransport.network =>
        '${_host.text.trim()}:${int.tryParse(_port.text.trim()) ?? 9100}',
      DeviceTransport.hid => 'hid-${const Uuid().v4()}',
    };
    final String name = _name.text.trim().isNotEmpty
        ? _name.text.trim()
        : (_picked?.name?.trim().isNotEmpty ?? false)
            ? _picked!.name!.trim()
            : l10n.devicesUnnamed;
    await ref.read(pairedDevicesProvider.notifier).add(
          PairedDevice(
            id: id,
            name: name,
            kind: _kind!,
            transport: t,
            profile: _profile(),
            addedAt: DateTime.now(),
          ),
        );
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final DeviceKind? kind = _kind;
    final DeviceTransport? transport = _transport;
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(
        TpSpace.xl,
        TpSpace.md,
        TpSpace.xl,
        TpSpace.xl,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          if (kind == null) ...<Widget>[
            Text(
              l10n.devicesChooseKind,
              style: Theme.of(context).textTheme.titleSmall,
            ),
            for (final DeviceKind k in DeviceKind.values)
              ListTile(
                key: DevicesScreenKeys.kind(k),
                contentPadding: EdgeInsets.zero,
                leading: Icon(deviceKindIcon(k)),
                title: Text(deviceKindLabel(l10n, k)),
                onTap: () => setState(() {
                  _kind = k;
                  _language = PrinterLanguage.zpl;
                }),
              ),
          ] else if (transport == null) ...<Widget>[
            Text(
              l10n.devicesChooseConnection,
              style: Theme.of(context).textTheme.titleSmall,
            ),
            for (final DeviceTransport t in _transportsFor(kind))
              ListTile(
                key: DevicesScreenKeys.transport(t),
                contentPadding: EdgeInsets.zero,
                leading: Icon(
                  switch (t) {
                    DeviceTransport.ble => Icons.bluetooth_rounded,
                    DeviceTransport.hid => Icons.keyboard_alt_outlined,
                    DeviceTransport.network => Icons.lan_outlined,
                    DeviceTransport.simulator => Icons.science_outlined,
                  },
                ),
                title: Text(deviceTransportLabel(l10n, t)),
                onTap: () => _chooseTransport(t),
              ),
          ] else ...<Widget>[
            ..._detailFields(context, l10n, kind, transport),
            const SizedBox(height: TpSpace.lg),
            TpButton(
              key: DevicesScreenKeys.save,
              label: l10n.devicesSave,
              isFullWidth: true,
              onPressed: () => unawaited(_save()),
            ),
          ],
        ],
      ),
    );
  }

  List<Widget> _detailFields(
    BuildContext context,
    AppLocalizations l10n,
    DeviceKind kind,
    DeviceTransport transport,
  ) {
    final TpPalette palette = TpPalette.of(context);
    final bool scanned = transport == DeviceTransport.ble ||
        transport == DeviceTransport.simulator;
    return <Widget>[
      if (kind == DeviceKind.rfidReader && transport == DeviceTransport.ble)
        Padding(
          padding: const EdgeInsets.only(bottom: TpSpace.md),
          child: Text(
            l10n.devicesErrorVendorSdk,
            style: TextStyle(color: palette.warning.onSoft),
          ),
        ),
      if (transport == DeviceTransport.hid)
        Padding(
          padding: const EdgeInsets.only(bottom: TpSpace.md),
          child: Text(l10n.devicesHidHint),
        ),
      if (scanned) ...<Widget>[
        if (_scanning)
          Row(
            children: <Widget>[
              const SizedBox.square(
                dimension: 20,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
              const SizedBox(width: TpSpace.sm),
              Expanded(child: Text(l10n.devicesScanning)),
            ],
          ),
        if (_scanError != null)
          Text(_scanError!, style: TextStyle(color: palette.critical.base)),
        if (!_scanning && _found.isEmpty && _scanError == null)
          Text(l10n.devicesScanNone),
        for (final DiscoveredDevice f in _found)
          ListTile(
            key: DevicesScreenKeys.found(f.id),
            contentPadding: EdgeInsets.zero,
            selected: _picked?.id == f.id,
            leading: Icon(
              _picked?.id == f.id
                  ? Icons.radio_button_checked_rounded
                  : Icons.radio_button_unchecked_rounded,
            ),
            onTap: () => setState(() => _picked = f),
            title: Text(
              (f.name?.trim().isNotEmpty ?? false)
                  ? f.name!
                  : l10n.devicesUnnamed,
            ),
            subtitle: Text(f.id, maxLines: 1, overflow: TextOverflow.ellipsis),
          ),
        if (_showErrors && _picked == null)
          Text(
            l10n.devicesFieldRequired,
            style: TextStyle(color: palette.critical.base),
          ),
        if (!_scanning)
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: TextButton.icon(
              onPressed: () => unawaited(_startScan()),
              icon: const Icon(Icons.refresh_rounded),
              label: Text(l10n.devicesScanAgain),
            ),
          ),
        const SizedBox(height: TpSpace.md),
      ],
      TpInput(
        label: l10n.devicesNameLabel,
        controller: _name,
        isRequired: !scanned,
        errorText: _showErrors && !scanned && _name.text.trim().isEmpty
            ? l10n.devicesFieldRequired
            : null,
      ),
      if (transport == DeviceTransport.network) ...<Widget>[
        const SizedBox(height: TpSpace.md),
        TpInput(
          label: l10n.devicesHostLabel,
          controller: _host,
          isRequired: true,
          keyboardType: TextInputType.url,
          errorText: _showErrors && _host.text.trim().isEmpty
              ? l10n.devicesFieldRequired
              : null,
        ),
        const SizedBox(height: TpSpace.md),
        TpInput(
          label: l10n.devicesPortLabel,
          controller: _port,
          keyboardType: TextInputType.number,
        ),
      ],
      if (kind == DeviceKind.labelPrinter) ...<Widget>[
        const SizedBox(height: TpSpace.md),
        Text(
          l10n.devicesLanguageLabel,
          style: Theme.of(context).textTheme.labelMedium,
        ),
        Wrap(
          spacing: TpSpace.sm,
          children: <Widget>[
            for (final PrinterLanguage lang in PrinterLanguage.values)
              ChoiceChip(
                label: Text(printerLanguageLabel(lang)),
                selected: _language == lang,
                onSelected: (_) => setState(() => _language = lang),
              ),
          ],
        ),
        const SizedBox(height: TpSpace.md),
        Text(
          l10n.devicesLabelSizeLabel,
          style: Theme.of(context).textTheme.labelMedium,
        ),
        Wrap(
          spacing: TpSpace.sm,
          children: <Widget>[
            for (final LabelSize size in LabelSize.values)
              ChoiceChip(
                label: Text(labelSizeLabel(size)),
                selected: _size == size,
                onSelected: (_) => setState(() => _size = size),
              ),
          ],
        ),
      ],
    ];
  }
}
