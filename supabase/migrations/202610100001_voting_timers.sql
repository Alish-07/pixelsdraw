begin;

alter table public.pixel_events
  add column voting_duration_seconds integer not null default 300 check (voting_duration_seconds between 1 and 86400),
  add column voting_deadline timestamptz,
  add column ended_reason text check (ended_reason in ('drawing_insufficient', 'voting_timeout', 'host_closed'));
-- Give already-open votes a full default window; never reopen finished rooms.
update public.pixel_events set voting_deadline = now() + interval '5 minutes'
where phase = 'voting' and deleted_at is null;

create function public.pixel_voting_timer() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.phase = 'voting' and old.phase <> 'voting' then
    new.voting_deadline := coalesce(new.voting_deadline, now() + make_interval(secs => new.voting_duration_seconds));
  end if;
  if new.phase = 'results' and old.phase = 'voting' then
    new.ended_reason := coalesce(new.ended_reason, 'host_closed');
  end if;
  if old.phase in ('voting', 'results') and new.voting_duration_seconds is distinct from old.voting_duration_seconds then
    raise exception 'The voting timer is locked once voting starts.';
  end if;
  if old.phase = 'voting' and new.voting_deadline is distinct from old.voting_deadline then
    raise exception 'An open voting deadline cannot be extended.';
  end if;
  return new;
end;
$$;
create trigger pixel_voting_timer before update on public.pixel_events for each row execute function public.pixel_voting_timer();

-- All paths use the same clock and row lock. Missed polls never extend a round.
create function public.pixel_tick_event_phases(p_event uuid) returns void language plpgsql security definer set search_path = '' as $$
declare e public.pixel_events; enough boolean;
begin
  select * into e from public.pixel_events where id = p_event for update;
  if not found or e.deleted_at is not null then return; end if;
  perform public.pixel_tick_scheduled_start(p_event);
  select * into e from public.pixel_events where id = p_event;
  if e.phase in ('lobby', 'submissions') and e.submission_deadline <= now() then
    enough := (select count(*) from public.pixel_entries where event_id = p_event) >= 2;
    update public.pixel_events set
      phase = case when enough then 'voting' else 'results' end,
      phase_changed_at = e.submission_deadline,
      voting_deadline = case when enough then e.submission_deadline + make_interval(secs => e.voting_duration_seconds) else null end,
      ended_reason = case when enough then null else 'drawing_insufficient' end
    where id = p_event returning * into e;
  end if;
  if e.phase = 'voting' and e.voting_deadline <= now() then
    update public.pixel_events set phase = 'results', phase_changed_at = e.voting_deadline,
      ended_reason = 'voting_timeout' where id = p_event;
  end if;
end;
$$;

-- Called by Supabase Cron, not exposed as a browser RPC. Bounded batches and
-- SKIP LOCKED keep concurrent submissions/host actions from blocking the job.
create function public.pixel_tick_due_events() returns integer language plpgsql security definer set search_path = '' as $$
declare room record; processed integer := 0;
begin
  for room in select id from public.pixel_events where deleted_at is null and
    ((phase = 'lobby' and scheduled_start_at <= now()) or
     (phase in ('lobby', 'submissions') and submission_deadline <= now()) or
     (phase = 'voting' and voting_deadline <= now()))
    order by id limit 200 for update skip locked loop
    perform public.pixel_tick_event_phases(room.id); processed := processed + 1;
  end loop;
  return processed;
end;
$$;
create index pixel_due_voting on public.pixel_events(voting_deadline) where phase = 'voting' and deleted_at is null;

create function public.pixel_ballot_deadline() returns trigger language plpgsql security definer set search_path = '' as $$
declare e public.pixel_events;
begin
  select * into e from public.pixel_events where id = new.event_id for update;
  if e.phase <> 'voting' or e.deleted_at is not null or e.voting_deadline <= now() then
    raise exception 'Voting has closed. Refresh to see the results.';
  end if;
  return new;
end;
$$;
create trigger pixel_ballot_deadline before insert or update on public.pixel_ballots for each row execute function public.pixel_ballot_deadline();

