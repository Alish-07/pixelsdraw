begin;

alter table public.pixel_events drop constraint if exists pixel_events_size_check;
alter table public.pixel_events add constraint pixel_events_size_check check (size between 1 and 1024);
alter table public.pixel_events
  add column canvas_rules jsonb,
  add column animation_mode text not null default 'disabled' check (animation_mode in ('disabled', 'optional', 'required')),
  add column show_points boolean not null default true,
  add column submission_duration_seconds integer check (submission_duration_seconds between 1 and 86400),
  add column deleted_at timestamptz;
update public.pixel_events set canvas_rules = jsonb_build_object('mode', 'fixed', 'sizes', jsonb_build_array(size), 'min', 1, 'max', 1024),
  submission_duration_seconds = submission_duration_minutes * 60;
alter table public.pixel_entries add column width integer, add column frames jsonb, add column fps integer not null default 6;
update public.pixel_entries a set width = e.size from public.pixel_events e where a.event_id = e.id;

-- Keep older clients safe too: settings cannot bypass these entry checks.
create function public.pixel_check_entry_rules() returns trigger language plpgsql security definer set search_path = '' as $$
declare e public.pixel_events; f jsonb; amount integer; frame_count integer;
begin
  select * into e from public.pixel_events where id = new.event_id for update;
  if e.deleted_at is not null or e.phase <> 'submissions' or e.submission_deadline <= now() then raise exception 'Submissions are closed.'; end if;
  if not exists (select 1 from public.pixel_participants where event_id = e.id and user_id = new.artist_id) then raise exception 'Join this room first.'; end if;
  new.width := coalesce(new.width, e.size);
  if new.width not between 1 and 1024 then raise exception 'Invalid canvas size.'; end if;
  if coalesce(e.canvas_rules->>'mode', 'fixed') = 'range' then
    if new.width < (e.canvas_rules->>'min')::integer or new.width > (e.canvas_rules->>'max')::integer then raise exception 'Canvas is outside the allowed range.'; end if;
  elsif not coalesce(e.canvas_rules->'sizes', jsonb_build_array(e.size)) @> jsonb_build_array(new.width) then raise exception 'Canvas size is not allowed.';
  end if;
  new.frames := coalesce(new.frames, jsonb_build_array(to_jsonb(new.pixels)));
  if jsonb_typeof(new.frames) <> 'array' then raise exception 'Invalid frames.'; end if;
  frame_count := jsonb_array_length(new.frames);
  if frame_count not between 1 and 32 or frame_count * new.width * new.width > 4194304 then raise exception 'Too many submitted pixels or frames.'; end if;
  if (e.animation_mode = 'required' and frame_count < 2) or (e.animation_mode = 'disabled' and frame_count <> 1) then raise exception 'Animation does not match the room rules.'; end if;
  if new.fps not between 1 and 24 then raise exception 'FPS must be from 1 to 24.'; end if;
  amount := 0;
  for f in select value from jsonb_array_elements(new.frames) loop
    if jsonb_typeof(f) <> 'array' then raise exception 'Invalid frame.'; end if;
    if jsonb_array_length(f) <> new.width * new.width or exists (
      select 1 from jsonb_array_elements(f) c where jsonb_typeof(c) <> 'string' or (c #>> '{}') !~* '^#[0-9a-f]{6}$'
    ) then raise exception 'Invalid frame pixels.'; end if;
    if exists (select 1 from jsonb_array_elements_text(f) c where lower(c) <> '#ffffff') then amount := amount + 1; end if;
  end loop;
  if amount = 0 then raise exception 'Draw something before submitting.'; end if;
  return new;
end;
$$;
create trigger pixel_entry_rules before insert on public.pixel_entries for each row execute function public.pixel_check_entry_rules();

create function public.pixel_validate_canvas_rules(p_rules jsonb, p_size integer) returns void language plpgsql set search_path = '' as $$
declare mode text := p_rules->>'mode'; minimum integer; maximum integer;
begin
  if mode is null or mode not in ('fixed', 'list', 'range') or p_size is null or p_size not between 1 and 1024 then raise exception 'Invalid canvas rules.'; end if;
  if mode = 'range' then
    minimum := (p_rules->>'min')::integer; maximum := (p_rules->>'max')::integer;
    if minimum is null or maximum is null or minimum < 1 or maximum > 1024 or minimum > maximum or p_size <> minimum then raise exception 'Invalid canvas range.'; end if;
  else
    if jsonb_typeof(p_rules->'sizes') is distinct from 'array' then raise exception 'Choose allowed sizes.'; end if;
    if jsonb_array_length(p_rules->'sizes') not between 1 and 64 or (mode = 'fixed' and jsonb_array_length(p_rules->'sizes') <> 1) or
      exists (select 1 from jsonb_array_elements_text(p_rules->'sizes') v where v !~ '^[0-9]+$' or length(v) > 4) then raise exception 'Invalid allowed sizes.'; end if;
    if exists (select 1 from jsonb_array_elements_text(p_rules->'sizes') v where v::integer not between 1 and 1024) or not (p_rules->'sizes' @> jsonb_build_array(p_size)) then raise exception 'Invalid allowed sizes.'; end if;
  end if;
end;
$$;

-- Older clients update the same exact-second duration when using minute presets.
create or replace function public.pixel_update_event_settings(
  p_event uuid,
  p_show_gallery boolean,
  p_duration_minutes integer,
  p_host_vote_percent integer
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  user_id uuid := public.pixel_verified_user();
  competition public.pixel_events;
begin
  select * into competition from public.pixel_events where id = p_event for update;
  if not found then raise exception 'Competition not found.'; end if;
  if competition.host_id <> user_id then raise exception 'Only the host can change this competition.'; end if;
  if competition.phase not in ('lobby', 'submissions') then
    raise exception 'Room settings are locked after voting starts.';
  end if;
  if p_duration_minutes is not null and p_duration_minutes not between 0 and 1440 then
    raise exception 'Timer must be between 1 minute and 24 hours, or off.';
  end if;
  if p_host_vote_percent not between 0 and 100 then
    raise exception 'Host vote percentage must be from 0 to 100.';
  end if;
  update public.pixel_events set
    show_gallery = coalesce(p_show_gallery, false),
    submission_duration_seconds = case
      when p_duration_minutes is null then submission_duration_seconds
      when p_duration_minutes = 0 then null
      else p_duration_minutes * 60
    end,
    submission_duration_minutes = case
      when p_duration_minutes is null then submission_duration_minutes
      when p_duration_minutes = 0 then null
      else p_duration_minutes
    end,
    submission_deadline = case
      when phase = 'lobby' then null
      when p_duration_minutes is null then submission_deadline
      when p_duration_minutes = 0 then null
      else now() + make_interval(mins => p_duration_minutes)
    end,
    host_vote_percent = p_host_vote_percent
  where id = p_event;
end;
$$;

create function public.pixel_create_event_v3(p_title text, p_theme text, p_size integer, p_rules jsonb, p_animation text, p_show_points boolean, p_show_gallery boolean, p_duration_seconds integer, p_host_vote_percent integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare created_id uuid;
begin
  perform public.pixel_validate_canvas_rules(p_rules, p_size);
  if p_duration_seconds is null or p_duration_seconds not between 0 and 86400 or p_animation is null or p_animation not in ('disabled', 'optional', 'required') then raise exception 'Invalid timer or animation rules.'; end if;
  created_id := public.pixel_create_event_v2(p_title, p_theme, p_size, p_show_gallery, null, p_host_vote_percent);
  update public.pixel_events set canvas_rules = p_rules, animation_mode = p_animation, show_points = coalesce(p_show_points, true), submission_duration_seconds = nullif(p_duration_seconds, 0) where pixel_events.id = created_id;
  return created_id;
end;
$$;

create function public.pixel_update_event_settings_v3(p_event uuid, p_size integer, p_rules jsonb, p_animation text, p_show_points boolean, p_show_gallery boolean, p_duration_seconds integer, p_host_vote_percent integer)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.pixel_events; viewer uuid := public.pixel_verified_user();
begin
  select * into e from public.pixel_events where id = p_event for update;
  if not found or e.deleted_at is not null then raise exception 'Competition not found.'; end if;
  if e.host_id <> viewer then raise exception 'Only the host can change this room.'; end if;
  if e.phase = 'submissions' and e.submission_deadline <= now() then raise exception 'The drawing timer has finished. Refresh to see the next phase.'; end if;
  perform public.pixel_validate_canvas_rules(p_rules, p_size);
  if p_animation is null or p_animation not in ('disabled', 'optional', 'required') or (p_duration_seconds is not null and p_duration_seconds not between 0 and 86400) then raise exception 'Invalid animation or timer.'; end if;
  if e.phase <> 'lobby' and (p_rules is distinct from coalesce(e.canvas_rules, jsonb_build_object('mode', 'fixed', 'sizes', jsonb_build_array(e.size), 'min', 1, 'max', 1024)) or p_animation is distinct from e.animation_mode or p_size is distinct from e.size) then raise exception 'Canvas and animation rules lock when drawing starts.'; end if;
  perform public.pixel_update_event_settings(p_event, p_show_gallery, null, p_host_vote_percent);
  update public.pixel_events set size = p_size, canvas_rules = p_rules, animation_mode = p_animation, show_points = coalesce(p_show_points, true),
    submission_duration_seconds = case when p_duration_seconds is null then submission_duration_seconds else nullif(p_duration_seconds, 0) end,
    submission_duration_minutes = case when p_duration_seconds is null then submission_duration_minutes else null end,
    submission_deadline = case when phase = 'lobby' then null when p_duration_seconds is null then submission_deadline when p_duration_seconds = 0 then null else now() + make_interval(secs => p_duration_seconds) end
  where id = p_event;
end;
$$;

-- The existing phase RPC remains compatible, but starts the exact-second timer.
create function public.pixel_exact_timer() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.deleted_at is not null and (new.phase is distinct from old.phase) then raise exception 'This competition was deleted.'; end if;
  if old.phase = 'submissions' and old.submission_deadline <= now() and new.phase = 'submissions' and new.submission_deadline is distinct from old.submission_deadline then raise exception 'The drawing timer has finished.'; end if;
  if old.phase = 'lobby' and new.phase = 'submissions' then
    new.submission_deadline := case when coalesce(new.submission_duration_seconds, new.submission_duration_minutes * 60) is null then null else now() + make_interval(secs => coalesce(new.submission_duration_seconds, new.submission_duration_minutes * 60)) end;
  end if;
  return new;
end;
$$;
create trigger pixel_exact_timer before update on public.pixel_events for each row execute function public.pixel_exact_timer();

create function public.pixel_submit_entry_v2(p_event uuid, p_artist text, p_title text, p_size integer, p_frames jsonb, p_fps integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare viewer uuid := public.pixel_participant_user(); e public.pixel_events; id uuid; first_frame text[];
begin
  select * into e from public.pixel_events where pixel_events.id = p_event for update;
  if not found or e.deleted_at is not null then raise exception 'Competition not found.'; end if;
  if length(btrim(p_artist)) not between 1 and 60 or length(btrim(p_title)) not between 1 and 80 then raise exception 'Enter a nickname and artwork title.'; end if;
  if p_frames is null or jsonb_typeof(p_frames) <> 'array' or jsonb_typeof(p_frames->0) is distinct from 'array' or p_size is null or p_fps is null then raise exception 'Invalid artwork.'; end if;
  if exists (select 1 from public.pixel_entries where event_id = p_event and artist_id = viewer) then raise exception 'You already submitted an entry.'; end if;
  if (select count(*) from public.pixel_entries where event_id = p_event) >= 200 then raise exception 'The 200-entry limit was reached.'; end if;
  select array_agg(value order by ordinality) into first_frame from jsonb_array_elements_text(p_frames->0) with ordinality;
  insert into public.pixel_entries(event_id, artist_id, artist, title, pixels, width, frames, fps) values (p_event, viewer, btrim(p_artist), btrim(p_title), first_frame, p_size, p_frames, p_fps) returning pixel_entries.id into id;
  update public.pixel_participants set status = 'submitted', last_seen = now() where event_id = p_event and user_id = viewer;
  return id;
end;
$$;

-- Preserve proven voting/visibility logic, then enrich and redact its snapshot.
alter function public.pixel_event_snapshot(uuid) rename to pixel_event_snapshot_v2;
revoke all on function public.pixel_event_snapshot_v2(uuid) from public, anon, authenticated;
create function public.pixel_event_snapshot(p_event uuid) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare result jsonb; e public.pixel_events; enriched jsonb;
begin
  select * into e from public.pixel_events where id = p_event for update;
  if not found or e.deleted_at is not null then return null; end if;
  -- Repair a stale waiting-room state left by an older client/timer version.
  if e.phase = 'lobby' and e.submission_deadline <= now() then
    update public.pixel_events set phase = case when (select count(*) from public.pixel_entries where event_id = p_event) >= 2 then 'voting' else 'results' end, phase_changed_at = now() where id = p_event;
  end if;
  result := public.pixel_event_snapshot_v2(p_event);
  select coalesce(jsonb_agg(item.value || jsonb_build_object('width', a.width, 'frames', a.frames, 'fps', a.fps,
    'rank', case when result->>'phase' = 'results' then 1 + (select count(*) from jsonb_array_elements(result->'entries') other where (other->>'score')::numeric > (item.value->>'score')::numeric) else null end,
    'score', case when e.show_points or e.host_id = auth.uid() then item.value->'score' else 'null'::jsonb end) order by item.ordinality), '[]'::jsonb)
  into enriched from jsonb_array_elements(result->'entries') with ordinality item(value, ordinality) join public.pixel_entries a on a.id = (item.value->>'id')::uuid;
  return result || jsonb_build_object('entries', enriched, 'canvas_rules', coalesce(e.canvas_rules, jsonb_build_object('mode', 'fixed', 'sizes', jsonb_build_array(e.size), 'min', 1, 'max', 1024)), 'animation_mode', e.animation_mode, 'show_points', e.show_points, 'submission_duration_seconds', e.submission_duration_seconds,
    'ended_empty', result->>'phase' = 'results' and (result->>'entryCount')::integer = 0);
end;
$$;

create function public.pixel_host_events() returns jsonb language plpgsql security definer set search_path = '' as $$
declare viewer uuid := public.pixel_verified_user(); room record; result jsonb;
begin
  -- Also finish unattended expired rooms when opening the host's history.
  for room in select id from public.pixel_events where host_id = viewer and deleted_at is null and phase in ('lobby', 'submissions') and submission_deadline <= now() for update loop
    update public.pixel_events set phase = case when (select count(*) from public.pixel_entries where event_id = room.id) >= 2 then 'voting' else 'results' end, phase_changed_at = now() where id = room.id;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'theme', e.theme, 'size', e.size, 'phase', e.phase, 'join_code', e.join_code, 'host_id', e.host_id, 'created_at', e.created_at, 'deleted_at', e.deleted_at) order by e.created_at desc), '[]'::jsonb) into result
  from (select * from public.pixel_events where host_id = viewer order by created_at desc limit 200) e;
  return result;
end;
$$;
revoke all on function public.pixel_host_events() from public, anon, authenticated;
grant execute on function public.pixel_host_events() to authenticated;

-- Soft deletion hides the public link/code; the host can restore all artwork.
create function public.pixel_set_event_deleted(p_event uuid, p_deleted boolean) returns void language plpgsql security definer set search_path = '' as $$
declare viewer uuid := public.pixel_verified_user();
begin
  update public.pixel_events set deleted_at = case when p_deleted then now() else null end where id = p_event and host_id = viewer;
  if not found then raise exception 'Only the host can delete or restore this competition.'; end if;
end;
$$;
drop policy "Public events" on public.pixel_events;
create policy "Public events" on public.pixel_events for select to anon, authenticated using (deleted_at is null or host_id = (select auth.uid()));
create or replace function public.pixel_event_by_code(p_code text) returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.pixel_events where join_code = regexp_replace(p_code, '[^0-9]', '', 'g') and deleted_at is null and phase in ('lobby', 'submissions') and (submission_deadline is null or submission_deadline > now()) limit 1;
$$;
create function public.pixel_reject_deleted_activity() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.pixel_events where id = new.event_id and deleted_at is null for update;
  if not found then raise exception 'This competition was deleted.'; end if;
  return new;
end;
$$;
create trigger pixel_participant_not_deleted before insert or update on public.pixel_participants for each row execute function public.pixel_reject_deleted_activity();
create trigger pixel_ballot_not_deleted before insert or update on public.pixel_ballots for each row execute function public.pixel_reject_deleted_activity();

revoke all on function public.pixel_check_entry_rules(), public.pixel_validate_canvas_rules(jsonb, integer), public.pixel_exact_timer(), public.pixel_reject_deleted_activity() from public, anon, authenticated;
revoke all on function public.pixel_create_event_v3(text, text, integer, jsonb, text, boolean, boolean, integer, integer), public.pixel_update_event_settings_v3(uuid, integer, jsonb, text, boolean, boolean, integer, integer), public.pixel_submit_entry_v2(uuid, text, text, integer, jsonb, integer), public.pixel_set_event_deleted(uuid, boolean), public.pixel_event_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.pixel_create_event_v3(text, text, integer, jsonb, text, boolean, boolean, integer, integer), public.pixel_update_event_settings_v3(uuid, integer, jsonb, text, boolean, boolean, integer, integer), public.pixel_submit_entry_v2(uuid, text, text, integer, jsonb, integer), public.pixel_set_event_deleted(uuid, boolean) to authenticated;
grant execute on function public.pixel_event_snapshot(uuid) to anon, authenticated;

commit;
