// dart format width=80
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_import, prefer_relative_imports, directives_ordering

// GENERATED CODE - DO NOT MODIFY BY HAND

// **************************************************************************
// AppGenerator
// **************************************************************************

// ignore_for_file: no_leading_underscores_for_library_prefixes

import 'package:widgetbook/widgetbook.dart' as _widgetbook;
import 'package:widgetbook_workspace/components/asset_icons.dart'
    as _widgetbook_workspace_components_asset_icons;
import 'package:widgetbook_workspace/components/buttons.dart'
    as _widgetbook_workspace_components_buttons;
import 'package:widgetbook_workspace/components/capture.dart'
    as _widgetbook_workspace_components_capture;
import 'package:widgetbook_workspace/components/cards.dart'
    as _widgetbook_workspace_components_cards;
import 'package:widgetbook_workspace/components/foundations.dart'
    as _widgetbook_workspace_components_foundations;
import 'package:widgetbook_workspace/components/inputs.dart'
    as _widgetbook_workspace_components_inputs;
import 'package:widgetbook_workspace/components/lists.dart'
    as _widgetbook_workspace_components_lists;
import 'package:widgetbook_workspace/components/navigation.dart'
    as _widgetbook_workspace_components_navigation;
import 'package:widgetbook_workspace/components/overlays.dart'
    as _widgetbook_workspace_components_overlays;
import 'package:widgetbook_workspace/components/states.dart'
    as _widgetbook_workspace_components_states;
import 'package:widgetbook_workspace/components/status_chip.dart'
    as _widgetbook_workspace_components_status_chip;
import 'package:widgetbook_workspace/components/sync.dart'
    as _widgetbook_workspace_components_sync;
import 'package:widgetbook_workspace/components/tyre_diagram_board.dart'
    as _widgetbook_workspace_components_tyre_diagram_board;

