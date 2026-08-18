# Tyre Pulse - Google Play Store Listing Pack

All graphics here are built from the real Tyre Pulse brand mark (brand green #16a34a).

## Assets in this folder
| File | Size | Where it goes in Play Console |
|---|---|---|
| `play_store_icon_512.png` | 512 x 512 | Store listing > App icon (hi-res) |
| `feature_graphic_1024x500.png` | 1024 x 500 | Store listing > Feature graphic |
| `splash_2048.png` | 2048 x 2048 | Reference of the in-app splash (already set in the app) |

## Store listing status - LIVE, do not re-do

**The app is already published in Production with the listing complete and
approved.** Screenshots, data safety, content rating, target audience, App
access and the privacy policy are all done in Play Console.

The checklist that used to sit here was written in August and listed those as
outstanding. It was stale, and reading it instead of Play Console led to the
owner being told to redo work already finished. **Play Console is the source of
truth for listing state - this file is only a copy of the text and the graphics.**

What still lives here and is genuinely useful:
| File | Use |
|---|---|
| `RELEASE_NOTES.md` | The "What's new" text for each release, English + Arabic |
| `play_store_icon_512.png` | The 512 icon, if the listing ever needs re-uploading |
| `feature_graphic_1024x500.png` | The feature graphic, same |
| `splash_2048.png` | Reference of the in-app splash |

### Shipping a new version
1. Run the "Release to Google Play (Closed testing)" workflow on `main`.
2. Play Console -> Testing -> Closed testing -> open the release -> **Promote
   release -> Production** -> roll out. Same AAB, no rebuild.
3. Paste that version's "What's new" from `RELEASE_NOTES.md`.
4. Set `system_config.mobile_latest_version` to the new version AFTER it is live.

## Short description (80 char max)
Fleet tyre, inspection, maintenance and accident intelligence for your whole fleet.

## Full description (draft)
Tyre Pulse is a complete fleet operations platform that turns everyday tyre,
maintenance and inspection data into decisions that cut cost and downtime.

INSPECTIONS AND FIELD WORK
- Fast tyre inspections with photos, tread and pressure capture
- Works offline and syncs automatically when back online
- Barcode and QR asset scanning
- Daily meter and engine-hour logging with a photo of the gauge
- Vehicle washing logs with photos and site tracking

TYRE AND MAINTENANCE INTELLIGENCE
- Per-vehicle tyre bay: current tyres, full history and one-click moves
- Cost per km, tyre life, failure and pressure compliance KPIs
- Preventive maintenance schedules for vehicles, generators and plant
- Accident and insurance claim tracking end to end

REPORTING AND CONTROL
- Live dashboards, executive reports and shareable TV boards
- Role based access with per-user and per-role controls
- Multi site and multi country ready

Built for fleet managers, workshop teams, inspectors and drivers.

Smarter Wheels. Stronger Fleet.

## Notes
- The in-app splash was enlarged and refreshed (splash_2048.png). It takes effect
  on the next EAS build, not on an over-the-air update.
- To also switch the installed launcher icon to the green style, replace
  mobile/assets/icon.png and adaptive-icon.png and rebuild - ask if you want that.
