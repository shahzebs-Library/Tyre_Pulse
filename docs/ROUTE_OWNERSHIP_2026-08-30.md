# Route ownership and consolidation ledger

This ledger distinguishes a compatibility URL from a product module. A module
has one canonical route and one owner; old URLs may redirect to it, but must not
appear in navigation or command search.

## Completed decisions

| Legacy alias | Canonical route | Owner | Decision |
|---|---|---|---|
| `/ai` | `/ai-command-center` | AI Operations | Smart Analytics was the same destination. One command remains, with the old name retained as a search keyword. |
| `/ai-administration` | `/console/ai-admin` | System Console | Administration remains isolated behind console authentication. |
| `/users` | `/console/users` | System Console | User administration belongs to the isolated console. Internal links now use the canonical URL. |
| `/delete-account` | `/data-deletion` | Trust & Privacy | Compatibility URL retained for published/store links. |
| `/privacy-policy` | `/privacy` | Trust & Privacy | Compatibility URL retained for published/store links. |

All aliases remain replace redirects for bookmarks and preserve query/hash state. Permission lookup first
canonicalises the route, preventing an alias from acquiring a different module
key. The console handoff now reopens the requested console page rather than
dropping the user at the console dashboard.

## Intentionally separate modules

- `/reports` and `/report-center`: report catalogue versus operational report centre.
- `/kpi`, `/kpi-engine`, and `/kpi-command`: scorecard, engineering calculations, and command-level analysis.
- `/fleet`, `/fleet-intelligence`, and `/fleet-health`: analytics, intelligence workflow, and health board.
- `/stock`, `/procurement`, and `/suppliers`: inventory, purchasing workflow, and supplier master data.
- `/work-orders` and `/workshop`: work-order register versus workshop execution.

These routes share domains but expose distinct functionality; consolidation
without product-owner approval would delete unique workflows.

## Unresolved product-owner decisions

- Define lifecycle/versioning policy for the five compatibility aliases and an
  external-link telemetry threshold before any redirect can be removed.
- Decide whether `/analytics`, `/advanced-analytics`, `/comparison`, and
  `/benchmark` should become tabs under one analytics shell. Their current page
  implementations are not equivalent.
- Decide whether executive pages should share a single shell and URL namespace;
  the boards currently have distinct audiences and exports.
- Decide whether accident, incident, insurance-claim and accident-case records
  share one case aggregate. Their data contracts differ, so route deletion is
  unsafe until the domain model is approved.
