/// Shared harness for the device widget tests: an admin or field-role access
/// state, an in-memory device store and the simulator adapter.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/devices/device_adapters.dart';
import 'package:tyre_pulse/core/devices/device_providers.dart';
import 'package:tyre_pulse/core/devices/paired_device_store.dart';
import 'package:tyre_pulse/core/devices/simulator_device_adapter.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';

const String testUserId = 'user-1';

AccessState accessFor(RoleId role) => AccessState(role: UserRole.known(role));

List<Override> deviceOverrides({
  required RoleId role,
  required MemoryPairedDeviceStore store,
  required SimulatorDeviceAdapter simulator,
}) =>
    <Override>[
      accessStateProvider.overrideWithValue(accessFor(role)),
      deviceOwnerIdProvider.overrideWithValue(testUserId),
      pairedDeviceStoreProvider.overrideWithValue(store),
      simulatorAdapterProvider.overrideWithValue(simulator),
      deviceRadioProvider.overrideWithValue(simulator as DeviceRadio),
    ];

Widget deviceApp({
  required List<Override> overrides,
  required Widget home,
  Locale locale = const Locale('en'),
  double textScale = 1,
  ThemeData? theme,
}) =>
    ProviderScope(
      overrides: overrides,
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: theme ?? TpTheme.light,
        locale: locale,
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        builder: (BuildContext context, Widget? child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(
            textScaler: TextScaler.linear(textScale),
          ),
          child: child!,
        ),
        home: home,
      ),
    );
