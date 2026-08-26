/// This feature's would-be contribution to the shared screen registry -
/// EMPTY today, and the reason is stronger than every other feature's
/// "dormant until `main.dart` joins it" story.
///
/// # Why this map is empty, not a real registration
///
/// `TpScreenBuilder` (`app/router/screen_registry.dart`) is fixed as
/// `Widget Function(BuildContext, TpRoute)` - every registration in this
/// codebase keys a builder that takes the router's own sealed [TpRoute]
/// union and narrows it. [GlobalSearchRoute] cannot BE a [TpRoute] from
/// this file (see `domain/global_search_route.dart`'s own library comment:
/// `TpRoute` is `sealed`, so only a class declared inside `routes.dart`
/// itself may extend it - confirmed by `flutter analyze`, not assumed).
/// So there is no builder this file can honestly write that both
/// type-checks against `TpScreenBuilder` today AND does something real
/// with a [GlobalSearchRoute] - forcing one would mean either a builder
/// that can never be reached with the right type, or a fabricated
/// `TpRoute` cast that lies about the relationship.
///
/// # What actually finishes this
///
/// A human moving (or copying) [GlobalSearchRoute]'s body into
/// `routes.dart` as a real `final class ... extends TpRoute` - not merely
/// adding a `TpRouteId.globalSearch` constant elsewhere - is what makes a
/// real registration possible. At that point this file gains one entry,
/// exactly the shape `features/work_orders/
/// work_orders_screen_registrations.dart` already demonstrates: `{route
/// .routeId: builder}` plus a builder that narrows via `route is!
/// GlobalSearchRoute` before handing it to [GlobalSearchScreen].
library;

import 'package:tyre_pulse/app/router/screen_registry.dart';

/// Empty until `GlobalSearchRoute` can genuinely extend `TpRoute` - see
/// this file's own library comment. `TpScreenRegistry.empty`'s own doc
/// comment already establishes that an empty builder map is a normal,
/// supported state ("every route renders the not built yet state"), so
/// joining this into `main.dart`'s chain today costs nothing and needs no
/// further change once the router side is wired - only this map's one
/// entry does.
final Map<String, TpScreenBuilder> globalSearchScreenRegistrations =
    <String, TpScreenBuilder>{};
