# Data Dictionary

Core business tables in the TyrePulse Supabase database (`public` schema),
generated from the live schema. Reference for query/RPC authors — always
verify against the live schema before writing new queries.

_Last updated: 2026-07-03 · migrations through V68 · 21 core tables._

> Every business table carries `organisation_id` (org isolation via
> RESTRICTIVE RLS) and most carry `country`. Nullable shown as ✓ (null OK) / — (NOT NULL).

---

## `organisations`

Tenant organisations (Default + one per country). Carries branding in settings->branding (V68).

| Column | Type | Null |
|--------|------|:----:|
| `id` | uuid | — |
| `name` | text | — |
| `slug` | text | — |
| `settings` | jsonb | ✓ |
| `plan` | text | ✓ |
| `active` | bool | ✓ |
| `created_at` | timestamptz | ✓ |
| `country` | text | ✓ |
| `countries` | array | ✓ |
| `timezone` | text | ✓ |
| `primary_country` | text | ✓ |
| `max_users` | int | ✓ |
| `logo_url` | text | ✓ |
| `contact_email` | text | ✓ |
| `notes` | text | ✓ |
| `locked` | bool | ✓ |
| `updated_at` | timestamptz | ✓ |

## `profiles`

User accounts: role, approval/lock state, country/org scope, module overrides.

| Column | Type | Null |
|--------|------|:----:|
| `id` | uuid | — |
| `username` | text | — |
| `full_name` | text | ✓ |
| `role` | text | ✓ |
| `region` | text | ✓ |
| `avatar_url` | text | ✓ |
| `created_at` | timestamptz | ✓ |
| `employee_id` | text | ✓ |
| `approved` | bool | ✓ |
| `country` | array | ✓ |
| `pending_reason` | text | ✓ |
| `countries` | array | ✓ |
| `site` | text | ✓ |
| `is_super_admin` | bool | ✓ |
| `locked` | bool | ✓ |
| `organisation_id` | uuid | ✓ |
| `last_login_at` | timestamptz | ✓ |
| `login_count` | int | ✓ |
| `module_overrides` | jsonb | ✓ |
| `notes` | text | ✓ |
| `phone` | text | ✓ |
| `email` | text | ✓ |
| `updated_at` | timestamptz | ✓ |
| `org_id` | uuid | ✓ |
| `push_token` | text | ✓ |
| `push_token_updated_at` | timestamptz | ✓ |

## `vehicle_fleet`

Canonical fleet/asset master (vehicles).

| Column | Type | Null |
|--------|------|:----:|
| `id` | uuid | — |
| `asset_no` | text | — |
| `fleet_number` | text | ✓ |
| `make` | text | ✓ |
| `model` | text | ✓ |
| `vehicle_type` | text | ✓ |
| `year` | int | ✓ |
| `department` | text | ✓ |
| `operator_name` | text | ✓ |
| `site` | text | ✓ |
| `country` | text | ✓ |
| `region` | text | ✓ |
| `expected_km_per_tyre` | int | ✓ |
| `min_days_between_changes` | int | ✓ |
| `max_tyres_per_day` | int | ✓ |
| `tyre_size` | text | ✓ |
| `tyre_brand_preferred` | text | ✓ |
| `monthly_tyre_budget` | numeric | ✓ |
| `status` | text | ✓ |
| `notes` | text | ✓ |
| `created_at` | timestamptz | ✓ |
| `updated_at` | timestamptz | ✓ |
| `created_by` | uuid | ✓ |
| `current_km` | numeric | ✓ |
| `registration_no` | text | ✓ |
| `registration_date` | date | ✓ |
| `is_active` | bool | ✓ |
| `organisation_id` | uuid | ✓ |
| `custom_data` | jsonb | ✓ |

## `tyre_records`

Serial-level tyre lifecycle; fitment/removal events appended as rows.

