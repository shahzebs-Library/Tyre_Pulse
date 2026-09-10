import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/features/search/domain/global_search_route.dart';
import 'package:tyre_pulse/features/search/presentation/global_search_screen.dart';

/// The launching Home route owns navigation. An imperative search page must
/// close before GoRouter pushes a destination, otherwise it covers that page.
/// Returning from the destination reopens the retained search controller state.
Future<void> openGlobalSearch(
  BuildContext context, {
  required bool Function() canRestore,
}) async {
  final navigator = Navigator.of(context);
  final router = GoRouter.of(context);
  final origin = router.routeInformationProvider.value.uri;
  while (context.mounted &&
      canRestore() &&
      router.routeInformationProvider.value.uri == origin) {
    final target = await navigator.push<TpRoute>(
      MaterialPageRoute(
        builder: (_) => const GlobalSearchScreen(route: GlobalSearchRoute()),
      ),
    );
    if (!context.mounted || target == null || !canRestore()) return;
    await router.push<void>(target.location);
    // Router reports the popped location during its next frame. Check the
    // origin after that update, not against the just-closed detail URI.
    await WidgetsBinding.instance.endOfFrame;
  }
}
