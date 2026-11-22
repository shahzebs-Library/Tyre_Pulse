# Flutter redesign, Phase 2: design system inventory

Scope: `tyre_pulse_flutter/lib/app/theme/`, `tyre_pulse_flutter/lib/core/design_system/`
and every file under `lib/features/**/presentation` (178 files). Measured on
2026-11-22 by grep over the source; counts are occurrences, then files. All
`file:line` paths are relative to `tyre_pulse_flutter/lib/features/` unless they
start with `lib/`.

No app code was changed in this phase. The catalogue for everything below is
`tyre_pulse_flutter/widgetbook/` (see "Widgetbook coverage" at the end).

---

## 1. Tokens that exist today

| Token | File | What it covers | Light / dark | Notes |
|---|---|---|---|---|
| `TpStatus` (enum) | `lib/app/theme/tp_colors.dart` | ok, warning, critical, info, neutral, unknown | both | `unknown` = "never measured", deliberately a different hue (violet) from `neutral`. |
| `TpStatusColors` | same | base, soft, onBase, onSoft per status | both | The only status colour mapping (`TpPalette.forStatus`). |
| `TpPalette` | same | 17 roles: background, surface, surfaceAlt, surfaceSunken, text, textSecondary, textMuted, textInverse, primary, primaryDark, primarySoft, onPrimary, border, borderStrong, controlBorder, focus, overlay | `light`, `dark`, plus `loginLight` | Light primary = fleet green `#07883F`; dark primary = safety yellow `#FFD400`. `loginLight` is a third palette (green `#007333`) for the signed-out country screens. Resolved by brightness, or by `TpPaletteTheme` extension when a screen scopes its own palette. |
| `TpTypography.textThemeFor` | `lib/app/theme/tp_typography.dart` | 10 Material 3 slots: displaySmall 32, headlineMedium 26, headlineSmall 21, titleLarge 18, titleMedium 16, bodyLarge 15, bodyMedium 15, labelLarge 15, labelMedium 13, labelSmall 12 | both (colour from palette) | Weights run w500 to w800. No font family set (platform default). |
| `TpTypography.identifier` | same | asset numbers, positions, serials: 14 / w700 / tabular figures | both | Callers must also wrap in an LTR isolate. |
| `TpSpace` | `lib/app/theme/tp_spacing.dart` | xs 4, sm 8, md 12, lg 16, xl 20, xxl 24, xxxl 32, huge 40 | n/a | 4 pt scale. Used 2,662 times in 116 feature files. |
| `TpRadius` | same | sm 8, md 12, lg 16, xl 20, pill 999 | n/a | Used 271 times in 82 files. |
| `TpBorderWidth` | same | hairline 1, strong 2 | n/a | Borders instead of shadows (sunlight). |
| `TpSizing` | same | minTouchTarget 48, controlHeight 52, controlHeightCompact 40, iconSm 16, iconMd 20, iconLg 24, iconState 44, stateMaxWidth 420 | n/a | |
| `TpTheme` | `lib/app/theme/tp_theme.dart` | ThemeData from a palette: colorScheme, textTheme, scaffold background, divider, standard density, `NoSplash` | `light`, `dark`, `forPalette` | Deliberately sets no component sub-themes (no SnackBar, Dialog, Input, Card, Chip theme). |
| `tpTextScaleFactor` / `tpTextScaledExtent` | `lib/core/design_system/tp_text_scale.dart` | grow a fixed-height tile with the text size, clamped 1.0 to 2.5 | n/a | |

Not tokenised at all today: elevation/shadow, motion (durations, curves),
opacity, z-order, icon set, illustration style, chart colours, skeleton shimmer.

## 2. Tp* components that exist today

Every component reads colour through `TpPalette.of(context)`, so all of them
follow light and dark. RTL column: "dir" = uses directional insets/alignment,
"sym" = only symmetric spacing (mirrors correctly), "risk" = a physical
left/right value or a row that cannot shrink.