| Column | Type | Null |
|--------|------|:----:|
| `id` | uuid | — |
| `sr` | text | ✓ |
| `issue_date` | date | ✓ |
| `description` | text | ✓ |
| `brand` | text | ✓ |
| `serial_no` | text | ✓ |
| `qty` | int | ✓ |
| `job_card` | text | ✓ |
| `mis_number` | text | ✓ |
| `asset_no` | text | ✓ |
| `site` | text | ✓ |
| `remarks` | text | ✓ |
| `remarks_cleaned` | text | ✓ |
| `category` | text | ✓ |
| `risk_level` | text | ✓ |
| `source_sheet` | text | ✓ |
| `source_file` | text | ✓ |
| `region` | text | ✓ |
| `uploaded_by` | uuid | ✓ |
| `cost_per_tyre` | numeric | ✓ |
| `cleaned` | bool | ✓ |
| `created_at` | timestamptz | ✓ |
| `country` | text | ✓ |
| `km_at_fitment` | numeric | ✓ |
| `km_at_removal` | numeric | ✓ |
| `data_source` | text | ✓ |
| `upload_batch_id` | uuid | ✓ |
| `extra_fields` | jsonb | ✓ |
| `position` | text | ✓ |
| `serial_number` | text | ✓ |
| `pressure_reading` | numeric | ✓ |
| `tread_depth` | numeric | ✓ |
| `size` | text | ✓ |
| `driver_name` | text | ✓ |
| `reason_for_removal` | text | ✓ |
| `removal_date` | date | ✓ |
| `tyre_serial` | text | ✓ |
| `supplier` | text | ✓ |
| `asset_number` | text | ✓ |
| `findings` | text | ✓ |
| `removal_reason` | text | ✓ |
| `driver_id` | uuid | ✓ |
| `tyre_position` | text | ✓ |
| `vehicle_type` | text | ✓ |
| `hrs_at_fitment` | numeric | ✓ |
| `hrs_at_removal` | numeric | ✓ |
| `total_km` | numeric | ✓ |
| `total_hrs` | numeric | ✓ |
| `fitment_date` | date | ✓ |
| `photos` | jsonb | ✓ |
| `status` | text | ✓ |
| `organisation_id` | uuid | ✓ |

## `stock_records`

Inventory items (canonical); balances derive from stock_movements.

| Column | Type | Null |
|--------|------|:----:|
| `id` | uuid | — |
| `site` | text | — |
| `description` | text | ✓ |
| `stock_qty` | int | ✓ |
| `min_level` | int | ✓ |
| `critical_level` | int | ✓ |
| `stock_status` | text | ✓ |
| `reorder_qty` | int | ✓ |
| `management_action` | text | ✓ |
| `region` | text | ✓ |
| `updated_by` | uuid | ✓ |
| `updated_at` | timestamptz | ✓ |
| `country` | text | ✓ |
| `organisation_id` | uuid | ✓ |
| `custom_data` | jsonb | ✓ |

## `stock_movements`

Inventory movement ledger (receipt/issue/return/transfer/scrap/adjustment).

| Column | Type | Null |
|--------|------|:----:|
| `id` | uuid | — |
| `stock_id` | uuid | ✓ |
| `site` | text | — |
| `description` | text | ✓ |
| `movement_type` | text | ✓ |
| `qty_before` | int | — |
| `qty_change` | int | — |
| `qty_after` | int | — |
| `reason` | text | ✓ |
| `reference_no` | text | ✓ |
| `created_by` | uuid | ✓ |
| `created_at` | timestamptz | ✓ |
| `organisation_id` | uuid | ✓ |

## `work_orders`

Maintenance/repair work orders with open/start/complete timestamps.

| Column | Type | Null |
|--------|------|:----:|
| `id` | uuid | — |
| `work_order_no` | varchar | — |
| `asset_no` | varchar | — |
| `tyre_serial` | varchar | ✓ |
| `tyre_position` | varchar | ✓ |
| `status` | varchar | — |
| `priority` | varchar | — |
| `work_type` | varchar | — |
| `description` | text | ✓ |
| `technician_name` | varchar | ✓ |
| `workshop_name` | varchar | ✓ |
| `site` | varchar | ✓ |
| `country` | varchar | ✓ |
| `opened_at` | timestamptz | — |
| `started_at` | timestamptz | ✓ |
| `completed_at` | timestamptz | ✓ |
| `target_completion` | timestamptz | ✓ |
| `labour_hours` | numeric | ✓ |
| `labour_rate` | numeric | ✓ |
| `labour_cost` | numeric | ✓ |
| `parts_cost` | numeric | ✓ |
| `total_cost` | numeric | ✓ |
| `parts_used` | jsonb | ✓ |
| `notes` | text | ✓ |
| `created_by` | uuid | ✓ |
| `created_at` | timestamptz | — |
| `updated_at` | timestamptz | — |
| `organisation_id` | uuid | ✓ |
| `lubricant_cost` | numeric | ✓ |
| `tyre_cost` | numeric | ✓ |
| `outside_repair_cost` | numeric | ✓ |
| `breakdown_hours` | numeric | ✓ |
| `standard_hours` | numeric | ✓ |
| `odometer` | numeric | ✓ |
| `custom_data` | jsonb | ✓ |

