begin;

-- Empty by default: granting an account moderation access is an explicit owner
-- decision, never a browser action or an email/name guessed by the application.
create table public.pixel_moderators (
 user_id uuid primary key references auth.users(id),
 created_at timestamptz not null default now()
);
create table public.pixel_entry_reports (
 id uuid primary key default gen_random_uuid(),
 entry_id uuid not null references public.pixel_entries(id),
 reporter_id uuid not null references auth.users(id),
 reason text not null check (reason in ('spam','harassment','inappropriate','copied','other')),
 details text not null default '' check (length(details)<=500),
 status text not null default 'open' check (status in ('open','dismissed','actioned')),
 created_at timestamptz not null default now(),
 reviewed_at timestamptz,
 unique(entry_id,reporter_id)
);
create index pixel_reports_pending on public.pixel_entry_reports(status,created_at);
create index pixel_reports_rate on public.pixel_entry_reports(reporter_id,created_at);
create table public.pixel_moderation_audit (
 id uuid primary key default gen_random_uuid(),
 report_id uuid not null references public.pixel_entry_reports(id),
 moderator_id uuid not null references auth.users(id),
 action text not null check (action in ('hide','restore','dismiss')),
 note text not null check (length(btrim(note)) between 1 and 500),
 created_at timestamptz not null default now()
);
alter table public.pixel_entries add column moderation_hidden_at timestamptz;
alter table public.pixel_moderators enable row level security;
alter table public.pixel_entry_reports enable row level security;
alter table public.pixel_moderation_audit enable row level security;
revoke all on public.pixel_moderators, public.pixel_entry_reports, public.pixel_moderation_audit from public,anon,authenticated;

create function public.pixel_moderation_status() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.pixel_moderators m join auth.users u on u.id=m.user_id
   where m.user_id=auth.uid() and u.email_confirmed_at is not null);
$$;
create function public.pixel_require_moderator() returns uuid language plpgsql security definer set search_path='' as $$
declare viewer uuid:=public.pixel_verified_user();
begin
 if not public.pixel_moderation_status() then raise exception 'Moderator access is required.'; end if;
 return viewer;
end;
$$;

create function public.pixel_report_entry(p_entry uuid,p_reason text,p_details text default '') returns uuid
language plpgsql security definer set search_path='' as $$
declare viewer uuid:=public.pixel_verified_user(); e public.pixel_events; a public.pixel_entries; existing uuid; report uuid;
begin
 -- Serialize this account's requests so concurrent tabs cannot bypass the cap.
 perform pg_advisory_xact_lock(hashtextextended(viewer::text,11));
 select * into a from public.pixel_entries where id=p_entry;
 if not found then raise exception 'Artwork is not available for reporting.'; end if;
 select * into e from public.pixel_events where id=a.event_id for update;
 select * into a from public.pixel_entries where id=p_entry;
 if e.challenge_key is null or e.deleted_at is not null or e.phase not in ('voting','results') or a.moderation_hidden_at is not null then
   raise exception 'Only visible artwork in public challenge galleries can be reported.';
 end if;
 if p_reason is null or p_reason not in ('spam','harassment','inappropriate','copied','other') or length(coalesce(p_details,''))>500 then
   raise exception 'Choose a report reason and use at most 500 characters.';
 end if;
 select id into existing from public.pixel_entry_reports where entry_id=p_entry and reporter_id=viewer;
 if found then return existing; end if;
 if (select count(*) from public.pixel_entry_reports where reporter_id=viewer and created_at>now()-interval '1 hour')>=10 then
   raise exception 'Report limit reached. Please wait before sending more reports.';
 end if;
 insert into public.pixel_entry_reports(entry_id,reporter_id,reason,details) values(p_entry,viewer,p_reason,btrim(coalesce(p_details,''))) returning id into report;
 return report;
end;
$$;