| Component | File | Covers | RTL | Notes / defects found |
|---|---|---|---|---|
| `TpButton` (+ `.primary/.secondary/.danger/.text`, `TpButtonVariant`) | `tp_button.dart` | label, icon, busy, full width, compact, disabled via `onPressed: null` | sym | No "outline danger", no icon-only button, no loading label. |
| `TpCard` | `tp_card.dart` | surface card, tappable, dashed border for "not measured", custom border/background | sym | Has one raw colour. |
| `TpAssetCard` + `TpAssetSummary` | `tp_asset_card.dart` | asset number, description, site, status chip, detail | risk | **Defect:** row with the status chip does not shrink; overflows ~14 dp at Arabic + 2x text (render test, see section 6). `EdgeInsets.only(bottom:)` margin baked in (line 64). |
| `TpStatCard` (`.count/.text/.unavailable`) | `tp_stat_card.dart` | KPI tile; `0` and "unavailable" rendered differently | sym | **Defect:** its Column (line 119) overflows a fixed grid cell (2 dp at 1.25 aspect, 100+ dp at 2x). Callers must size with `tpTextScaledExtent`. |
| `TpTyreChip` + `TpTyreChipData` | `tp_tyre_chip.dart` | tyre position, serial, status, detail, selected | sym | |
| `TpStatusChip` | `tp_status_chip.dart` | status pill with default localised label | sym | |
| `TpInput` | `tp_input.dart` | label, hint, helper, error, required, disabled, obscured, multiline, counter, prefix icon, suffix | sym | |
| `TpSearchField` | `tp_search_field.dart` | search with clear button | sym | |
| `TpDropdown` + `TpDropdownItem` | `tp_dropdown.dart` | label, hint, error, required, disabled | sym | |
| `TpSegmented` + `TpSegmentedOption` | `tp_segmented.dart` | segmented control, expanded, disabled | sym | One raw colour. |
| `TpAppBar` | `tp_app_bar.dart` | title, subtitle, actions, back with fallback, bottom | dir | |
| `TpScaffold` | `tp_scaffold.dart` | app bar, banner slot, FAB, bottom nav, back intercept | sym | |
| `TpBottomSheet.show` | `tp_bottom_sheet.dart` | modal sheet with handle, title, safe area, keyboard inset | sym | Static helper, not a widget. |
| `TpDialog.confirm` | `tp_bottom_sheet.dart` | yes/no dialog, destructive variant, dismissal = false | risk | `actionsPadding: EdgeInsets.fromLTRB` (line 120). Only `confirm` exists: no info, input or choice dialog. |
| `TpBrandLockup` | `tp_mobile_chrome.dart` | logo mark + wordmark, compact | sym | Loads `assets/login/figma_brand_pulse_mark.png`. |
| `TpSyncLabel` | `tp_mobile_chrome.dart` | synced / pending label | risk | **Defect:** Row at line 76 overflows at 2x text (no Flexible on the label). |
| `TpActionRow` | `tp_mobile_chrome.dart` | settings-style row: icon, label, value, trailing, tone, divider | dir | |
| `TpBottomActionRail` | `tp_mobile_chrome.dart` | two-button bottom rail (secondary + primary, busy) | risk | `EdgeInsets.fromLTRB` (line 216). |
| `TpStateView` + `TpStateKeys` | `tp_states.dart` | shared layout for full-screen states, by tone | sym | |
| `TpLoadingState`, `TpEmptyState`, `TpOfflineCachedState`, `TpPermissionDeniedState`, `TpBackendUnavailableState`, `TpNotConfiguredState`, `TpErrorState`, `TpScreenNotAvailableState` | `tp_states.dart` | the seven states plus "not built yet"; only the loading state spins | sym | Full-screen only. No inline/section-level versions, no skeleton. |
| `TpOfflineBanner`, `TpSyncIndicator`, `TpSyncSummary`, `TpConnectivity` | `tp_sync_status.dart` | offline / pending / syncing / attention / unknown | risk | **Defect:** `TpSyncIndicator` Text (line ~256) has no Flexible or ellipsis; overflows in Arabic and at 2x. |
| `TpReportProblemScope` | `tp_report_problem_scope.dart` | injects "Report a problem" into error states | n/a | |

