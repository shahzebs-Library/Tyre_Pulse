-- V488 - send a message to your people's phones and their in-app inbox.
-- STATUS: APPLIED LIVE (project jhssdmeruxtrlqnwfksc) + verified rolled back.
--   Audience preview: everyone = 35 people / 2 with the app.
--   Real send to KSA Tyre Men: 16 recipients, 1 push queued.
--
-- Everything that notifies today is event driven: something happens and the
-- system tells whoever is concerned. There was no way for a manager to simply
-- say something to the team. The Announcements page writes a banner INSIDE the
-- web app and reaches no phone at all.
--
-- This adds NO new transport. The in-app row goes to `notifications` (the same
-- bell the phone and the web both read) and the push goes to
-- `workflow_notifications` with a pre-rendered {title, body}, which the
-- workflow-notify edge function already supports - so retry, backoff and the
-- global push kill switch all apply unchanged. No edge redeploy.
--
-- BILINGUAL BY CONSTRUCTION, NOT BY MACHINE TRANSLATION. The fleet is split
-- between English and Arabic speakers, and inventing a translation of an
-- operational instruction is worse than not offering one. The sender may type
-- an Arabic version; a recipient known to read Arabic gets it, and a recipient
-- whose language is not yet known gets BOTH rather than silently losing half
-- the message.
--
-- OBJECTS
--   table    public.broadcast_messages      (org isolated, elevated read/write)
--   function public.broadcast_audience(...)  who this reaches, before sending
--   function public.broadcast_send(...)      record + inbox + queue push, atomically
--   column   public.profiles.language        which language a person reads (V488c)
--
-- V488c ALSO FIXED A DEFECT IN V488b: the first cut of broadcast_send read
-- profiles.language, which did not exist, so it would have failed on the first
-- real send. The column now exists and the mobile app writes it on sign in and
-- whenever the language is changed.
--
-- ROLLBACK:
--   drop function if exists public.broadcast_send(text,text,text,text,text[],text[],text[],boolean);
--   drop function if exists public.broadcast_audience(text[],text[],text[]);
--   drop table if exists public.broadcast_messages;
--   alter table public.profiles drop column if exists language;
--
-- Full bodies are the live definitions:
--   select pg_get_functiondef('public.broadcast_send(text,text,text,text,text[],text[],text[],boolean)'::regprocedure);
--   select pg_get_functiondef('public.broadcast_audience(text[],text[],text[])'::regprocedure);

alter table public.profiles add column if not exists language text;

comment on column public.profiles.language is
  'The language this person set in the app (en / ar). Written by the mobile app on sign in. Null means unknown, in which case bilingual messages are sent in full rather than guessed at.';
