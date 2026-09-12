-- Meter Logs access permits entry and audited correction within the existing vehicle scope.
CREATE OR REPLACE FUNCTION public.vehicle_meter_permissions()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'canSave', coalesce(auth.uid() IS NOT NULL AND public.app_is_active() AND
      public.app_user_can('odometer_logs','view'), false),
    'canReview', coalesce(auth.uid() IS NOT NULL AND public.app_is_active() AND
      (public.get_my_role()='Admin' OR public.is_super_admin()), false),
    'canCorrect', coalesce(auth.uid() IS NOT NULL AND public.app_is_active() AND
      public.app_user_can('odometer_logs','view'), false)
  );
$$;
REVOKE ALL ON FUNCTION public.vehicle_meter_permissions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vehicle_meter_permissions() TO authenticated;

-- Fix delegated web meter writes and flag lower new readings for Admin review. Historical corrections retain their reason, source and audit trail.
SET LOCAL lock_timeout = '5s';


-- Only this private projection helper runs as owner. It accepts no readings or
-- fleet attributes, independently checks the caller's full scope, locks the
-- vehicle, and derives hours from saved logs. General fleet editing stays denied.
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated;
CREATE OR REPLACE FUNCTION private.refresh_web_meter_vehicle(p_vehicle_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $meter$
DECLARE v public.vehicle_fleet%ROWTYPE; last_hours numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.app_is_active(),false)
    OR NOT coalesce(public.app_user_can('odometer_logs','view'),false) THEN
    RAISE EXCEPTION 'Not permitted' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v FROM public.vehicle_fleet
    WHERE id=p_vehicle_id AND organisation_id=public.app_current_org()
      AND (country IS NULL OR public.is_super_admin() OR public.app_sees_all_countries()
        OR lower(btrim(country))=ANY(coalesce(public.app_country_scope(),'{}'::text[])))
      AND (site IS NULL OR btrim(site)='' OR public.app_sees_all_sites()
        OR upper(btrim(site))=ANY(coalesce(public.app_site_scope(),'{}'::text[])))
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vehicle unavailable' USING ERRCODE='42501'; END IF;
  SELECT engine_hours INTO last_hours FROM public.engine_hours_logs
    WHERE organisation_id=v.organisation_id AND asset_no=v.asset_no
      AND country IS NOT DISTINCT FROM v.country
    ORDER BY reading_date DESC NULLS LAST,created_at DESC,id DESC LIMIT 1;
  last_hours := greatest(last_hours,v.current_engine_hours,v.current_hours);
  IF last_hours IS DISTINCT FROM v.current_engine_hours THEN
    UPDATE public.vehicle_fleet SET current_engine_hours=last_hours,updated_at=now() WHERE id=v.id;
  END IF;