Shared widgets outside the design system that act as components:

| Widget | File | Notes |
|---|---|---|
| `QueueSectionHeader`, `QueueStatusTag`, `QueueFilterChip`, `QueueListRow`, `QueuePrimaryLift` | `approvals/presentation/widgets/queue_list_kit.dart` | The de facto list/row kit, reused by several queues but living in one feature. Uses `BoxShadow` (lines 412, 455). Candidate to move into the design system. |
| `TyreDiagramBoard` | `tyre_diagram/presentation/tyre_diagram_board.dart` | Already in Widgetbook. |
| `TpAppShell` | `lib/app/router/app_shell.dart` | Bottom navigation; needs a `StatefulNavigationShell`, so not catalogued (see gaps). |
| 6 signature pads | see section 3 | Same widget written six times. |

## 3. Duplicates and one-offs

### 3.1 Same component written several times

| What | Copies | Where |
|---|---|---|
| Signature pad | **6** | `meter_logs/presentation/widgets/meter_log_signature_pad.dart:73`, `handover/presentation/widgets/handover_signature_pad.dart:33`, `checklists/presentation/widgets/checklist_signature_pad.dart:50`, `inspections/presentation/widgets/inspection_signature_pad.dart:63`, `approvals/presentation/widgets/checklist_approval_signature_pad.dart:79`, `approvals/presentation/widgets/inspection_approval_signature_pad.dart:69` |
| Section header / heading / label (private) | **12** | `checklists/presentation/checklist_history_screen.dart:231`, `checklists/presentation/checklist_submission_detail_screen.dart:233`, `checklists/presentation/checklists_home_screen.dart:1869`, `checklists/presentation/widgets/checklist_field_answer_tile.dart:645`, `inspections/presentation/inspection_history_screen.dart:265`, `checklists/presentation/checklist_fill_screen.dart:743`, `assets/presentation/vehicle_detail_screen.dart:1328`, `preventive_maintenance/presentation/pm_screen.dart:667`, `accidents/presentation/accident_detail_screen.dart:361`, `work_orders/presentation/work_order_detail_screen.dart:674`, `approvals/presentation/checklist_approval_review_screen.dart:1466`, `tasks/presentation/tasks_screen.dart:373` (plus the public `QueueSectionHeader`) |
| Inline warning banner (private) | **3** | `checklists/presentation/checklist_history_screen.dart:251`, `checklists/presentation/checklists_home_screen.dart:1889`, `inspections/presentation/inspection_history_screen.dart:285` |
| Summary card / row / tile (private) | **9** | `checklists/presentation/checklist_submission_detail_screen.dart:274`, `handover/presentation/handover_detail_screen.dart:427`, `approvals/presentation/inspection_approval_review_screen.dart:898` and `:1000`, `approvals/presentation/checklist_approval_review_screen.dart:1658`, `meter_logs/presentation/widgets/meter_log_review_sheet.dart:261`, `inspections/presentation/my_plans_screen.dart:140`, `workshop_status/presentation/workshop_status_detail_screen.dart:573`, `home/presentation/home_screen.dart:2950` |
| Metric / stat tile (private, beside `TpStatCard`) | **6** | `stock_count/presentation/stock_count_screen.dart:500`, `records/presentation/tyre_records_list_screen.dart:737`, `management/presentation/management_screens.dart:745`, `my_work/presentation/my_work_widgets.dart:355`, `inspections/presentation/inspection_detail_screen.dart:685`, `home/presentation/home_screen.dart:2950` |
| Private empty state (beside `TpEmptyState`) | **3** | `extras/presentation/fleet_ai_screen.dart:327`, `records/presentation/tyre_records_list_screen.dart:256`, `tyre_diagram/presentation/vehicle_tyre_diagram.dart:1633` |
| Private status tag (beside `TpStatusChip`) | **2+** | `home/presentation/home_screen.dart:2041`, `records/presentation/tyre_records_list_screen.dart:908` (status tabs), `checklists/presentation/checklist_history_screen.dart:299` (filter chip) |
| Signature preview | 2 | `approvals/presentation/widgets/approval_signature_preview.dart`, `checklists/presentation/checklist_submission_detail_screen.dart` |

