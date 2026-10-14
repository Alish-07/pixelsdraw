begin;

-- Public artwork is readable by visitors. All writes go through the checked
-- functions below; changing browser code cannot bypass these rules.
create table public.pixel_events (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users(id),
  title text not null check (length(btrim(title)) between 1 and 80),
  theme text not null check (length(btrim(theme)) between 1 and 160),
  size integer not null check (size in (16, 24, 32, 48, 64)),
  phase text not null default 'submissions' check (phase in ('submissions', 'voting', 'results')),
  created_at timestamptz not null default now()
);
create table public.pixel_entries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.pixel_events(id),
  artist_id uuid not null references auth.users(id),
  artist text not null check (length(btrim(artist)) between 1 and 60),
  title text not null check (length(btrim(title)) between 1 and 80),
  pixels text[] not null,
  created_at timestamptz not null default now(),
  unique (event_id, artist_id)
);
create table public.pixel_ballots (
  event_id uuid not null references public.pixel_events(id),
  voter_id uuid not null references auth.users(id),
  choices uuid[] not null,
  updated_at timestamptz not null default now(),
  primary key (event_id, voter_id)
);
create index pixel_events_host on public.pixel_events(host_id);

alter table public.pixel_events enable row level security;
alter table public.pixel_entries enable row level security;
alter table public.pixel_ballots enable row level security;
revoke all on public.pixel_events, public.pixel_entries, public.pixel_ballots from public, anon, authenticated;
grant select on public.pixel_events, public.pixel_entries to anon, authenticated;
grant select on public.pixel_ballots to authenticated;
create policy "Public events" on public.pixel_events for select to anon, authenticated using (true);
create policy "Public artwork" on public.pixel_entries for select to anon, authenticated using (true);
create policy "Only your own ballot" on public.pixel_ballots for select to authenticated
  using (voter_id = (select auth.uid()));

-- Internal helper: a confirmed email account is required, including when
-- Supabase anonymous sign-in is enabled elsewhere in the project.
create function public.pixel_verified_user() returns uuid
language plpgsql security definer set search_path = '' as $$
declare user_id uuid := auth.uid();
begin
  if user_id is null or not exists (
    select 1 from auth.users where id = user_id and email_confirmed_at is not null
  ) then
    raise exception 'Sign in with a confirmed email account first.';
  end if;
  return user_id;
end;
$$;