END $meter$;
REVOKE ALL ON FUNCTION private.refresh_web_meter_vehicle(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.refresh_web_meter_vehicle(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_vehicle_meter_readings(
  p_vehicle_id uuid, p_reading_date date, p_km numeric, p_hours numeric,
  p_request_id uuid, p_expected_km numeric, p_expected_hours numeric,
  p_notes text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v public.vehicle_fleet%ROWTYPE;
  o public.odometer_logs%ROWTYPE;
  h public.engine_hours_logs%ROWTYPE;
  last_km numeric; last_hours numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.app_is_active(),false) OR
     NOT coalesce((public.vehicle_meter_permissions()->>'canSave')::boolean,false) THEN
    RAISE EXCEPTION 'Not permitted' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR p_reading_date IS NULL OR p_reading_date > current_date + 1
     OR (p_km IS NULL AND p_hours IS NULL)
     OR p_km < 0 OR p_hours < 0
     OR p_km::text IN ('NaN','Infinity','-Infinity')
     OR p_hours::text IN ('NaN','Infinity','-Infinity') THEN
    RAISE EXCEPTION 'Invalid meter reading' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v FROM public.vehicle_fleet
    WHERE id = p_vehicle_id AND organisation_id = public.app_current_org();
  IF NOT FOUND THEN RAISE EXCEPTION 'Vehicle unavailable' USING ERRCODE = '42501'; END IF;
  PERFORM private.refresh_web_meter_vehicle(p_vehicle_id);
  SELECT * INTO v FROM public.vehicle_fleet WHERE id=p_vehicle_id;
  IF p_reading_date > (now() AT TIME ZONE CASE WHEN v.country='UAE' THEN 'Asia/Dubai' WHEN v.country='Egypt' THEN 'Africa/Cairo' ELSE 'Asia/Riyadh' END)::date THEN
    RAISE EXCEPTION 'Future reading date' USING ERRCODE='22023';
  END IF;
  IF (SELECT count(*) FROM public.vehicle_fleet WHERE organisation_id = v.organisation_id
      AND asset_no = v.asset_no AND country IS NOT DISTINCT FROM v.country) <> 1 THEN
    RAISE EXCEPTION 'Ambiguous vehicle identity' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO o FROM public.odometer_logs WHERE client_uuid = 'web_' || p_request_id || '_km';
  SELECT * INTO h FROM public.engine_hours_logs WHERE client_uuid = 'web_' || p_request_id || '_hours';
  IF o.id IS NOT NULL OR h.id IS NOT NULL THEN
    IF (p_km IS NOT NULL AND (o.id IS NULL OR o.odometer_km IS DISTINCT FROM p_km OR o.reading_date IS DISTINCT FROM p_reading_date
        OR o.asset_no IS DISTINCT FROM v.asset_no OR o.organisation_id IS DISTINCT FROM v.organisation_id OR o.country IS DISTINCT FROM v.country))
      OR (p_hours IS NOT NULL AND (h.id IS NULL OR h.engine_hours IS DISTINCT FROM p_hours OR h.reading_date IS DISTINCT FROM p_reading_date
        OR h.asset_no IS DISTINCT FROM v.asset_no OR h.organisation_id IS DISTINCT FROM v.organisation_id OR h.country IS DISTINCT FROM v.country))
      OR (p_km IS NULL AND o.id IS NOT NULL) OR (p_hours IS NULL AND h.id IS NOT NULL) THEN
      RAISE EXCEPTION 'Request already used' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('odometer',to_jsonb(o),'hours',to_jsonb(h),'vehicle',jsonb_build_object('id',v.id,'current_km',v.current_km,'current_engine_hours',v.current_engine_hours,'updated_at',v.updated_at));
  END IF;

  SELECT odometer_km INTO last_km FROM public.odometer_logs WHERE asset_no=v.asset_no
    AND organisation_id=v.organisation_id AND country IS NOT DISTINCT FROM v.country
    ORDER BY reading_date DESC NULLS LAST, created_at DESC,id DESC LIMIT 1;
  last_km := greatest(v.current_km,last_km);
  SELECT engine_hours INTO last_hours FROM public.engine_hours_logs WHERE asset_no=v.asset_no
    AND organisation_id=v.organisation_id AND country IS NOT DISTINCT FROM v.country
    ORDER BY reading_date DESC NULLS LAST,created_at DESC,id DESC LIMIT 1;
  last_hours := greatest(last_hours,v.current_engine_hours,v.current_hours);
  IF (p_km IS NOT NULL AND p_expected_km IS DISTINCT FROM last_km)
    OR (p_hours IS NOT NULL AND p_expected_hours IS DISTINCT FROM last_hours) THEN
    RAISE EXCEPTION 'Meter changed; refresh before saving' USING ERRCODE = '40001';
  END IF;

  IF p_km IS NOT NULL THEN
    INSERT INTO public.odometer_logs(asset_no,organisation_id,country,site,reading_date,odometer_km,source,notes,created_by,client_uuid)
      VALUES(v.asset_no,v.organisation_id,v.country,v.site,p_reading_date,p_km,'Web Manual',left(p_notes,4000),auth.uid(),'web_'||p_request_id||'_km') RETURNING * INTO o;
    -- Set the web review flag from this tenant/country's locked baseline,
    -- rather than the legacy trigger's broader historical lookup.
    UPDATE public.odometer_logs SET flagged=coalesce(p_km<last_km,false),
      flagged_prev_reading=CASE WHEN p_km<last_km THEN last_km ELSE NULL END,
      flag_reason=CASE WHEN p_km<last_km THEN format('Reading %s km is below last %s km. Awaiting Admin review.',p_km,last_km) ELSE NULL END,
      reviewed=false,reviewed_by=NULL,reviewed_at=NULL
      WHERE id=o.id RETURNING * INTO o;
    INSERT INTO public.audit_log(table_name,record_id,action,new_data,changed_by,organisation_id,details)
      VALUES('odometer_logs',o.id,'INSERT',to_jsonb(o),auth.uid(),v.organisation_id,jsonb_build_object('channel','Web Manual'));
  END IF;
  IF p_hours IS NOT NULL THEN
    INSERT INTO public.engine_hours_logs(asset_no,organisation_id,country,site,reading_date,engine_hours,source,notes,created_by,client_uuid)
      VALUES(v.asset_no,v.organisation_id,v.country,v.site,p_reading_date,p_hours,'Web Manual',left(p_notes,4000),auth.uid(),'web_'||p_request_id||'_hours') RETURNING * INTO h;
    -- Set the web review flag from this tenant/country's locked baseline,
    -- rather than the legacy trigger's broader historical lookup.
    UPDATE public.engine_hours_logs SET flagged=coalesce(p_hours<last_hours,false),
      flagged_prev_reading=CASE WHEN p_hours<last_hours THEN last_hours ELSE NULL END,
      flag_reason=CASE WHEN p_hours<last_hours THEN format('Reading %s hours is below last %s hours. Awaiting Admin review.',p_hours,last_hours) ELSE NULL END,
      reviewed=false,reviewed_by=NULL,reviewed_at=NULL
      WHERE id=h.id RETURNING * INTO h;
    PERFORM private.refresh_web_meter_vehicle(v.id);
    INSERT INTO public.audit_log(table_name,record_id,action,new_data,changed_by,organisation_id,details)
      VALUES('engine_hours_logs',h.id,'INSERT',to_jsonb(h),auth.uid(),v.organisation_id,jsonb_build_object('channel','Web Manual'));
  END IF;
  SELECT * INTO v FROM public.vehicle_fleet WHERE id=p_vehicle_id;
  RETURN jsonb_build_object('odometer',to_jsonb(o),'hours',to_jsonb(h),'vehicle',jsonb_build_object('id',v.id,'current_km',v.current_km,'current_engine_hours',v.current_engine_hours,'updated_at',v.updated_at));
END $$;
REVOKE ALL ON FUNCTION public.save_vehicle_meter_readings(uuid,date,numeric,numeric,uuid,numeric,numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_vehicle_meter_readings(uuid,date,numeric,numeric,uuid,numeric,numeric,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.correct_vehicle_meter_reading(
  p_kind text,p_id uuid,p_value numeric,p_reading_date date,p_reason text,p_expected_updated_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE old_row jsonb; new_row jsonb; target_table text; value_column text;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.app_is_active(),false) OR
    NOT coalesce((public.vehicle_meter_permissions()->>'canCorrect')::boolean,false) THEN
    RAISE EXCEPTION 'Not permitted' USING ERRCODE='42501';
  END IF;
  IF p_kind NOT IN ('km','hours') OR p_kind IS NULL OR p_value IS NULL OR p_value < 0
    OR p_value::text IN ('NaN','Infinity','-Infinity') OR p_reading_date IS NULL
    OR p_reading_date > current_date + 1 OR length(btrim(coalesce(p_reason,''))) < 3 THEN
    RAISE EXCEPTION 'Invalid correction' USING ERRCODE='22023';
  END IF;
  target_table := CASE WHEN p_kind='km' THEN 'odometer_logs' ELSE 'engine_hours_logs' END;
  value_column := CASE WHEN p_kind='km' THEN 'odometer_km' ELSE 'engine_hours' END;
  EXECUTE format('SELECT to_jsonb(r) FROM public.%I r WHERE id=$1 AND organisation_id=public.app_current_org() FOR UPDATE',target_table)
    INTO old_row USING p_id;
  IF old_row IS NULL THEN RAISE EXCEPTION 'Reading unavailable' USING ERRCODE='42501'; END IF;
  IF coalesce((old_row->>'flagged')::boolean,false) AND
    NOT coalesce((public.vehicle_meter_permissions()->>'canReview')::boolean,false) THEN
    RAISE EXCEPTION 'Admin review required' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vehicle_fleet v
    WHERE v.organisation_id=public.app_current_org() AND v.asset_no=old_row->>'asset_no'
      AND v.country IS NOT DISTINCT FROM old_row->>'country') THEN
    RAISE EXCEPTION 'Vehicle unavailable' USING ERRCODE='42501';
  END IF;
  IF p_reading_date > (now() AT TIME ZONE CASE WHEN old_row->>'country'='UAE' THEN 'Asia/Dubai' WHEN old_row->>'country'='Egypt' THEN 'Africa/Cairo' ELSE 'Asia/Riyadh' END)::date THEN
    RAISE EXCEPTION 'Future reading date' USING ERRCODE='22023';
  END IF;
  IF (old_row->>'updated_at')::timestamptz IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Reading changed; refresh before correcting' USING ERRCODE='40001';
  END IF;
  EXECUTE format('UPDATE public.%I r SET %I=$1,reading_date=$2,updated_at=clock_timestamp() WHERE id=$3 RETURNING to_jsonb(r)',target_table,value_column)
    INTO new_row USING p_value,p_reading_date,p_id;
  IF p_value < (old_row->>value_column)::numeric AND NOT coalesce((old_row->>'flagged')::boolean,false) THEN
    EXECUTE format('UPDATE public.%I r SET flagged=true,flagged_prev_reading=$2,flag_reason=$3,reviewed=false,reviewed_by=NULL,reviewed_at=NULL WHERE id=$1 RETURNING to_jsonb(r)',target_table)
      INTO new_row USING p_id,(old_row->>value_column)::numeric,'Corrected reading is lower than the original. Awaiting Admin review.';
  END IF;
  IF coalesce((new_row->>'flagged')::boolean,false) AND coalesce((public.vehicle_meter_permissions()->>'canReview')::boolean,false) THEN
    EXECUTE format('UPDATE public.%I r SET reviewed=true,reviewed_by=auth.uid(),reviewed_at=now() WHERE id=$1 RETURNING to_jsonb(r)',target_table)
      INTO new_row USING p_id;
  END IF;
  INSERT INTO public.audit_log(table_name,record_id,action,old_data,new_data,changed_by,organisation_id,details)
    VALUES(target_table,p_id,'UPDATE',old_row,new_row,auth.uid(),public.app_current_org(),jsonb_build_object('channel','Web Manual','reason',left(btrim(p_reason),4000)));
  RETURN new_row;
END $$;
REVOKE ALL ON FUNCTION public.correct_vehicle_meter_reading(text,uuid,numeric,date,text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.correct_vehicle_meter_reading(text,uuid,numeric,date,text,timestamptz) TO authenticated;
