begin;

alter table public.pixel_events
  add column show_gallery boolean not null default false,
  add column submission_deadline timestamptz,
  add column host_vote_percent integer not null default 0
    check (host_vote_percent between 0 and 100),
  add column phase_changed_at timestamptz not null default now();

create table public.pixel_participants (
  event_id uuid not null references public.pixel_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  nickname text not null check (length(btrim(nickname)) between 1 and 60),
  status text not null default 'joined'
    check (status in ('joined', 'drawing', 'submitted', 'voting')),
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (event_id, user_id)
);

create index pixel_participants_event_activity
  on public.pixel_participants(event_id, last_seen desc);

alter table public.pixel_participants enable row level security;
revoke all on public.pixel_participants from public, anon, authenticated;

-- Artwork is returned through pixel_event_snapshot, which can hide unfinished
-- work until the host allows the gallery or submissions close.
drop policy if exists "Public artwork" on public.pixel_entries;
revoke select on public.pixel_entries from anon, authenticated;

create function public.pixel_create_event_v2(
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
  deadline timestamptz;
begin
  if p_duration_minutes is not null and p_duration_minutes not between 1 and 1440 then
    raise exception 'Timer must be between 1 minute and 24 hours.';
  end if;
  if p_host_vote_percent not between 0 and 100 then
    raise exception 'Host vote percentage must be from 0 to 100.';
  end if;
  deadline := case when p_duration_minutes is null then null
    else now() + make_interval(mins => p_duration_minutes) end;
  insert into public.pixel_events(
    host_id, title, theme, size, join_code, show_gallery,
    submission_deadline, host_vote_percent
  ) values (
    user_id, btrim(p_title), btrim(p_theme), p_size,
    public.pixel_new_join_code(), coalesce(p_show_gallery, false),
    deadline, p_host_vote_percent
  ) returning id into event_id;
  return event_id;
end;
$$;

create function public.pixel_join_event(p_event uuid, p_nickname text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  participant_id uuid := public.pixel_participant_user();
begin
  if not exists (select 1 from public.pixel_events where id = p_event) then
    raise exception 'Competition not found.';
  end if;
  if length(btrim(p_nickname)) not between 1 and 60 then
    raise exception 'Choose a nickname.';
  end if;
  insert into public.pixel_participants(event_id, user_id, nickname)
    values (p_event, participant_id, btrim(p_nickname))
  on conflict (event_id, user_id) do update
    set nickname = excluded.nickname, last_seen = now();
end;
$$;

create function public.pixel_participant_heartbeat(p_event uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  participant_id uuid := public.pixel_participant_user();
begin
  if p_status not in ('joined', 'drawing', 'submitted', 'voting') then
    raise exception 'Invalid participant status.';
  end if;
  update public.pixel_participants
    set status = p_status, last_seen = now()
    where event_id = p_event and user_id = participant_id;
end;
$$;

-- Settings remain editable while submissions are open. A duration of zero
-- removes the deadline; a positive duration restarts it from the present.
create function public.pixel_update_event_settings(
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
  if p_duration_minutes is not null and p_duration_minutes not between 0 and 1440 then
    raise exception 'Timer must be between 1 minute and 24 hours, or off.';
  end if;
  if p_host_vote_percent not between 0 and 100 then
    raise exception 'Host vote percentage must be from 0 to 100.';
  end if;
  update public.pixel_events set
    show_gallery = coalesce(p_show_gallery, false),
    submission_deadline = case
      when phase <> 'submissions' then submission_deadline
      when p_duration_minutes is null then submission_deadline
      when p_duration_minutes = 0 then null
      else now() + make_interval(mins => p_duration_minutes)
    end,
    host_vote_percent = p_host_vote_percent
  where id = p_event;
end;
$$;

create or replace function public.pixel_submit_entry(
  p_event uuid, p_artist text, p_title text, p_size integer, p_pixels text[]
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare participant_id uuid := public.pixel_participant_user(); competition public.pixel_events; entry_id uuid;
begin
  select * into competition from public.pixel_events where id = p_event for update;
  if not found then raise exception 'Competition not found.'; end if;
  if competition.phase <> 'submissions' or
     (competition.submission_deadline is not null and competition.submission_deadline <= now())
    then raise exception 'Submissions are closed.'; end if;
  if length(btrim(p_artist)) not between 1 and 60 then raise exception 'Enter a nickname.'; end if;
  if length(btrim(p_title)) not between 1 and 80 then raise exception 'Enter an artwork title.'; end if;
  if p_size is distinct from competition.size then raise exception 'Canvas size does not match this competition.'; end if;
  if p_pixels is null or array_ndims(p_pixels) is distinct from 1
    or array_lower(p_pixels, 1) is distinct from 1
    or cardinality(p_pixels) <> competition.size * competition.size
    or exists (select 1 from unnest(p_pixels) color where color is null or color !~* '^#[0-9a-f]{6}$')
  then raise exception 'Invalid pixel data.'; end if;
  if not exists (select 1 from unnest(p_pixels) color where lower(color) <> '#ffffff')
    then raise exception 'Draw something before submitting.'; end if;
  if exists (select 1 from public.pixel_entries where event_id = p_event and artist_id = participant_id)
    then raise exception 'You already submitted an entry to this competition.'; end if;
  if (select count(*) from public.pixel_entries where event_id = p_event) >= 200
    then raise exception 'This competition has reached its 200-entry limit.'; end if;
  insert into public.pixel_entries(event_id, artist_id, artist, title, pixels)
    values (p_event, participant_id, btrim(p_artist), btrim(p_title), p_pixels) returning id into entry_id;
  update public.pixel_participants set status = 'submitted', last_seen = now()
    where event_id = p_event and user_id = participant_id;
  return entry_id;
end;
$$;

create or replace function public.pixel_advance_event(p_event uuid, p_next_phase text)
returns void language plpgsql security definer set search_path = '' as $$
declare user_id uuid := public.pixel_verified_user(); competition public.pixel_events;
begin
  select * into competition from public.pixel_events where id = p_event for update;
  if not found then raise exception 'Competition not found.'; end if;
  if competition.host_id <> user_id then raise exception 'Only the host can change this competition.'; end if;
  if competition.phase = 'submissions' and p_next_phase = 'voting' then
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
  update public.pixel_events
    set phase = p_next_phase, phase_changed_at = now()
    where id = p_event;
end;
$$;

-- Reading the room also applies an expired submission timer. With two or more
-- entries it opens voting; otherwise the room ends and shows the available result.
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
    where id = p_event
    returning * into competition;
  end if;

  select jsonb_build_object(
    'id', e.id, 'host_id', e.host_id, 'title', e.title, 'theme', e.theme,
    'size', e.size, 'phase', e.phase, 'join_code', e.join_code,
    'show_gallery', e.show_gallery,
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
    'hostBallotCount', (select count(*) from public.pixel_ballots b
      where b.event_id = e.id and b.voter_id = e.host_id),
    'communityBallotCount', (select count(*) from public.pixel_ballots b
      where b.event_id = e.id and b.voter_id <> e.host_id),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'artist_id', a.artist_id, 'artist', a.artist,
        'title', a.title, 'pixels', a.pixels,
        'score', case when e.phase = 'results' then coalesce((
          select round(sum(case
            when b.voter_id = e.host_id then
              (4 - choice.ordinality) * e.host_vote_percent / 3.0
            else
              (4 - choice.ordinality) * (100 - e.host_vote_percent) /
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
        e.host_id = viewer_id or e.phase <> 'submissions' or
        e.show_gallery or a.artist_id = viewer_id
      )
    ), '[]'::jsonb)
  ) into result from public.pixel_events e where e.id = p_event;
  return result;
end;
$$;

revoke all on function public.pixel_create_event_v2(text, text, integer, boolean, integer, integer) from public, anon, authenticated;
revoke all on function public.pixel_join_event(uuid, text) from public, anon, authenticated;
revoke all on function public.pixel_participant_heartbeat(uuid, text) from public, anon, authenticated;
revoke all on function public.pixel_update_event_settings(uuid, boolean, integer, integer) from public, anon, authenticated;
grant execute on function public.pixel_create_event_v2(text, text, integer, boolean, integer, integer) to authenticated;
grant execute on function public.pixel_join_event(uuid, text) to authenticated;
grant execute on function public.pixel_participant_heartbeat(uuid, text) to authenticated;
grant execute on function public.pixel_update_event_settings(uuid, boolean, integer, integer) to authenticated;

commit;
