library;

import 'package:tyre_pulse/features/driver_workspace/domain/driver_workspace.dart';

final class DriverWorkspaceDto {
  DriverWorkspaceDto.fromJson(Object? value)
      : data = value is Map
            ? Map<String, Object?>.from(value)
            : throw const FormatException(
                'Driver workspace response unavailable',
              );
  final DriverRow data;
  DriverWorkspaceSnapshot toDomain({bool offline = false}) =>
      DriverWorkspaceSnapshot(
        data: data,
        offline: offline,
        truncated: data['truncated'] == true,
      );
}
