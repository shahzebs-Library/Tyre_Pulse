import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/fleet_ai/presentation/fleet_ai_screen.dart';

final Map<String, TpScreenBuilder> fleetAiScreenRegistrations =
    <String, TpScreenBuilder>{
  TpRouteId.fleetAi: (context, route) => const FleetAiScreen(),
};