## `corrective_actions`

Corrective actions raised from inspections/anomalies.

| Column | Type | Null |
|--------|------|:----:|
| `id` | uuid | — |
| `title` | text | — |
| `priority` | text | ✓ |
| `site` | text | ✓ |
| `region` | text | ✓ |
| `description` | text | ✓ |
| `assigned_to` | text | ✓ |
| `status` | text | ✓ |
| `photos` | jsonb | ✓ |
| `root_cause` | text | ✓ |
| `asset_no` | text | ✓ |
| `tyre_serial` | text | ✓ |
| `created_by` | uuid | ✓ |
| `closed_by` | uuid | ✓ |
| `created_at` | timestamptz | ✓ |
| `closed_at` | timestamptz | ✓ |
| `due_date` | timestamptz | ✓ |
| `country` | text | ✓ |
| `photo_data` | text | ✓ |
| `resolved_at` | timestamptz | ✓ |
| `organisation_id` | uuid | ✓ |

## `inspections`

Tyre/vehicle inspections; tyre data snapshot in tyre_conditions JSONB.

| Column | Type | Null |
|--------|------|:----:|
| `id` | uuid | — |
| `title` | text | — |
| `inspection_type` | text | ✓ |
| `site` | text | — |
| `asset_no` | text | ✓ |
| `tyre_serial` | text | ✓ |
| `region` | text | ✓ |
| `scheduled_date` | date | — |
| `completed_date` | date | ✓ |
| `status` | text | ✓ |
| `findings` | text | ✓ |
| `inspector` | text | ✓ |
| `notes` | text | ✓ |
| `created_by` | uuid | ✓ |
| `created_at` | timestamptz | ✓ |
| `country` | text | ✓ |
| `attendees` | text | ✓ |
| `severity` | text | ✓ |
| `photo_data` | text | ✓ |
| `linked_action_id` | uuid | ✓ |
| `inspection_date` | date | ✓ |
| `tyre_conditions` | jsonb | ✓ |
| `vehicle_type` | text | ✓ |
| `odometer_km` | numeric | ✓ |
| `hour_meter` | numeric | ✓ |
| `inspector_signature` | text | ✓ |
| `approval_status` | text | ✓ |
| `approver_email` | text | ✓ |
| `approver_signature` | text | ✓ |
| `approved_at` | timestamptz | ✓ |
| `approved_by` | uuid | ✓ |
| `pressure_reading` | numeric | ✓ |
| `locked` | bool | — |
| `locked_at` | timestamptz | ✓ |
| `organisation_id` | uuid | ✓ |
| `custom_data` | jsonb | ✓ |

## `accidents`

Accident records with structured parts/remarks children and private photos.