Private widget names that repeat across files (all features): `_Section*` 15,
`_Summary*` 10, `_Detail*` 8, `_Metric*` 5, `_Filter*` 4, `_Field*` 4.

### 3.2 Raw Material widgets used instead of the Tp* version

| Raw widget | Uses (files) | Tp* uses (files) | Worst files |
|---|---|---|---|
| `ElevatedButton / FilledButton / OutlinedButton / TextButton` | 128 (35) | `TpButton` 200 (69) | `driver_workspace/presentation/driver_workspace_panel.dart` 18 (e.g. :230, :288, :294, :519), `notifications/presentation/team_action_dialog.dart` 8, `my_work/presentation/workforce_assignments_panel.dart` 8, `accidents/presentation/widgets/accident_ws_insurance_claim.dart` 7, `profile/presentation/profile_screen.dart` 6 |
| `TextField / TextFormField` | 58 (29) | `TpInput` 133 (29) | `stock_count/presentation/stock_count_screen.dart` 9, `inventory/presentation/physical_inventory_screen.dart` 5, `auth/presentation/login_screen.dart` 5 |
| `showDialog` | 37 (26) | `TpDialog` 13 (10) | `workshop/presentation/workshop_technician_screen.dart:274/314/369`, `profile/presentation/profile_screen.dart:243/1896/1982`, `stock_count/presentation/stock_count_screen.dart:88/418` |
| `showModalBottomSheet` | 32 (21) | `TpBottomSheet` 28 (22) | `profile/presentation/profile_screen.dart` 4, `accidents/presentation/accident_report_screen.dart` 4, `driver_workspace/presentation/driver_workspace_panel.dart` 3 |
| `CircularProgressIndicator / LinearProgressIndicator` | 58 (42) | `TpLoadingState` 65 (54) | `accidents/presentation/widgets/accident_report_intake_widgets.dart:332/1512`, `inventory/presentation/blind_count_screen.dart:515/545` |
| `SnackBar(` | 99 (34), 58 `showSnackBar` calls | none (no Tp toast exists) | `stock_count/presentation/stock_count_screen.dart` 10, `my_work/presentation/workforce_assignments_panel.dart` 10, `accidents/presentation/accident_report_screen.dart` 8 |
| `ListTile(` | 61 (30) | `TpActionRow`, `QueueListRow` | `driver_workspace/presentation/driver_workspace_panel.dart` 7, `inventory/presentation/physical_inventory_screen.dart` 6 |
| `DropdownButton*` | 13 (10) | `TpDropdown` 46 (10) | |
| `Chip / FilterChip / ChoiceChip / ActionChip` | 36 (23) | `TpStatusChip` 89 (45) | |
| `Card(` | 15 (6) | `TpCard` 195 (65) | |
| `Scaffold(` / `AppBar(` | 5 (3) / 10 (8) | `TpScaffold` 75 / `TpAppBar` 62 | |
| `Divider(` | 67 | none | |

### 3.3 Hard-coded values