create function public.pixel_create_event(p_title text, p_theme text, p_size integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare user_id uuid := public.pixel_verified_user(); event_id uuid;
begin
  insert into public.pixel_events(host_id, title, theme, size)
    values (user_id, btrim(p_title), btrim(p_theme), p_size) returning id into event_id;
  return event_id;
end;
$$;

create function public.pixel_submit_entry(p_event uuid, p_artist text, p_title text, p_size integer, p_pixels text[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare user_id uuid := public.pixel_verified_user(); competition public.pixel_events; entry_id uuid;
begin
  -- Every event mutation takes this lock, serializing submissions with closing.
  select * into competition from public.pixel_events where id = p_event for update;
  if not found then raise exception 'Event not found.'; end if;
  if competition.phase <> 'submissions' then raise exception 'Submissions are closed.'; end if;
  if p_size is distinct from competition.size then raise exception 'Canvas size does not match this event.'; end if;
  if p_pixels is null or array_ndims(p_pixels) is distinct from 1
    or array_lower(p_pixels, 1) is distinct from 1
    or cardinality(p_pixels) <> competition.size * competition.size
    or exists (select 1 from unnest(p_pixels) color where color is null or color !~* '^#[0-9a-f]{6}$')
  then raise exception 'Invalid pixel data.'; end if;
  if not exists (select 1 from unnest(p_pixels) color where lower(color) <> '#ffffff')
    then raise exception 'Draw something before submitting.'; end if;
  if exists (select 1 from public.pixel_entries where event_id = p_event and artist_id = user_id)
    then raise exception 'You already submitted an entry to this event.'; end if;
  if (select count(*) from public.pixel_entries where event_id = p_event) >= 200
    then raise exception 'This event has reached its 200-entry limit.'; end if;
  insert into public.pixel_entries(event_id, artist_id, artist, title, pixels)
    values (p_event, user_id, btrim(p_artist), btrim(p_title), p_pixels) returning id into entry_id;
  return entry_id;
end;
$$;

create function public.pixel_save_ballot(p_event uuid, p_choices uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare user_id uuid := public.pixel_verified_user(); competition public.pixel_events;
begin
  select * into competition from public.pixel_events where id = p_event for update;
  if not found then raise exception 'Event not found.'; end if;
  if competition.phase <> 'voting' then raise exception 'Voting is closed.'; end if;
  if p_choices is null or array_ndims(p_choices) is distinct from 1
    or array_lower(p_choices, 1) is distinct from 1 or cardinality(p_choices) not between 1 and 3
    or (select count(distinct id) from unnest(p_choices) id) <> cardinality(p_choices)
  then raise exception 'Choose one to three different entries.'; end if;
  if (select count(*) from public.pixel_entries where event_id = p_event and id = any(p_choices)) <> cardinality(p_choices)
    then raise exception 'All choices must belong to this event.'; end if;
  if exists (select 1 from public.pixel_entries where id = any(p_choices) and artist_id = user_id)
    then raise exception 'You cannot vote for your own artwork.'; end if;
  insert into public.pixel_ballots(event_id, voter_id, choices) values (p_event, user_id, p_choices)
    on conflict (event_id, voter_id) do update set choices = excluded.choices, updated_at = now();
end;
$$;

create function public.pixel_advance_event(p_event uuid, p_next_phase text)
returns void language plpgsql security definer set search_path = '' as $$
declare user_id uuid := public.pixel_verified_user(); competition public.pixel_events;
begin
  select * into competition from public.pixel_events where id = p_event for update;
  if not found then raise exception 'Event not found.'; end if;
  if competition.host_id <> user_id then raise exception 'Only the host can change this event.'; end if;
  if competition.phase = 'submissions' and p_next_phase = 'voting' then
    if (select count(*) from public.pixel_entries where event_id = p_event) < 2
      then raise exception 'At least two entries are required.'; end if;
  elsif competition.phase = 'voting' and p_next_phase = 'results' then
    if not exists (select 1 from public.pixel_ballots where event_id = p_event)
      then raise exception 'At least one ballot is required.'; end if;
  else
    raise exception 'Invalid phase change.';
  end if;
  update public.pixel_events set phase = p_next_phase where id = p_event;
end;
$$;

-- Return a consistent public snapshot, never voter identities or individual votes.
-- Scores are revealed only after the host finishes voting.
create function public.pixel_event_snapshot(p_event uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', e.id, 'host_id', e.host_id, 'title', e.title, 'theme', e.theme,
    'size', e.size, 'phase', e.phase,
    'ballotCount', (select count(*) from public.pixel_ballots b where b.event_id = e.id),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'artist_id', a.artist_id, 'artist', a.artist,
        'title', a.title, 'pixels', a.pixels,
        'score', case when e.phase = 'results' then coalesce((
          select sum(4 - choice.ordinality)
          from public.pixel_ballots b,
          unnest(b.choices) with ordinality as choice(id, ordinality)
          where b.event_id = e.id and choice.id = a.id
        ), 0) else null end
      ) order by a.created_at, a.id)
      from public.pixel_entries a where a.event_id = e.id
    ), '[]'::jsonb)
  ) from public.pixel_events e where e.id = p_event;
$$;

revoke all on function public.pixel_verified_user() from public, anon, authenticated;
revoke all on function public.pixel_create_event(text, text, integer) from public, anon, authenticated;
revoke all on function public.pixel_submit_entry(uuid, text, text, integer, text[]) from public, anon, authenticated;
revoke all on function public.pixel_save_ballot(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.pixel_advance_event(uuid, text) from public, anon, authenticated;
revoke all on function public.pixel_event_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.pixel_create_event(text, text, integer) to authenticated;
grant execute on function public.pixel_submit_entry(uuid, text, text, integer, text[]) to authenticated;
grant execute on function public.pixel_save_ballot(uuid, uuid[]) to authenticated;
grant execute on function public.pixel_advance_event(uuid, text) to authenticated;
grant execute on function public.pixel_event_snapshot(uuid) to anon, authenticated;

commit;
