-- Allow assigned employee to remove orphaned storage objects only,
-- when corresponding evidence metadata was not committed.
drop policy if exists "action evidence orphan cleanup" on storage.objects;
create policy "action evidence orphan cleanup" on storage.objects
for delete to authenticated using (
 bucket_id='team-action-evidence'
 and (storage.foldername(name))[1]=auth.uid()::text
 and exists(select 1 from public.action_items a
 where a.id::text=(storage.foldername(name))[2]
 and a.assigned_user_id=auth.uid() and a.organisation_id=public.app_current_org())
 and not exists(select 1 from public.team_action_evidence e where e.storage_path=name)
);