create function public.pixel_moderation_queue(p_closed boolean default false,p_offset integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare viewer uuid:=public.pixel_require_moderator(); result jsonb;
begin
 if p_offset is null or p_offset<0 then raise exception 'Invalid report page.'; end if;
 select coalesce(jsonb_agg(to_jsonb(item) order by item.created_at desc),'[]'::jsonb) into result from (
   select r.id,r.reason,r.details,r.status,r.created_at,r.reviewed_at,a.id as entry_id,a.title,a.artist,
     a.width,a.pixels,a.moderation_hidden_at,e.id as event_id,e.title as event_title
   from public.pixel_entry_reports r join public.pixel_entries a on a.id=r.entry_id join public.pixel_events e on e.id=a.event_id
   where e.challenge_key is not null and ((not coalesce(p_closed,false) and r.status='open') or (coalesce(p_closed,false) and r.status<>'open'))
   order by r.created_at desc,r.id desc limit 50 offset p_offset
 ) item;
 return result;
end;
$$;
create function public.pixel_review_report(p_report uuid,p_action text,p_note text) returns void language plpgsql security definer set search_path='' as $$
declare viewer uuid:=public.pixel_require_moderator(); r public.pixel_entry_reports; e public.pixel_events;
begin
 if p_action is null or p_action not in ('hide','restore','dismiss') or p_note is null or length(btrim(p_note)) not between 1 and 500 then
   raise exception 'Choose an action and explain it in 1–500 characters.';
 end if;
 select * into r from public.pixel_entry_reports where id=p_report;
 if not found then raise exception 'Report not found.'; end if;
 select e1.* into e from public.pixel_events e1 join public.pixel_entries a on a.event_id=e1.id where a.id=r.entry_id for update of e1;
 if e.challenge_key is null then raise exception 'Only public challenge artwork is moderated here.'; end if;
 select * into r from public.pixel_entry_reports where id=p_report for update;
 if p_action='hide' then
   update public.pixel_entries set moderation_hidden_at=coalesce(moderation_hidden_at,now()) where id=r.entry_id;
 elsif p_action='restore' then
   update public.pixel_entries set moderation_hidden_at=null where id=r.entry_id;
 end if;
 update public.pixel_entry_reports set status=case when p_action='hide' then 'actioned' else 'dismissed' end,reviewed_at=now()
   where id=p_report or (entry_id=r.entry_id and status='open' and p_action in ('hide','restore'));
 insert into public.pixel_moderation_audit(report_id,moderator_id,action,note) values(p_report,viewer,p_action,btrim(p_note));
end;
$$;

-- Preserve artwork and ballot history; hide rather than delete. Reject new votes
-- for hidden entries, including legacy clients bypassing the displayed gallery.
create function public.pixel_ballot_visible_entries() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.pixel_entries where id=any(new.choices) and moderation_hidden_at is not null) then
   raise exception 'An entry in your ballot is no longer available. Choose from the current gallery.';
 end if;
 return new;
end;
$$;
create trigger pixel_ballot_visible_entries before insert or update on public.pixel_ballots for each row execute function public.pixel_ballot_visible_entries();

-- Both clock enforcement and autonomous room protection use eligible entries.
create function public.pixel_eligible_entry_count(p_event uuid) returns integer language sql stable security definer set search_path='' as $$
 select count(*)::integer from public.pixel_entries where event_id=p_event and moderation_hidden_at is null;
$$;
create or replace function public.pixel_tick_event_phases(p_event uuid) returns void language plpgsql security definer set search_path='' as $$
declare e public.pixel_events; enough boolean;
begin
 select * into e from public.pixel_events where id=p_event for update;
 if not found or e.deleted_at is not null then return; end if;
 perform public.pixel_tick_scheduled_start(p_event);
 select * into e from public.pixel_events where id=p_event;
 if e.phase in ('lobby','submissions') and e.submission_deadline<=now() then
   enough:=public.pixel_eligible_entry_count(p_event)>=2;
   update public.pixel_events set phase=case when enough then 'voting' else 'results' end,
     phase_changed_at=e.submission_deadline,
     voting_deadline=case when enough then e.submission_deadline+make_interval(secs=>e.voting_duration_seconds) else null end,
     ended_reason=case when enough then null else 'drawing_insufficient' end where id=p_event returning * into e;
 end if;
 if e.phase='voting' and e.voting_deadline<=now() then
   update public.pixel_events set phase='results',phase_changed_at=e.voting_deadline,ended_reason='voting_timeout' where id=p_event;
 end if;
