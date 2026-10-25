-- Preventive Maintenance page is now open to Admin, Manager and Director (route, nav and record_pm_service already
-- allow them), so its due alert reaches them too. Insurance policies stay Admin-only (claims and premium data).
update public.due_alert_rules
   set recipient_roles = array['Admin','Manager','Director'], updated_at = now()
 where rule_key = 'pm_due';
