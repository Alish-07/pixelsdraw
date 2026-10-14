begin;

alter table public.pixel_events drop constraint if exists pixel_events_phase_check;
alter table public.pixel_events
  add constraint pixel_events_phase_check
    check (phase in ('lobby', 'submissions', 'voting', 'results')),
  add column submission_duration_minutes integer
    check (submission_duration_minutes between 1 and 1440);

create or replace function public.pixel_create_event_v2(
  p_title text,
  p_theme text,
  p_size integer,
  p_show_gallery boolean default false,
  p_duration_minutes integer default null,
  p_host_vote_percent integer default 0
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  user_id uuid := public.pixel_verified_user();
  event_id uuid;
begin
  if p_duration_minutes is not null and p_duration_minutes not between 1 and 1440 then
    raise exception 'Timer must be between 1 minute and 24 hours.';
  end if;
  if p_host_vote_percent not between 0 and 100 then
    raise exception 'Host vote percentage must be from 0 to 100.';
  end if;
  insert into public.pixel_events(
    host_id, title, theme, size, phase, join_code, show_gallery,
    submission_duration_minutes, submission_deadline, host_vote_percent
  ) values (
    user_id, btrim(p_title), btrim(p_theme), p_size, 'lobby',
    public.pixel_new_join_code(), coalesce(p_show_gallery, false),
    p_duration_minutes, null, p_host_vote_percent
  ) returning id into event_id;
  return event_id;
end;
$$;

create or replace function public.pixel_event_by_code(p_code text)
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.pixel_events
  where join_code = pg_catalog.regexp_replace(p_code, '[^0-9]', '', 'g')
    and phase in ('lobby', 'submissions')
  limit 1;
$$;

create or replace function public.pixel_join_event(p_event uuid, p_nickname text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  participant_id uuid := public.pixel_participant_user();
  competition public.pixel_events;
begin
  select * into competition from public.pixel_events where id = p_event;
  if not found then raise exception 'Competition not found.'; end if;
  if competition.phase not in ('lobby', 'submissions') and not exists (
    select 1 from public.pixel_participants
    where event_id = p_event and user_id = participant_id
  ) then raise exception 'This competition is no longer accepting participants.'; end if;
  if length(btrim(p_nickname)) not between 1 and 60 then
    raise exception 'Choose a nickname.';
  end if;
  insert into public.pixel_participants(event_id, user_id, nickname)
    values (p_event, participant_id, btrim(p_nickname))
  on conflict (event_id, user_id) do update
    set nickname = excluded.nickname, last_seen = now();
end;
$$;

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

create or replace function public.pixel_advance_event(p_event uuid, p_next_phase text)
returns void language plpgsql security definer set search_path = '' as $$
declare user_id uuid := public.pixel_verified_user(); competition public.pixel_events;
begin
  select * into competition from public.pixel_events where id = p_event for update;
  if not found then raise exception 'Competition not found.'; end if;
  if competition.host_id <> user_id then raise exception 'Only the host can change this competition.'; end if;
  if competition.phase = 'lobby' and p_next_phase = 'submissions' then
    if not exists (select 1 from public.pixel_participants where event_id = p_event)
      then raise exception 'Wait for at least one participant to join.'; end if;
    update public.pixel_events set
      phase = 'submissions',
      submission_deadline = case when submission_duration_minutes is null then null
        else now() + make_interval(mins => submission_duration_minutes) end,
      phase_changed_at = now()
    where id = p_event;
    return;
  elsif competition.phase = 'submissions' and p_next_phase = 'voting' then
    if (select count(*) from public.pixel_entries where event_id = p_event) < 2
      then raise exception 'At least two entries are required.'; end if;
  elsif competition.phase = 'voting' and p_next_phase = 'results' then
    if not exists (select 1 from public.pixel_ballots where event_id = p_event)
      then raise exception 'At least one ballot is required.'; end if;
    if competition.host_vote_percent > 0 and not exists (
      select 1 from public.pixel_ballots where event_id = p_event and voter_id = competition.host_id
    ) then raise exception 'The host must vote before results can be finalized.'; end if;
    if competition.host_vote_percent < 100 and not exists (
      select 1 from public.pixel_ballots where event_id = p_event and voter_id <> competition.host_id
    ) then raise exception 'At least one participant ballot is required.'; end if;
  else
    raise exception 'Invalid phase change.';
  end if;
  update public.pixel_events set phase = p_next_phase, phase_changed_at = now() where id = p_event;
end;
$$;

create or replace function public.pixel_event_snapshot(p_event uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  viewer_id uuid := auth.uid();
  competition public.pixel_events;
  result jsonb;
begin
  select * into competition from public.pixel_events where id = p_event for update;
  if not found then return null; end if;
  if competition.phase = 'submissions' and competition.submission_deadline is not null
    and competition.submission_deadline <= now() then
    update public.pixel_events set
      phase = case when (select count(*) from public.pixel_entries where event_id = p_event) >= 2
        then 'voting' else 'results' end,
      phase_changed_at = now()
    where id = p_event returning * into competition;
  end if;

  select jsonb_build_object(
    'id', e.id, 'host_id', e.host_id, 'title', e.title, 'theme', e.theme,
    'size', e.size, 'phase', e.phase, 'join_code', e.join_code,
    'show_gallery', e.show_gallery,
    'submission_duration_minutes', e.submission_duration_minutes,
    'submission_deadline', e.submission_deadline,
    'host_vote_percent', e.host_vote_percent,
    'entryCount', (select count(*) from public.pixel_entries a where a.event_id = e.id),
    'participantCount', (select count(*) from public.pixel_participants p where p.event_id = e.id),
    'activeCount', (select count(*) from public.pixel_participants p
      where p.event_id = e.id and p.last_seen > now() - interval '35 seconds'),
    'drawingCount', (select count(*) from public.pixel_participants p
      where p.event_id = e.id and p.status = 'drawing' and p.last_seen > now() - interval '35 seconds'),
    'submittedCount', (select count(*) from public.pixel_entries a where a.event_id = e.id),
    'ballotCount', (select count(*) from public.pixel_ballots b where b.event_id = e.id),
    'hostBallotCount', (select count(*) from public.pixel_ballots b where b.event_id = e.id and b.voter_id = e.host_id),
    'communityBallotCount', (select count(*) from public.pixel_ballots b where b.event_id = e.id and b.voter_id <> e.host_id),
    'participants', coalesce((select jsonb_agg(jsonb_build_object(
      'nickname', p.nickname,
      'status', case when e.host_id = viewer_id then p.status else null end,
      'isActive', p.last_seen > now() - interval '35 seconds'
    ) order by p.joined_at) from public.pixel_participants p where p.event_id = e.id), '[]'::jsonb),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'artist_id', a.artist_id, 'artist', a.artist,
        'title', a.title, 'pixels', a.pixels,
        'score', case when e.phase = 'results' then coalesce((
          select round(sum(case
            when b.voter_id = e.host_id then (4 - choice.ordinality) * e.host_vote_percent / 3.0
            else (4 - choice.ordinality) * (100 - e.host_vote_percent) /
              (3.0 * greatest((select count(*) from public.pixel_ballots cb
                where cb.event_id = e.id and cb.voter_id <> e.host_id), 1))
          end), 2)
          from public.pixel_ballots b,
            unnest(b.choices) with ordinality as choice(id, ordinality)
          where b.event_id = e.id and choice.id = a.id
        ), 0) else null end
      ) order by a.created_at, a.id)
      from public.pixel_entries a
      where a.event_id = e.id and (
        e.host_id = viewer_id or e.phase not in ('lobby', 'submissions') or
        e.show_gallery or a.artist_id = viewer_id
      )
    ), '[]'::jsonb)
  ) into result from public.pixel_events e where e.id = p_event;
  return result;
end;
$$;

commit;