| Kind | Count (files) | Detail |
|---|---|---|
| Hex colours `Color(0x...)` | 29 (6) | `auth/presentation/login_screen.dart` 11 (gold `#D29A45` :578, night `#030A29` :612), `tyre_diagram/presentation/tyre_wheel_painter.dart` 10 (painter, acceptable), `checklists/presentation/checklists_home_screen.dart:743/748` (blue `#0648D9`, `#082B70`, off-brand), `assets/presentation/widgets/asset_cost_widgets.dart:32-33` (purple `#B39DDB/#7E57C2`, off-brand chart colour). |
| Material `Colors.*` (excluding `transparent`) | 64 (23) | `Colors.white` 45, `Colors.black` 14, `Colors.black54` 4, `Colors.black87` 1. Mostly signature canvases and photo scrims; `checklists/presentation/checklist_submission_detail_screen.dart:777` puts `black87` text that does not follow dark mode. |
| `fontSize:` literals (excluding PDF builders) | ~35 | sizes 9, 9.5, 10, 11, 11.5, 12, 13, 14, 15, 17, 18, 19, 20, 26, 27, 30, 32, 34. Ten of these (9, 9.5, 10, 11, 11.5, 17, 19, 27, 30, 34) are not on the type scale. Examples: `home/presentation/home_screen.dart:1343` (9), `:1639` (19); `meter_logs/presentation/meter_log_screen.dart:485` (34); `checklists/presentation/checklists_home_screen.dart:860` (32); `inspections/presentation/new_inspection_screen.dart:2145` (11.5); `tyre_diagram/presentation/vehicle_tyre_diagram.dart:1334` (9.5). PDF builders (`handover_pdf.dart` 15, `accident_case_pdf.dart` 11) are out of scope. |
| `FontWeight` literals | 365 | w400 2, w500 11, w600 51, w700 107, w800 157, w900 37. w900 is not in the type scale at all. |
| Spacing literals in `SizedBox`/`EdgeInsets` | 173 SizedBox (54 files), 42 EdgeInsets (23) | Off-scale values: 2 (68 uses), 6 (14), 3 (14), 5 (12), 10 (5), 14 (3), 7 (2), 18 (2), 22, 26. |
| Radius literals `circular(n)` | 26 (9) | 2, 3, 4, 5, 6, 9, 10, 14, 15, 48: none of 2, 3, 5, 6, 9, 10, 14, 15 are tokens. Worst: `auth/presentation/login_screen.dart` 7, `accidents/presentation/widgets/vehicle_damage_diagram.dart` 6. |
| `BoxShadow` | 40 (9) | Contradicts the "borders, not shadows" rule in `tp_spacing.dart`. `home/presentation/home_screen.dart:1104/1109/1530/1570`, `assets/presentation/vehicle_detail_screen.dart:1407/1506/1527` (a private `_softLift` helper), `inspections/presentation/new_inspection_screen.dart:431/3612/3617`, `profile/presentation/profile_screen.dart:591/1630`, `preventive_maintenance/presentation/pm_screen.dart:208/846`, `approvals/presentation/widgets/queue_list_kit.dart:412/455`. |
| `elevation:` | 6 | |
| `Duration(...)` literals | 29 | no motion tokens exist. |
| Physical-direction insets/alignment (`EdgeInsets.only/fromLTRB`, `centerLeft/Right`, `TextAlign.left/right`) | 244 | vs 100 directional uses. Many `fromLTRB` calls are symmetric and mirror fine; the asymmetric ones break in Arabic and need a pass. Heaviest: `assets/presentation/vehicles_list_screen.dart` (:184, :480, :512, :551, :645, :775, :921). |

## 4. Gaps against the target list

