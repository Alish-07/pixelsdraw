begin;
alter table public.pixel_events
  add column show_roster boolean not null default true,
  add column admission_mode text not null default 'auto' check (admission_mode in ('auto', 'approval', 'closed')),
  add column allow_late_join boolean not null default true,
  add column scheduled_start_at timestamptz;
alter table public.pixel_participants
  add column admission_status text not null default 'admitted' check (admission_status in ('admitted', 'pending', 'rejected')),
  add column is_present boolean not null default true;

-- Resolve pre-existing duplicate display names without deleting identities/art.
alter table public.pixel_participants disable trigger pixel_participant_not_deleted;
do $$
declare player record; candidate text; suffix integer;
begin
  for player in select * from public.pixel_participants order by event_id, joined_at, user_id loop
    candidate := regexp_replace(btrim(player.nickname), '\s+', ' ', 'g'); suffix := 1;
    while exists(select 1 from public.pixel_participants p where p.event_id = player.event_id and p.user_id <> player.user_id and lower(regexp_replace(btrim(p.nickname), '\s+', ' ', 'g')) = lower(candidate)) loop
      suffix := suffix + 1; candidate := left(regexp_replace(btrim(player.nickname), '\s+', ' ', 'g'), 52) || ' ' || suffix;
    end loop;
    update public.pixel_participants set nickname = candidate where event_id = player.event_id and user_id = player.user_id;
  end loop;
end;
$$;
alter table public.pixel_participants enable trigger pixel_participant_not_deleted;
create unique index pixel_room_unique_nickname on public.pixel_participants(event_id, lower(nickname));
update public.pixel_entries a set artist = p.nickname from public.pixel_participants p where p.event_id = a.event_id and p.user_id = a.artist_id and a.artist is distinct from p.nickname;

