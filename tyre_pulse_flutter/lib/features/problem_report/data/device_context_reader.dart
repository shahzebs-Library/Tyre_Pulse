/// Reads the device model and operating system for a problem report.
///
/// Uses `device_info_plus` - the only way to read a device MODEL on Android
/// without a hand-written platform channel. Never throws: a value that cannot
/// be read is null, and the report still goes.
library;

import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/foundation.dart';

/// Device model and OS, either of which may be unknown.
typedef DeviceDescription = ({String? device, String? os});

abstract interface class DeviceContextReader {
  Future<DeviceDescription> read();
}

/// Joins manufacturer and model without repeating the brand
/// ("samsung SM-A155F", not "samsung samsung SM-A155F").
@visibleForTesting
String? describeAndroidModel(String? manufacturer, String? model) {
  final String brand = (manufacturer ?? '').trim();
  final String name = (model ?? '').trim();
  if (name.isEmpty) return brand.isEmpty ? null : brand;
  if (brand.isEmpty || name.toLowerCase().startsWith(brand.toLowerCase())) {
    return name;
  }
  return '$brand $name';
}

/// "Android 14 (SDK 34)", or null when nothing is known.
@visibleForTesting
String? describeAndroidOs(String? release, int? sdk) {
  final String r = (release ?? '').trim();
  if (r.isEmpty && sdk == null) return null;
  if (r.isEmpty) return 'Android (SDK $sdk)';
  return sdk == null ? 'Android $r' : 'Android $r (SDK $sdk)';
}

final class DeviceInfoPlusContextReader implements DeviceContextReader {
  DeviceInfoPlusContextReader([DeviceInfoPlugin? plugin])
      : _plugin = plugin ?? DeviceInfoPlugin();

  final DeviceInfoPlugin _plugin;

  @override
  Future<DeviceDescription> read() async {
    if (kIsWeb) return (device: null, os: 'Web');
    try {
      switch (defaultTargetPlatform) {
        case TargetPlatform.android:
          final AndroidDeviceInfo info = await _plugin.androidInfo;
          return (
            device: describeAndroidModel(info.manufacturer, info.model),
            os: describeAndroidOs(info.version.release, info.version.sdkInt),
          );
        case TargetPlatform.iOS:
          final IosDeviceInfo info = await _plugin.iosInfo;
          final String version = info.systemVersion.trim();
          return (
            device: info.utsname.machine.trim().isEmpty
                ? null
                : info.utsname.machine.trim(),
            os: version.isEmpty ? 'iOS' : 'iOS $version',
          );
        case TargetPlatform.fuchsia:
        case TargetPlatform.linux:
        case TargetPlatform.macOS:
        case TargetPlatform.windows:
          return (device: null, os: defaultTargetPlatform.name);
      }
    } on Object {
      return (device: null, os: null);
    }
  }
}
