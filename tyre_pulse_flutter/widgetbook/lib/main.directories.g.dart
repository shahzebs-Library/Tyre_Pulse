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
import 'package:widgetbook_workspace/components/status_chip.dart'
    as _widgetbook_workspace_components_status_chip;
import 'package:widgetbook_workspace/components/tyre_diagram_board.dart'
    as _widgetbook_workspace_components_tyre_diagram_board;

final directories = <_widgetbook.WidgetbookNode>[
  _widgetbook.WidgetbookFolder(
    name: 'core',
    children: [
      _widgetbook.WidgetbookFolder(
        name: 'design_system',
        children: [
          _widgetbook.WidgetbookComponent(
            name: 'TpStatusChip',
            useCases: [
              _widgetbook.WidgetbookUseCase(
                name: 'All states',
                builder:
                    _widgetbook_workspace_components_status_chip.statusChips,
              ),
            ],
          ),
        ],
      ),
    ],
  ),
  _widgetbook.WidgetbookFolder(
    name: 'features',
    children: [
      _widgetbook.WidgetbookFolder(
        name: 'tyre_diagram',
        children: [
          _widgetbook.WidgetbookFolder(
            name: 'presentation',
            children: [
              _widgetbook.WidgetbookComponent(
                name: 'TyreDiagramBoard',
                useCases: [
                  _widgetbook.WidgetbookUseCase(
                    name: 'Mixer - all good',
                    builder: _widgetbook_workspace_components_tyre_diagram_board
                        .mixerGood,
                  ),
                  _widgetbook.WidgetbookUseCase(
                    name: 'Mixer - mixed faults',
                    builder: _widgetbook_workspace_components_tyre_diagram_board
                        .mixerMixed,
                  ),
                  _widgetbook.WidgetbookUseCase(
                    name: 'Mixer - no readings',
                    builder: _widgetbook_workspace_components_tyre_diagram_board
                        .mixerEmpty,
                  ),
                  _widgetbook.WidgetbookUseCase(
                    name: 'Pump - half recorded',
                    builder: _widgetbook_workspace_components_tyre_diagram_board
                        .pumpHalf,
                  ),
                  _widgetbook.WidgetbookUseCase(
                    name: 'Wheel loader - all good',
                    builder: _widgetbook_workspace_components_tyre_diagram_board
                        .loaderGood,
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    ],
  ),
];