end;
$$;

-- Replace just the public guard's entry count, preserving the proven guard.
do $$
declare definition text;
begin
 select pg_get_functiondef('public.pixel_protect_public_round()'::regprocedure) into definition;
 if strpos(definition,'(select count(*) from public.pixel_entries where event_id=old.id) >= 2')=0 then
   raise exception 'Unexpected public round guard. Stop and check installed migrations before upgrading.';
 end if;
 definition:=replace(definition,'(select count(*) from public.pixel_entries where event_id=old.id) >= 2','public.pixel_eligible_entry_count(old.id) >= 2');
 execute definition;
end;
$$;

alter function public.pixel_event_snapshot(uuid) rename to pixel_event_snapshot_v6;
revoke all on function public.pixel_event_snapshot_v6(uuid) from public,anon,authenticated;
create function public.pixel_event_snapshot(p_event uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; visible jsonb; public_round boolean; eligible integer; total integer; has_votes boolean;
begin
 result:=public.pixel_event_snapshot_v6(p_event);
 if result is null then return null; end if;
 public_round:=result->>'challenge_key' is not null;
 if not public_round then return result; end if;
 eligible:=public.pixel_eligible_entry_count(p_event);
 select count(*) into total from public.pixel_entries where event_id=p_event;
 select coalesce(jsonb_agg(item.value order by item.ordinality),'[]'::jsonb) into visible
 from jsonb_array_elements(result->'entries') with ordinality item(value,ordinality)
 join public.pixel_entries a on a.id=(item.value->>'id')::uuid where a.moderation_hidden_at is null;
 if result->>'phase'='results' then
   select coalesce(jsonb_agg(item.value || jsonb_build_object('rank',1+(select count(*) from jsonb_array_elements(visible) other where (other->>'score')::numeric>(item.value->>'score')::numeric)) order by item.ordinality),'[]'::jsonb)
   into visible from jsonb_array_elements(visible) with ordinality item(value,ordinality);
   select exists(select 1 from jsonb_array_elements(visible) item where (item->>'score')::numeric>0) into has_votes;
   result:=result || jsonb_build_object('no_winner',(result->>'no_winner')::boolean or not has_votes,'moderation_no_winner',total>eligible and not has_votes);
 end if;
 return result || jsonb_build_object('entries',visible,'entryCount',eligible,'submittedCount',eligible,
   'moderation_notice',total>eligible,
   'my_entry_exists',exists(select 1 from public.pixel_entries where event_id=p_event and artist_id=auth.uid()),
   'my_entry_hidden',exists(select 1 from public.pixel_entries where event_id=p_event and artist_id=auth.uid() and moderation_hidden_at is not null));
end;
$$;
alter function public.pixel_public_challenges() rename to pixel_public_challenges_v1;
revoke all on function public.pixel_public_challenges_v1() from public,anon,authenticated;
create function public.pixel_public_challenges() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 select coalesce(jsonb_agg(item.value || jsonb_build_object('entry_count',public.pixel_eligible_entry_count((item.value->>'id')::uuid)) order by item.ordinality),'[]'::jsonb)
 into result from jsonb_array_elements(public.pixel_public_challenges_v1()) with ordinality item(value,ordinality);
 return result;
end;
$$;
revoke all on function public.pixel_require_moderator(), public.pixel_eligible_entry_count(uuid), public.pixel_ballot_visible_entries() from public,anon,authenticated;
revoke all on function public.pixel_moderation_status(),public.pixel_report_entry(uuid,text,text),public.pixel_moderation_queue(boolean,integer),public.pixel_review_report(uuid,text,text),public.pixel_event_snapshot(uuid),public.pixel_public_challenges() from public,anon,authenticated;
grant execute on function public.pixel_moderation_status(),public.pixel_report_entry(uuid,text,text),public.pixel_moderation_queue(boolean,integer),public.pixel_review_report(uuid,text,text) to authenticated;
grant execute on function public.pixel_event_snapshot(uuid),public.pixel_public_challenges() to anon,authenticated;
commit;