create function public.pixel_create_event_v5(p_title text, p_theme text, p_size integer, p_rules jsonb, p_animation text, p_show_points boolean, p_show_gallery boolean, p_duration_seconds integer, p_host_vote_percent integer, p_show_roster boolean, p_admission_mode text, p_allow_late_join boolean, p_voting_duration_seconds integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare room_id uuid;
begin
  if p_voting_duration_seconds is null or p_voting_duration_seconds not between 1 and 86400 then raise exception 'Choose a voting duration from 00:01 to 1440:00.'; end if;
  room_id := public.pixel_create_event_v4(p_title, p_theme, p_size, p_rules, p_animation, p_show_points, p_show_gallery, p_duration_seconds, p_host_vote_percent, p_show_roster, p_admission_mode, p_allow_late_join);
  update public.pixel_events set voting_duration_seconds = p_voting_duration_seconds where id = room_id;
  return room_id;
end;
$$;
create function public.pixel_update_event_settings_v5(p_event uuid, p_size integer, p_rules jsonb, p_animation text, p_show_points boolean, p_show_gallery boolean, p_duration_seconds integer, p_host_vote_percent integer, p_show_roster boolean, p_admission_mode text, p_allow_late_join boolean, p_voting_duration_seconds integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_voting_duration_seconds is null or p_voting_duration_seconds not between 1 and 86400 then raise exception 'Choose a voting duration from 00:01 to 1440:00.'; end if;
  perform public.pixel_update_event_settings_v4(p_event, p_size, p_rules, p_animation, p_show_points, p_show_gallery, p_duration_seconds, p_host_vote_percent, p_show_roster, p_admission_mode, p_allow_late_join);
  update public.pixel_events set voting_duration_seconds = p_voting_duration_seconds where id = p_event;
end;
$$;

alter function public.pixel_event_snapshot(uuid) rename to pixel_event_snapshot_v4;
revoke all on function public.pixel_event_snapshot_v4(uuid) from public, anon, authenticated;
create function public.pixel_event_snapshot(p_event uuid) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare result jsonb; e public.pixel_events;
begin
  perform public.pixel_tick_event_phases(p_event);
  select * into e from public.pixel_events where id = p_event;
  if not found or e.deleted_at is not null then return null; end if;
  result := public.pixel_event_snapshot_v4(p_event);
  return result || jsonb_build_object('voting_duration_seconds', e.voting_duration_seconds,
    'voting_deadline', e.voting_deadline, 'ended_reason', e.ended_reason,
    'no_winner', coalesce(e.phase = 'results' and (e.ended_reason = 'drawing_insufficient' or
      (e.ended_reason = 'voting_timeout' and (result->>'ballotCount')::integer = 0)), false));
end;
$$;
alter function public.pixel_host_events() rename to pixel_host_events_v4;
revoke all on function public.pixel_host_events_v4() from public, anon, authenticated;
create function public.pixel_host_events() returns jsonb language plpgsql security definer set search_path = '' as $$
declare viewer uuid := public.pixel_verified_user(); room record;
begin
  for room in select id from public.pixel_events where host_id = viewer and deleted_at is null and phase <> 'results' order by id for update loop
    perform public.pixel_tick_event_phases(room.id);
  end loop;
  return public.pixel_host_events_v4();
end;
$$;
create or replace function public.pixel_advance_event(p_event uuid, p_next_phase text) returns void language plpgsql security definer set search_path = '' as $$
declare viewer uuid := public.pixel_verified_user(); e public.pixel_events;
begin
  select * into e from public.pixel_events where id = p_event for update;
  if not found or e.host_id <> viewer or e.deleted_at is not null then raise exception 'Only the host can advance this competition.'; end if;
  perform public.pixel_tick_event_phases(p_event);
  select * into e from public.pixel_events where id = p_event;
  if e.phase = p_next_phase then return; end if;
  if e.phase = 'lobby' and p_next_phase = 'submissions' and not exists(select 1 from public.pixel_participants where event_id = p_event and admission_status = 'admitted') then raise exception 'Admit at least one player before starting.'; end if;
  perform public.pixel_advance_event_core(p_event, p_next_phase);
  update public.pixel_events set scheduled_start_at = null where id = p_event;
end;
$$;

revoke all on function public.pixel_voting_timer(), public.pixel_ballot_deadline(), public.pixel_tick_event_phases(uuid), public.pixel_tick_due_events() from public, anon, authenticated;
revoke all on function public.pixel_create_event_v5(text,text,integer,jsonb,text,boolean,boolean,integer,integer,boolean,text,boolean,integer), public.pixel_update_event_settings_v5(uuid,integer,jsonb,text,boolean,boolean,integer,integer,boolean,text,boolean,integer), public.pixel_event_snapshot(uuid), public.pixel_host_events() from public, anon, authenticated;
grant execute on function public.pixel_create_event_v5(text,text,integer,jsonb,text,boolean,boolean,integer,integer,boolean,text,boolean,integer), public.pixel_update_event_settings_v5(uuid,integer,jsonb,text,boolean,boolean,integer,integer,boolean,text,boolean,integer), public.pixel_host_events() to authenticated;
grant execute on function public.pixel_event_snapshot(uuid) to anon, authenticated;
commit;
