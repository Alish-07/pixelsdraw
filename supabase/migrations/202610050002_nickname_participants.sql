begin;

-- Hosts still need a confirmed email. Participants only need a Supabase user ID,
-- which may belong to an anonymous session created from a nickname.
create function public.pixel_participant_user() returns uuid
language plpgsql security definer set search_path = '' as $$
declare user_id uuid := auth.uid();
begin
  if user_id is null then
    raise exception 'Join the competition with a nickname first.';
  end if;
  return user_id;
end;
$$;

create or replace function public.pixel_submit_entry(p_event uuid, p_artist text, p_title text, p_size integer, p_pixels text[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare user_id uuid := public.pixel_participant_user(); competition public.pixel_events; entry_id uuid;
begin
  select * into competition from public.pixel_events where id = p_event for update;
  if not found then raise exception 'Competition not found.'; end if;
  if competition.phase <> 'submissions' then raise exception 'Submissions are closed.'; end if;
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
  if exists (select 1 from public.pixel_entries where event_id = p_event and artist_id = user_id)
    then raise exception 'You already submitted an entry to this competition.'; end if;
  if (select count(*) from public.pixel_entries where event_id = p_event) >= 200
    then raise exception 'This competition has reached its 200-entry limit.'; end if;
  insert into public.pixel_entries(event_id, artist_id, artist, title, pixels)
    values (p_event, user_id, btrim(p_artist), btrim(p_title), p_pixels) returning id into entry_id;
  return entry_id;
end;
$$;

create or replace function public.pixel_save_ballot(p_event uuid, p_choices uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare user_id uuid := public.pixel_participant_user(); competition public.pixel_events;
begin
  select * into competition from public.pixel_events where id = p_event for update;
  if not found then raise exception 'Competition not found.'; end if;
  if competition.phase <> 'voting' then raise exception 'Voting is closed.'; end if;
  if p_choices is null or array_ndims(p_choices) is distinct from 1
    or array_lower(p_choices, 1) is distinct from 1 or cardinality(p_choices) not between 1 and 3
    or (select count(distinct id) from unnest(p_choices) id) <> cardinality(p_choices)
  then raise exception 'Choose one to three different entries.'; end if;
  if (select count(*) from public.pixel_entries where event_id = p_event and id = any(p_choices)) <> cardinality(p_choices)
    then raise exception 'All choices must belong to this competition.'; end if;
  if exists (select 1 from public.pixel_entries where id = any(p_choices) and artist_id = user_id)
    then raise exception 'You cannot vote for your own artwork.'; end if;
  insert into public.pixel_ballots(event_id, voter_id, choices) values (p_event, user_id, p_choices)
    on conflict (event_id, voter_id) do update set choices = excluded.choices, updated_at = now();
end;
$$;

revoke all on function public.pixel_participant_user() from public, anon, authenticated;

commit;
