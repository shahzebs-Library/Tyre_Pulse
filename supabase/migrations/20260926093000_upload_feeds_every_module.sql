-- Daily coverage: watch EVERY business module, not only the first 12.
--
-- The coverage view emits a module for a country only when that module has
-- data there in the last 180 days, so registering a module that is empty today
-- adds nothing to the screen; it simply starts reporting the moment its first
-- rows arrive. Date column = the module's own business date where it has one;
-- created_at (date_basis 'arrival') only where no business date exists.
-- None are site-day policed: all are event-driven (a quiet site is not a gap).
-- The upload_feeds_validate trigger refuses any table/column that does not exist.
insert into public.upload_feeds (src, label, table_name, date_column, site_column, date_basis, site_day_policed, sort_order) values
  ('checklists',          'Checklists',               'checklist_submissions',   'submitted_at',   'site', 'business', false, 13),
  ('asset_breakdowns',    'Breakdowns',               'asset_breakdowns',        'reported_on',    'site', 'business', false, 14),
  ('telematics',          'Telematics (utilization)', 'asset_utilization',       'captured_at',    null,   'business', false, 15),
  ('asset_disposals',     'Asset disposals',          'asset_disposals',         'created_at',     'site', 'arrival',  false, 16),
  ('insurance_claims',    'Insurance claims (insurer)','insurance_claim_register','accident_date', null,   'business', false, 17),
  ('gate_passes',         'Gate passes',              'gate_passes',             'pass_date',      'site', 'business', false, 18),
  ('corrective_actions',  'Corrective actions',       'corrective_actions',      'created_at',     'site', 'arrival',  false, 19),
  ('pm_services',         'PM services',              'pm_service_records',      'service_date',   'site', 'business', false, 20),
  ('tyre_service_events', 'Tyre service events',      'tyre_service_events',     'event_date',     'site', 'business', false, 21),
  ('material_issues',     'Store issues / returns',   'material_issues',         'issued_at',      'site', 'business', false, 22),
  ('repair_requests',     'Repair requests',          'repair_requests',         'reported_at',    'site', 'business', false, 23),
  ('parts_requests',      'Parts requests',           'parts_requests',          'requested_at',   'site', 'business', false, 24),
  ('incident_reports',    'Incident reports',         'incident_reports',        'incident_date',  'site', 'business', false, 25),
  ('breakdown_callouts',  'Breakdown callouts',       'breakdown_callouts',      'reported_at',    null,   'business', false, 26),
  ('dvir_reports',        'Driver vehicle checks',    'dvir_reports',            'inspection_date','site', 'business', false, 27),
  ('driver_expenses',     'Driver expenses',          'driver_expenses',         'expense_date',   null,   'business', false, 28),
  ('fuel_deliveries',     'Fuel deliveries',          'fuel_deliveries',         'delivered_at',   'site', 'business', false, 29),
  ('warranty_claims',     'Warranty claims',          'warranty_claims',         'created_at',     'site', 'arrival',  false, 30),
  ('purchase_orders',     'Purchase orders',          'purchase_orders',         'order_date',     'site', 'business', false, 31),
  ('goods_receipts',      'Goods receipts',           'goods_receipts',          'received_date',  'site', 'business', false, 32),
  ('open_work_orders',    'Open job cards snapshot',  'open_work_orders',        'job_card_date',  null,   'business', false, 33),
  ('tpms_readings',       'TPMS readings',            'tpms_readings',           'recorded_at',    null,   'business', false, 34),
  ('journeys',            'Journeys',                 'journeys',                'start_time',     'site', 'business', false, 35)
on conflict do nothing;