| Column | Type | Null |
|--------|------|:----:|
| `id` | uuid | — |
| `site` | text | — |
| `asset_no` | text | — |
| `vehicle_id` | uuid | ✓ |
| `reported_by` | uuid | ✓ |
| `reporter_name` | text | ✓ |
| `incident_date` | date | — |
| `incident_time` | text | ✓ |
| `location` | text | ✓ |
| `accident_type` | text | — |
| `severity` | text | — |
| `description` | text | ✓ |
| `injuries` | bool | — |
| `injury_count` | int | — |
| `third_party_involved` | bool | — |
| `police_report_no` | text | ✓ |
| `damage_description` | text | ✓ |
| `estimated_damage_cost` | numeric | ✓ |
| `photos` | jsonb | — |
| `status` | text | — |
| `notes` | text | ✓ |
| `created_at` | timestamptz | — |
| `updated_at` | timestamptz | — |
| `reviewed_by` | uuid | ✓ |
| `reviewed_at` | timestamptz | ✓ |
| `responsible_party` | text | ✓ |
| `liable_party` | text | ✓ |
| `payer` | text | ✓ |
| `driver_name` | text | ✓ |
| `insurer` | text | ✓ |
| `policy_no` | text | ✓ |
| `claim_status` | text | ✓ |
| `claim_amount` | numeric | ✓ |
| `claim_approved_amount` | numeric | ✓ |
| `deductible` | numeric | ✓ |
| `parts_cost` | numeric | ✓ |
| `closure_status` | text | ✓ |
| `close_requested_by` | uuid | ✓ |
| `close_requested_at` | timestamptz | ✓ |
| `close_request_note` | text | ✓ |
| `closure_approved_by` | uuid | ✓ |
| `closure_approved_at` | timestamptz | ✓ |
| `closure_rejected_reason` | text | ✓ |
| `recovered_amount` | numeric | ✓ |
| `recovery_date` | date | ✓ |
| `recovery_source` | text | ✓ |
| `recovery_status` | text | ✓ |
| `recovery_reference` | text | ✓ |
| `country` | text | ✓ |
| `case_stage` | text | ✓ |
| `damage_condition` | text | ✓ |
| `current_status` | text | ✓ |
| `action_to_be_taken` | text | ✓ |
| `responsible_owner` | text | ✓ |
| `required_action` | text | ✓ |
| `status_update_date` | date | ✓ |
| `status_update_note` | text | ✓ |
| `expected_release_date` | date | ✓ |
| `repair_cost` | numeric | ✓ |
| `insurance_claim_no` | text | ✓ |
| `inspector` | text | ✓ |
| `organisation_id` | uuid | ✓ |
| `custom_data` | jsonb | ✓ |

## `suppliers`

Supplier master for tyres/parts/workshops.

| Column | Type | Null |
|--------|------|:----:|
| `id` | uuid | — |
| `supplier_name` | text | — |
| `supplier_code` | text | ✓ |
| `supplier_type` | text | ✓ |
| `contact_person` | text | ✓ |
| `phone` | text | ✓ |
| `email` | text | ✓ |
| `site` | text | ✓ |
| `region` | text | ✓ |
| `country` | text | ✓ |
| `rating` | numeric | ✓ |
| `status` | text | — |
| `notes` | text | ✓ |
| `organisation_id` | uuid | ✓ |
| `created_by` | uuid | ✓ |
| `created_at` | timestamptz | — |
| `updated_by` | uuid | ✓ |
| `updated_at` | timestamptz | — |
| `custom_data` | jsonb | ✓ |

## `warranty_claims`

Tyre warranty claims (financial records).

| Column | Type | Null |
|--------|------|:----:|
| `id` | uuid | — |
| `claim_no` | text | — |
| `serial_number` | text | ✓ |
| `brand` | text | ✓ |
| `size` | text | ✓ |
| `asset_no` | text | ✓ |
| `site` | text | ✓ |
| `country` | text | ✓ |
| `fitment_date` | date | ✓ |
| `removal_date` | date | ✓ |
| `km_at_fitment` | numeric | ✓ |
| `km_at_removal` | numeric | ✓ |
| `km_run` | numeric | ✓ |
| `expected_life_km` | numeric | ✓ |
| `failure_type` | text | ✓ |
| `supplier` | text | ✓ |
| `notes` | text | ✓ |
| `claim_status` | text | — |
| `credit_amount` | numeric | ✓ |
| `credit_date` | date | ✓ |
| `created_by` | uuid | ✓ |
| `created_at` | timestamptz | — |
| `updated_at` | timestamptz | — |
| `organisation_id` | uuid | ✓ |
| `custom_data` | jsonb | ✓ |

## `recalls`

Safety recall tracking.

| Column | Type | Null |
|--------|------|:----:|
| `id` | uuid | — |
| `recall_number` | text | — |
| `brand` | text | — |
| `affected_sizes` | array | — |
| `affected_serial_prefix` | text | ✓ |
| `issue_date` | date | ✓ |
| `severity` | text | — |
| `description` | text | ✓ |
| `action_required` | text | ✓ |
| `source` | text | ✓ |
| `status` | text | — |
| `country` | text | ✓ |
| `created_by` | uuid | ✓ |
| `created_at` | timestamptz | — |
| `closed_at` | timestamptz | ✓ |
| `organisation_id` | uuid | ✓ |

## `budgets`

Budget allocations by scope/period.