| Area | Today | Gap |
|---|---|---|
| Typography scale | 10 M3 slots + identifier | No display/headline large, no `bodySmall`, no `titleSmall`, no numeric/KPI style (the 26 to 34 literals are KPI numbers), no caption-with-weight. w900 used 37 times with no token. |
| Colours | full role + status palette, light and dark | No chart/data-viz palette (one-off purple and blue in features); `primaryDark` means navy in light and amber in dark (name does not describe the role); no `surfaceRaised`, no scrim for photos (`black54` literals); `loginLight` is a separate brand variant. |
| Buttons | `TpButton` 4 variants | No icon button, no FAB style, no outline-danger, no split/segmented action, no link style; 128 raw Material buttons. |
| Cards | `TpCard`, `TpAssetCard`, `TpStatCard`, `TpTyreChip` | No list card with header/footer, no section card, no media/photo card; 9 private summary cards and 6 metric tiles. |
| Inputs | input, search, dropdown, segmented | No date/time picker field, number stepper (the inventory big stepper is a one-off), checkbox/radio/switch rows, chips input, photo picker field, signature field (6 copies), scan field. |
| Tables / lists | `TpActionRow`, queue kit (in a feature) | No list row in the design system, no section header (12 copies), no data table / key-value table, no divider token (67 raw `Divider`). |
| Status indicators | `TpStatusChip`, `TpTyreChip`, sync indicator | No count badge (notifications, tabs), no progress-to-target bar, no step indicator (2 private `_StepTrack`). |
| Dialogs | `TpDialog.confirm` | No info/alert, input, choice, or full-screen dialog; 37 raw `showDialog`. |
| Bottom sheets | `TpBottomSheet.show` | No action-sheet preset, no scrollable list sheet preset; 32 raw `showModalBottomSheet`. |
| Toasts / snackbars | none | 99 raw `SnackBar` with no theme; no success/error/undo toast. |
| Charts | none | No chart component or palette; charts are custom painters. |
| Icons | Material icons, sizes in `TpSizing` | No icon set decision, no size use enforced (`size:` literals 16/18/20/24 everywhere). |
| Loading placeholders (skeletons) | none (0 hits for skeleton/shimmer) | Only a full-screen spinner; lists flash a spinner instead of a placeholder. 58 ad-hoc inline spinners. |
| Empty / error / offline / pending-sync states | 8 full-screen states, offline banner, sync indicator, sync label | No inline (section-level) empty/error, no per-record "pending sync" badge for list rows, no "last synced" timestamp component. |
| Elevation | none (by design) | 40 shadows exist anyway; needs one decision. |
| Motion | `NoSplash` only | No duration/curve tokens; 29 literal durations. |
| Touch target | `TpSizing.minTouchTarget` 48 | Not enforced on custom tap areas (`InkWell` on small chips, the sync indicator). |

## 5. Light / dark and RTL summary

* Dark mode: every Tp* component follows the palette. Breaks come from the 64
  `Colors.*` and 29 hex literals in features, not from the design system.
* Dark primary is yellow while light primary is green: brand-correct per the
  palette comment, but anything that hard-codes "primary is green" (for
  example `checklists_home_screen.dart:743` blue, or white text on primary)
  will look wrong in one theme.
* RTL: the design system is mostly safe (symmetric or directional). Risks:
  `TpDialog` actions padding, `TpBottomActionRail`, `TpAssetCard` margin, and
  three rows that cannot shrink (asset card, sync indicator, sync label).

## 6. Defects the Widgetbook render test found

`widgetbook/test/all_use_cases_render_test.dart` renders every use case in
light/English/1x, dark/Arabic/1x and light/Arabic/2x on a 390 x 844 screen.
These overflowed and are skipped with the reason (not hidden):

1. `TpAssetCard`: status row overflows ~14 dp at Arabic + 2x text.
2. `TpSyncIndicator`: label overflows in Arabic (3 dp) and at 2x (328 dp).
3. `TpSyncLabel` (`lib/core/design_system/tp_mobile_chrome.dart:76`): overflows 150 to 180 dp at 2x.
4. `TpStatCard`: overflows any fixed-height grid cell (2 dp at 1x, 100+ dp at 2x). The catalogue shows it content-sized.

Caveat: the test font is wider than a real Arabic font, so the pixel amounts
are larger than on a device. The structural cause (a `Text` in a `Row` with no
`Flexible`/ellipsis) is real and will overflow on a narrow phone with large
text.

## 7. Widgetbook coverage

Categories: Foundations, Buttons, Cards and tiles, Inputs, Lists and rows,
Status indicators, Loading/empty/error/offline states, Sync and connectivity,
Navigation and chrome, Dialogs and bottom sheets, Capture, Tyres.

Every Tp* component above has at least one use case, with knobs for
`Long Arabic text`, disabled, busy, compact, error and tone where they apply;
dark, Arabic, viewport and text scale come from the addons. Also catalogued:
the queue list kit, one signature pad, the tyre diagram board.

Not catalogued, and why: `TpAppShell` (needs a live GoRouter
`StatefulNavigationShell`; worth a fake shell in Phase 3 when the new
navigation is designed), private feature widgets (the duplicates in section 3
are the input to Phase 4 consolidation, not components to preserve).