final directories = <_widgetbook.WidgetbookNode>[
  _widgetbook.WidgetbookCategory(
    name: 'Buttons',
    children: [
      _widgetbook.WidgetbookComponent(
        name: 'TpBottomActionRail',
        useCases: [
          _widgetbook.WidgetbookUseCase(
            name: 'Bottom action rail',
            builder: _widgetbook_workspace_components_buttons.bottomActionRail,
          ),
        ],
      ),
      _widgetbook.WidgetbookComponent(
        name: 'TpButton',
        useCases: [
          _widgetbook.WidgetbookUseCase(
            name: 'All variants side by side',
            builder: _widgetbook_workspace_components_buttons.buttonAll,
          ),
          _widgetbook.WidgetbookUseCase(
            name: 'Danger',
            builder: _widgetbook_workspace_components_buttons.buttonDanger,
          ),
          _widgetbook.WidgetbookUseCase(
            name: 'Primary',
            builder: _widgetbook_workspace_components_buttons.buttonPrimary,
          ),
          _widgetbook.WidgetbookUseCase(
            name: 'Secondary',
            builder: _widgetbook_workspace_components_buttons.buttonSecondary,
          ),
          _widgetbook.WidgetbookUseCase(
            name: 'Text',
            builder: _widgetbook_workspace_components_buttons.buttonText,
          ),
        ],
      ),
    ],
  ),
  _widgetbook.WidgetbookCategory(
    name: 'Capture',
    children: [
      _widgetbook.WidgetbookComponent(
        name: 'InspectionSignaturePad',
        useCases: [
          _widgetbook.WidgetbookUseCase(
            name: 'Empty and read-only',
            builder: _widgetbook_workspace_components_capture.signaturePad,
          ),
        ],
      ),
    ],
  ),
  _widgetbook.WidgetbookCategory(
    name: 'Cards and tiles',
    children: [
      _widgetbook.WidgetbookComponent(
        name: 'TextScaledTile',
        useCases: [
          _widgetbook.WidgetbookUseCase(
            name: 'Text-scaled fixed tile',
            builder: _widgetbook_workspace_components_cards.textScaledTile,
          ),
        ],
      ),
      _widgetbook.WidgetbookComponent(
        name: 'TpAssetCard',
        useCases: [
          _widgetbook.WidgetbookUseCase(
            name: 'All statuses',
            builder: _widgetbook_workspace_components_cards.assetCards,
          ),
        ],
      ),
      _widgetbook.WidgetbookComponent(
        name: 'TpCard',
        useCases: [
          _widgetbook.WidgetbookUseCase(
            name: 'Variants',
            builder: _widgetbook_workspace_components_cards.cardVariants,
          ),
        ],
      ),
      _widgetbook.WidgetbookComponent(
        name: 'TpStatCard',
        useCases: [
          _widgetbook.WidgetbookUseCase(
            name: 'Count, text, zero, unavailable',
            builder: _widgetbook_workspace_components_cards.statCards,
          ),
        ],
      ),
    ],
  ),
  _widgetbook.WidgetbookCategory(
    name: 'Dialogs and bottom sheets',
    children: [
      _widgetbook.WidgetbookComponent(
        name: 'TpBottomSheet',
        useCases: [
          _widgetbook.WidgetbookUseCase(
            name: 'Open a sheet',
            builder: _widgetbook_workspace_components_overlays.bottomSheet,
          ),
        ],
      ),
      _widgetbook.WidgetbookComponent(
        name: 'TpDialog',
        useCases: [
          _widgetbook.WidgetbookUseCase(
            name: 'Confirm',
            builder: _widgetbook_workspace_components_overlays.confirmDialog,
          ),
        ],
      ),
    ],
  ),
  _widgetbook.WidgetbookCategory(
    name: 'Foundations',
    children: [
      _widgetbook.WidgetbookComponent(
        name: 'ColourTokens',
        useCases: [
          _widgetbook.WidgetbookUseCase(
            name: 'Colour roles',
            builder: _widgetbook_workspace_components_foundations.colourTokens,
          ),
        ],
      ),
      _widgetbook.WidgetbookComponent(
        name: 'SpacingAndRadius',
        useCases: [
          _widgetbook.WidgetbookUseCase(
            name: 'Spacing, radius and sizing',
            builder:
                _widgetbook_workspace_components_foundations.spacingAndRadius,
          ),
        ],
      ),
      _widgetbook.WidgetbookComponent(
        name: 'TpAssetIcon',
        useCases: [
          _widgetbook.WidgetbookUseCase(
            name: 'Domain icon set',
            builder: _widgetbook_workspace_components_asset_icons.assetIconSet,
          ),
        ],
      ),
      _widgetbook.WidgetbookComponent(
        name: 'TypeScale',
        useCases: [
          _widgetbook.WidgetbookUseCase(
            name: 'Type scale',
            builder: _widgetbook_workspace_components_foundations.typeScale,
          ),
        ],
      ),
    ],
  ),
  _widgetbook.WidgetbookCategory(
    name: 'Inputs',
    children: [
      _widgetbook.WidgetbookComponent(
        name: 'TpDropdown',
        useCases: [
          _widgetbook.WidgetbookUseCase(
            name: 'States',
            builder: _widgetbook_workspace_components_inputs.dropdownStates,
          ),
        ],
      ),
      _widgetbook.WidgetbookComponent(
        name: 'TpInput',
        useCases: [
          _widgetbook.WidgetbookUseCase(
            name: 'States',
            builder: _widgetbook_workspace_components_inputs.inputStates,
          ),
        ],
      ),
      _widgetbook.WidgetbookComponent(
        name: 'TpSearchField',
        useCases: [
          _widgetbook.WidgetbookUseCase(
            name: 'States',
            builder: _widgetbook_workspace_components_inputs.searchStates,
          ),
        ],
      ),
      _widgetbook.WidgetbookComponent(
        name: 'TpSegmented',
        useCases: [
          _widgetbook.WidgetbookUseCase(
            name: 'Interactive',
            builder: _widgetbook_workspace_components_inputs.segmented,
          ),
        ],
      ),
    ],
  ),
  _widgetbook.WidgetbookCategory(
    name: 'Lists and rows',
    children: [
      _widgetbook.WidgetbookComponent(
        name: 'QueueFilterChip',
        useCases: [
          _widgetbook.WidgetbookUseCase(
            name: 'Filter chips and tags',
            builder: _widgetbook_workspace_components_lists.queueFilters,
          ),
        ],
      ),
      _widgetbook.WidgetbookComponent(
        name: 'QueueListRow',
        useCases: [
          _widgetbook.WidgetbookUseCase(
            name: 'Queue rows',
            builder: _widgetbook_workspace_components_lists.queueRows,
          ),
        ],
      ),
      _widgetbook.WidgetbookComponent(
        name: 'TpActionRow',
        useCases: [
          _widgetbook.WidgetbookUseCase(
            name: 'Settings-style rows',
            builder: _widgetbook_workspace_components_lists.actionRows,
          ),
        ],
      ),
    ],
  ),
  _widgetbook.WidgetbookCategory(
    name: 'Loading, empty, error and offline states',
    children: [
      _widgetbook.WidgetbookComponent(
        name: 'TpBackendUnavailableState',
        useCases: [
          _widgetbook.WidgetbookUseCase(
            name: 'Default',
            builder:
                _widgetbook_workspace_components_states.backendUnavailableState,
          ),
        ],
      ),
      _widgetbook.WidgetbookComponent(
        name: 'TpEmptyState',
        useCases: [
          _widgetbook.WidgetbookUseCase(
            name: 'Default and with action',
            builder: _widgetbook_workspace_components_states.emptyState,
          ),
        ],
      ),
      _widgetbook.WidgetbookComponent(
        name: 'TpErrorState',
        useCases: [
          _widgetbook.WidgetbookUseCase(
            name: 'By error kind',
            builder: _widgetbook_workspace_components_states.errorState,
          ),
        ],
      ),
      _widgetbook.WidgetbookComponent(
        name: 'TpLoadingState',
        useCases: [
          _widgetbook.WidgetbookUseCase(
            name: 'Default',
            builder: _widgetbook_workspace_components_states.loadingState,
          ),
        ],
      ),
      _widgetbook.WidgetbookComponent(
        name: 'TpNotConfiguredState',
        useCases: [
          _widgetbook.WidgetbookUseCase(
            name: 'Default',
            builder: _widgetbook_workspace_components_states.notConfiguredState,
          ),
        ],
      ),
      _widgetbook.WidgetbookComponent(
        name: 'TpOfflineCachedState',
        useCases: [
          _widgetbook.WidgetbookUseCase(
            name: 'Default',
            builder: _widgetbook_workspace_components_states.offlineCachedState,
          ),
        ],
      ),
      _widgetbook.WidgetbookComponent(
        name: 'TpPermissionDeniedState',
        useCases: [
          _widgetbook.WidgetbookUseCase(
            name: 'With reason',
            builder:
                _widgetbook_workspace_components_states.permissionDeniedState,
          ),
        ],
      ),
      _widgetbook.WidgetbookComponent(
        name: 'TpScreenNotAvailableState',
        useCases: [
          _widgetbook.WidgetbookUseCase(
            name: 'Default',
            builder:
                _widgetbook_workspace_components_states.screenNotAvailableState,
          ),
        ],
      ),
      _widgetbook.WidgetbookComponent(
        name: 'TpStateView',
        useCases: [
          _widgetbook.WidgetbookUseCase(
            name: 'All states side by side',
            builder: _widgetbook_workspace_components_states.allStates,
          ),
          _widgetbook.WidgetbookUseCase(
            name: 'Custom state by tone',
            builder: _widgetbook_workspace_components_states.stateView,
          ),
        ],
      ),
    ],
  ),
  _widgetbook.WidgetbookCategory(
    name: 'Navigation and chrome',
    children: [
      _widgetbook.WidgetbookComponent(
        name: 'TpAppBar',
        useCases: [
          _widgetbook.WidgetbookUseCase(
            name: 'Title, subtitle, actions',
            builder: _widgetbook_workspace_components_navigation.appBar,
          ),
        ],
      ),
      _widgetbook.WidgetbookComponent(
        name: 'TpBrandLockup',
        useCases: [
          _widgetbook.WidgetbookUseCase(
            name: 'Full and compact',
            builder: _widgetbook_workspace_components_navigation.brandLockup,
          ),
        ],
      ),
      _widgetbook.WidgetbookComponent(
        name: 'TpScaffold',
        useCases: [
          _widgetbook.WidgetbookUseCase(
            name: 'With banner and FAB',
            builder: _widgetbook_workspace_components_navigation.scaffold,
          ),
        ],
      ),
    ],
  ),
  _widgetbook.WidgetbookCategory(
    name: 'Status indicators',
    children: [
      _widgetbook.WidgetbookComponent(
        name: 'TpStatusChip',
        useCases: [
          _widgetbook.WidgetbookUseCase(
            name: 'All states',
            builder: _widgetbook_workspace_components_status_chip.statusChips,
          ),
        ],
      ),
    ],
  ),
  _widgetbook.WidgetbookCategory(
    name: 'Sync and connectivity',
    children: [
      _widgetbook.WidgetbookComponent(
        name: 'TpOfflineBanner',
        useCases: [
          _widgetbook.WidgetbookUseCase(
            name: 'Every queue state',
            builder: _widgetbook_workspace_components_sync.offlineBanners,
          ),
        ],
      ),
      _widgetbook.WidgetbookComponent(
        name: 'TpSyncIndicator',
        useCases: [
          _widgetbook.WidgetbookUseCase(
            name: 'Every queue state',
            builder: _widgetbook_workspace_components_sync.syncIndicators,
          ),
          _widgetbook.WidgetbookUseCase(
            name: 'In the app bar',
            builder: _widgetbook_workspace_components_sync.syncInAppBar,
          ),
        ],
      ),
      _widgetbook.WidgetbookComponent(
        name: 'TpSyncLabel',
        useCases: [
          _widgetbook.WidgetbookUseCase(
            name: 'Synced and pending',
            builder: _widgetbook_workspace_components_sync.syncLabel,
          ),
        ],
      ),
    ],
  ),
  _widgetbook.WidgetbookCategory(
    name: 'Tyres',
    children: [
      _widgetbook.WidgetbookComponent(
        name: 'TpTyreChip',
        useCases: [
          _widgetbook.WidgetbookUseCase(
            name: 'States',
            builder: _widgetbook_workspace_components_cards.tyreChips,
          ),
        ],
      ),
      _widgetbook.WidgetbookComponent(
        name: 'TyreDiagramBoard',
        useCases: [
          _widgetbook.WidgetbookUseCase(
            name: 'Mixer - all good',
            builder:
                _widgetbook_workspace_components_tyre_diagram_board.mixerGood,
          ),
          _widgetbook.WidgetbookUseCase(
            name: 'Mixer - mixed faults',
            builder:
                _widgetbook_workspace_components_tyre_diagram_board.mixerMixed,
          ),
          _widgetbook.WidgetbookUseCase(
            name: 'Mixer - no readings',
            builder:
                _widgetbook_workspace_components_tyre_diagram_board.mixerEmpty,
          ),
          _widgetbook.WidgetbookUseCase(
            name: 'Pump - half recorded',
            builder:
                _widgetbook_workspace_components_tyre_diagram_board.pumpHalf,
          ),
          _widgetbook.WidgetbookUseCase(
            name: 'Wheel loader - all good',
            builder:
                _widgetbook_workspace_components_tyre_diagram_board.loaderGood,
          ),
        ],
      ),
      _widgetbook.WidgetbookComponent(
        name: 'TyreDiagramStatRow',
        useCases: [
          _widgetbook.WidgetbookUseCase(
            name: 'Tyre diagram row (four across)',
            builder: _widgetbook_workspace_components_cards.tyreStatRow,
          ),
        ],
      ),
    ],
  ),
];