| Column | Type | Null |
|--------|------|:----:|
| `id` | uuid | — |
| `site` | text | — |
| `region` | text | ✓ |
| `monthly_budget` | numeric | — |
| `year` | int | ✓ |
| `month` | int | ✓ |
| `created_by` | uuid | ✓ |
| `created_at` | timestamptz | ✓ |
| `country` | text | ✓ |
| `status` | text | ✓ |
| `organisation_id` | uuid | ✓ |

## `alerts`

Operational alerts (tyre risk, compliance) with acknowledge state.

| Column | Type | Null |
|--------|------|:----:|
| `id` | uuid | — |
| `asset_no` | text | ✓ |
| `alert_type` | text | ✓ |
| `severity` | text | ✓ |
| `message` | text | ✓ |
| `site` | text | ✓ |
| `country` | text | ✓ |
| `resolved` | bool | ✓ |
| `is_active` | bool | ✓ |
| `created_by` | uuid | ✓ |
| `created_at` | timestamptz | ✓ |
| `organisation_id` | uuid | ✓ |

## `currency_rates`

Approval-gated FX rates for currency conversion trail.

| Column | Type | Null |
|--------|------|:----:|
| `id` | uuid | — |
| `organisation_id` | uuid | — |
| `base_currency` | text | — |
| `quote_currency` | text | — |
| `rate` | numeric | — |
| `rate_date` | date | — |
| `source` | text | — |
| `approved` | bool | — |
| `approved_by` | uuid | ✓ |
| `approved_at` | timestamptz | ✓ |
| `created_by` | uuid | ✓ |
| `created_at` | timestamptz | — |

## `module_permissions`

Role x module access grants (org_id NULL = global).

| Column | Type | Null |
|--------|------|:----:|
| `id` | uuid | — |
| `module_key` | text | — |
| `role` | text | — |
| `org_id` | uuid | ✓ |
| `enabled` | bool | — |
| `updated_by` | uuid | ✓ |
| `updated_at` | timestamptz | — |

## `report_schedules`

Recurring report delivery schedules.

| Column | Type | Null |
|--------|------|:----:|
| `id` | uuid | — |
| `name` | text | — |
| `report_type` | text | — |
| `frequency` | text | — |
| `day_of_week` | int | ✓ |
| `day_of_month` | int | ✓ |
| `time_of_day` | text | — |
| `recipients` | array | — |
| `active` | bool | — |
| `last_sent_at` | timestamptz | ✓ |
| `next_run_at` | timestamptz | ✓ |
| `org_id` | uuid | ✓ |
| `created_by` | uuid | ✓ |
| `created_at` | timestamptz | — |
| `updated_at` | timestamptz | — |

## `report_send_log`

Per-attempt delivery log for scheduled reports.

| Column | Type | Null |
|--------|------|:----:|
| `id` | uuid | — |
| `schedule_id` | uuid | ✓ |
| `schedule_name` | text | ✓ |
| `report_type` | text | ✓ |
| `recipients` | array | ✓ |
| `status` | text | — |
| `error` | text | ✓ |
| `sent_at` | timestamptz | — |

## `ai_usage_log`

Per-call AI usage + cost log (chat-ai).

| Column | Type | Null |
|--------|------|:----:|
| `id` | uuid | — |
| `user_id` | uuid | ✓ |
| `organisation_id` | uuid | ✓ |
| `agent` | text | ✓ |
| `model` | text | — |
| `input_tokens` | int | — |
| `output_tokens` | int | — |
| `total_tokens` | int | ✓ |
| `cost_usd` | numeric | — |
| `country` | text | ✓ |
| `site` | text | ✓ |
| `source` | text | ✓ |
| `created_at` | timestamptz | — |

## `audit_log_v2`

Canonical audit trail (record_audit_event target).

| Column | Type | Null |
|--------|------|:----:|
| `id` | uuid | — |
| `user_id` | uuid | ✓ |
| `user_email` | text | ✓ |
| `action` | text | — |
| `table_name` | text | ✓ |
| `record_id` | text | ✓ |
| `old_data` | jsonb | ✓ |
| `new_data` | jsonb | ✓ |
| `ip_address` | inet | ✓ |
| `user_agent` | text | ✓ |
| `site` | text | ✓ |
| `country` | text | ✓ |
| `created_at` | timestamptz | ✓ |