create function public.pixel_join_event_v2(p_event uuid, p_nickname text, p_suggested boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare viewer uuid := public.pixel_participant_user(); e public.pixel_events; player public.pixel_participants; chosen text; base text; suffix integer := 1;
begin
  select * into e from public.pixel_events where id = p_event for update;
  if not found or e.deleted_at is not null then raise exception 'Competition not found or deleted.'; end if;
  perform public.pixel_tick_scheduled_start(p_event);
  select * into e from public.pixel_events where id = p_event;
  select * into player from public.pixel_participants where event_id = p_event and user_id = viewer;
  if found then
    update public.pixel_participants set last_seen = now(), is_present = true where event_id = p_event and user_id = viewer;
    return jsonb_build_object('nickname', player.nickname, 'admission', player.admission_status);
  end if;
  if e.phase not in ('lobby', 'submissions') or e.admission_mode = 'closed' or (e.phase = 'submissions' and not e.allow_late_join) or e.submission_deadline <= now() then raise exception 'The host is not accepting new players right now.'; end if;
  base := regexp_replace(btrim(coalesce(p_nickname, '')), '\s+', ' ', 'g');
  if length(base) not between 1 and 60 then raise exception 'Choose a nickname, up to 60 characters.'; end if;
  chosen := base;
  while exists(select 1 from public.pixel_participants where event_id = p_event and lower(nickname) = lower(chosen)) loop
    if not coalesce(p_suggested, false) then raise exception 'That nickname is already taken in this room. Choose another or use a suggestion.'; end if;
    suffix := suffix + 1; chosen := left(base, 52) || ' ' || suffix;
  end loop;
  if (select count(*) from public.pixel_participants where event_id = p_event) >= 500 then raise exception 'This room has reached its 500-player limit.'; end if;
  insert into public.pixel_participants(event_id, user_id, nickname, admission_status)
    values(p_event, viewer, chosen, case when e.admission_mode = 'approval' then 'pending' else 'admitted' end) returning * into player;
  return jsonb_build_object('nickname', player.nickname, 'admission', player.admission_status);
end;
$$;
create or replace function public.pixel_join_event(p_event uuid, p_nickname text) returns void language plpgsql security definer set search_path = '' as $$
begin perform public.pixel_join_event_v2(p_event, p_nickname, false); end;
$$;

create function public.pixel_set_room_controls(p_event uuid, p_admission_mode text, p_allow_late_join boolean, p_show_roster boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare viewer uuid := public.pixel_verified_user(); e public.pixel_events;
begin
  select * into e from public.pixel_events where id = p_event for update;
  if not found or e.deleted_at is not null or e.host_id <> viewer then raise exception 'Only the host can change this room.'; end if;
  if p_admission_mode is null or p_admission_mode not in ('auto', 'approval', 'closed') then raise exception 'Invalid admission setting.'; end if;
  update public.pixel_events set admission_mode = p_admission_mode, allow_late_join = coalesce(p_allow_late_join, false), show_roster = coalesce(p_show_roster, false) where id = p_event;
  -- Switching to auto does not silently approve the existing queue.
end;
$$;
create function public.pixel_admit_player(p_event uuid, p_player uuid, p_admit boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare viewer uuid := public.pixel_verified_user(); e public.pixel_events;
begin
  select * into e from public.pixel_events where id = p_event for update;
  if not found or e.deleted_at is not null or e.host_id <> viewer then raise exception 'Only the host can approve players.'; end if;
  perform public.pixel_tick_scheduled_start(p_event);
  select * into e from public.pixel_events where id = p_event;
  if p_admit and (e.phase not in ('lobby', 'submissions') or e.admission_mode = 'closed' or (e.phase = 'submissions' and not e.allow_late_join) or e.submission_deadline <= now()) then raise exception 'New admissions are stopped. Change the dashboard setting to admit this player.'; end if;
  update public.pixel_participants set admission_status = case when p_admit then 'admitted' else 'rejected' end where event_id = p_event and user_id = p_player and admission_status = 'pending';
  if not found then raise exception 'This player is no longer waiting for approval.'; end if;
end;
$$;

create function public.pixel_create_event_v4(p_title text, p_theme text, p_size integer, p_rules jsonb, p_animation text, p_show_points boolean, p_show_gallery boolean, p_duration_seconds integer, p_host_vote_percent integer, p_show_roster boolean, p_admission_mode text, p_allow_late_join boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare room_id uuid;
begin
  room_id := public.pixel_create_event_v3(p_title, p_theme, p_size, p_rules, p_animation, p_show_points, p_show_gallery, p_duration_seconds, p_host_vote_percent);
  perform public.pixel_set_room_controls(room_id, p_admission_mode, p_allow_late_join, p_show_roster); return room_id;
end;
$$;
create function public.pixel_update_event_settings_v4(p_event uuid, p_size integer, p_rules jsonb, p_animation text, p_show_points boolean, p_show_gallery boolean, p_duration_seconds integer, p_host_vote_percent integer, p_show_roster boolean, p_admission_mode text, p_allow_late_join boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.pixel_update_event_settings_v3(p_event, p_size, p_rules, p_animation, p_show_points, p_show_gallery, p_duration_seconds, p_host_vote_percent);
  perform public.pixel_set_room_controls(p_event, p_admission_mode, p_allow_late_join, p_show_roster);
end;
$$;

-- Membership enforcement also protects legacy submission/voting clients.
create function public.pixel_require_admitted_player() returns trigger language plpgsql security definer set search_path = '' as $$
declare viewer uuid; e public.pixel_events; chosen text;
begin
  if tg_table_name = 'pixel_entries' then viewer := new.artist_id; else viewer := new.voter_id; end if;
  select * into e from public.pixel_events where id = new.event_id for update;
  if tg_table_name = 'pixel_ballots' and e.host_id = viewer then return new; end if;
  select nickname into chosen from public.pixel_participants where event_id = new.event_id and user_id = viewer and admission_status = 'admitted';
  if not found then raise exception 'Wait for the host to admit you before drawing, submitting or voting.'; end if;
  if tg_table_name = 'pixel_entries' then new.artist := chosen; new.title := coalesce(nullif(btrim(new.title), ''), 'Untitled'); end if;
  return new;
end;
$$;
create trigger pixel_admitted_entry before insert on public.pixel_entries for each row execute function public.pixel_require_admitted_player();
create trigger pixel_admitted_ballot before insert or update on public.pixel_ballots for each row execute function public.pixel_require_admitted_player();
alter function public.pixel_submit_entry_v2(uuid, text, text, integer, jsonb, integer) rename to pixel_submit_entry_v2_core;
revoke all on function public.pixel_submit_entry_v2_core(uuid, text, text, integer, jsonb, integer) from public, anon, authenticated;
create function public.pixel_submit_entry_v2(p_event uuid, p_artist text, p_title text, p_size integer, p_frames jsonb, p_fps integer) returns uuid language plpgsql security definer set search_path = '' as $$
begin return public.pixel_submit_entry_v2_core(p_event, p_artist, coalesce(nullif(btrim(p_title), ''), 'Untitled'), p_size, p_frames, p_fps); end;
$$;

create function public.pixel_heartbeat_v2(p_event uuid, p_status text, p_present boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare viewer uuid := public.pixel_participant_user();
begin
  if p_status is null or p_status not in ('joined', 'drawing', 'submitted', 'voting') then raise exception 'Invalid player status.'; end if;
  update public.pixel_participants set status = p_status, is_present = coalesce(p_present, false), last_seen = now() where event_id = p_event and user_id = viewer;
  if not found then raise exception 'Join the room before updating your presence.'; end if;
end;
$$;
create or replace function public.pixel_participant_heartbeat(p_event uuid, p_status text) returns void language plpgsql security definer set search_path = '' as $$
begin perform public.pixel_heartbeat_v2(p_event, p_status, true); end;
$$;

create function public.pixel_schedule_start(p_event uuid, p_seconds integer)
returns void language plpgsql security definer set search_path = '' as $$
declare viewer uuid := public.pixel_verified_user(); e public.pixel_events;
begin
  select * into e from public.pixel_events where id = p_event for update;
  if not found or e.deleted_at is not null or e.host_id <> viewer then raise exception 'Only the host can schedule drawing.'; end if;
  if e.phase <> 'lobby' then raise exception 'Drawing has already started.'; end if;
  if e.scheduled_start_at <= now() then raise exception 'The scheduled start has already arrived. Refresh to see the drawing phase.'; end if;
  if p_seconds is null or p_seconds not between 0 and 86400 then raise exception 'Choose a countdown from 00:01 to 1440:00, or cancel.'; end if;
  if p_seconds > 0 and not exists(select 1 from public.pixel_participants where event_id = p_event and admission_status = 'admitted') then raise exception 'Admit at least one player before scheduling a start.'; end if;
  update public.pixel_events set scheduled_start_at = case when p_seconds = 0 then null else now() + make_interval(secs => p_seconds) end where id = p_event;
end;
$$;
create function public.pixel_tick_scheduled_start(p_event uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.pixel_events set phase = 'submissions', phase_changed_at = now(), scheduled_start_at = null
    where id = p_event and deleted_at is null and phase = 'lobby' and scheduled_start_at <= now();
end;
$$;
create or replace function public.pixel_exact_timer() returns trigger language plpgsql set search_path = '' as $$
declare starts_at timestamptz;
begin
  if old.deleted_at is not null and new.phase is distinct from old.phase then raise exception 'This competition was deleted.'; end if;
  if old.phase = 'submissions' and old.submission_deadline <= now() and new.phase = 'submissions' and new.submission_deadline is distinct from old.submission_deadline then raise exception 'The drawing timer has finished.'; end if;
  if old.phase = 'lobby' and new.phase = 'submissions' then
    starts_at := case when old.scheduled_start_at <= now() then old.scheduled_start_at else now() end;
    new.submission_deadline := case when coalesce(new.submission_duration_seconds, new.submission_duration_minutes * 60) is null then null else starts_at + make_interval(secs => coalesce(new.submission_duration_seconds, new.submission_duration_minutes * 60)) end;
  end if;
  return new;
end;
$$;
alter function public.pixel_advance_event(uuid, text) rename to pixel_advance_event_core;
revoke all on function public.pixel_advance_event_core(uuid, text) from public, anon, authenticated;
create function public.pixel_advance_event(p_event uuid, p_next_phase text) returns void language plpgsql security definer set search_path = '' as $$
declare viewer uuid := public.pixel_verified_user(); e public.pixel_events;
begin
  select * into e from public.pixel_events where id = p_event for update;
  if not found or e.host_id <> viewer or e.deleted_at is not null then raise exception 'Only the host can advance this competition.'; end if;
  if e.phase = 'lobby' and p_next_phase = 'submissions' and not exists(select 1 from public.pixel_participants where event_id = p_event and admission_status = 'admitted') then raise exception 'Admit at least one player before starting.'; end if;
  perform public.pixel_advance_event_core(p_event, p_next_phase);
  update public.pixel_events set scheduled_start_at = null where id = p_event;
end;
$$;

alter function public.pixel_event_snapshot(uuid) rename to pixel_event_snapshot_v3;
revoke all on function public.pixel_event_snapshot_v3(uuid) from public, anon, authenticated;
create function public.pixel_event_snapshot(p_event uuid) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare result jsonb; e public.pixel_events; viewer uuid := auth.uid(); players jsonb; queued jsonb; own public.pixel_participants;
begin
  select * into e from public.pixel_events where id = p_event for update;
  if not found or e.deleted_at is not null then return null; end if;
  perform public.pixel_tick_scheduled_start(p_event);
  select * into e from public.pixel_events where id = p_event;
  result := public.pixel_event_snapshot_v3(p_event);
  select * into own from public.pixel_participants where event_id = p_event and user_id = viewer;
  select coalesce(jsonb_agg(jsonb_build_object('nickname', p.nickname, 'status', case when e.host_id = viewer then p.status else null end, 'isActive', p.is_present and p.last_seen > now() - interval '90 seconds') order by p.joined_at), '[]'::jsonb) into players from public.pixel_participants p where event_id = p_event and admission_status = 'admitted' and (e.host_id = viewer or e.show_roster);
  select coalesce(jsonb_agg(jsonb_build_object('id', p.user_id, 'nickname', p.nickname) order by p.joined_at), '[]'::jsonb) into queued from public.pixel_participants p where event_id = p_event and admission_status = 'pending' and e.host_id = viewer;
  return result || jsonb_build_object('participants', players, 'pendingPlayers', queued, 'show_roster', e.show_roster, 'admission_mode', e.admission_mode, 'allow_late_join', e.allow_late_join, 'scheduled_start_at', e.scheduled_start_at, 'my_admission', own.admission_status, 'my_nickname', own.nickname,
    'participantCount', (select count(*) from public.pixel_participants where event_id = p_event and admission_status = 'admitted'),
    'activeCount', (select count(*) from public.pixel_participants where event_id = p_event and admission_status = 'admitted' and is_present and last_seen > now() - interval '90 seconds'),
    'drawingCount', (select count(*) from public.pixel_participants where event_id = p_event and admission_status = 'admitted' and is_present and status = 'drawing' and last_seen > now() - interval '90 seconds'));
end;
$$;
alter function public.pixel_host_events() rename to pixel_host_events_core;
revoke all on function public.pixel_host_events_core() from public, anon, authenticated;
create function public.pixel_host_events() returns jsonb language plpgsql security definer set search_path = '' as $$
declare viewer uuid := public.pixel_verified_user(); room record;
begin
  for room in select id from public.pixel_events where host_id = viewer and deleted_at is null and phase = 'lobby' and scheduled_start_at <= now() for update loop perform public.pixel_tick_scheduled_start(room.id); end loop;
  return public.pixel_host_events_core();
end;
$$;

revoke all on function public.pixel_require_admitted_player(), public.pixel_tick_scheduled_start(uuid) from public, anon, authenticated;
revoke all on function public.pixel_join_event_v2(uuid, text, boolean), public.pixel_set_room_controls(uuid, text, boolean, boolean), public.pixel_admit_player(uuid, uuid, boolean), public.pixel_create_event_v4(text, text, integer, jsonb, text, boolean, boolean, integer, integer, boolean, text, boolean), public.pixel_update_event_settings_v4(uuid, integer, jsonb, text, boolean, boolean, integer, integer, boolean, text, boolean), public.pixel_submit_entry_v2(uuid, text, text, integer, jsonb, integer), public.pixel_heartbeat_v2(uuid, text, boolean), public.pixel_schedule_start(uuid, integer), public.pixel_advance_event(uuid, text), public.pixel_event_snapshot(uuid), public.pixel_host_events() from public, anon, authenticated;
grant execute on function public.pixel_join_event_v2(uuid, text, boolean), public.pixel_set_room_controls(uuid, text, boolean, boolean), public.pixel_admit_player(uuid, uuid, boolean), public.pixel_create_event_v4(text, text, integer, jsonb, text, boolean, boolean, integer, integer, boolean, text, boolean), public.pixel_update_event_settings_v4(uuid, integer, jsonb, text, boolean, boolean, integer, integer, boolean, text, boolean), public.pixel_submit_entry_v2(uuid, text, text, integer, jsonb, integer), public.pixel_heartbeat_v2(uuid, text, boolean), public.pixel_schedule_start(uuid, integer), public.pixel_advance_event(uuid, text), public.pixel_host_events() to authenticated;
grant execute on function public.pixel_event_snapshot(uuid) to anon, authenticated;
commit;
