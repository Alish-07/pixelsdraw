begin;

alter table public.pixel_events add column join_code text;

-- Codes are intentionally numeric so they are easy to read aloud and type on a
-- phone. The transaction lock makes generation collision-safe across hosts.
create function public.pixel_new_join_code() returns text
language plpgsql security definer set search_path = '' as $$
declare candidate text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('pixel-event-join-code'));
  loop
    candidate := pg_catalog.lpad((pg_catalog.floor(pg_catalog.random() * 1000000)::integer)::text, 6, '0');
    exit when not exists (select 1 from public.pixel_events where join_code = candidate);
  end loop;
  return candidate;
end;
$$;

update public.pixel_events set join_code = public.pixel_new_join_code() where join_code is null;
alter table public.pixel_events alter column join_code set not null;
alter table public.pixel_events add constraint pixel_events_join_code_unique unique (join_code);
alter table public.pixel_events add constraint pixel_events_join_code_format check (join_code ~ '^[0-9]{6}$');

create or replace function public.pixel_create_event(p_title text, p_theme text, p_size integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare user_id uuid := public.pixel_verified_user(); event_id uuid;
begin
  insert into public.pixel_events(host_id, title, theme, size, join_code)
    values (user_id, btrim(p_title), btrim(p_theme), p_size, public.pixel_new_join_code())
    returning id into event_id;
  return event_id;
end;
$$;

create function public.pixel_event_by_code(p_code text)
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.pixel_events
  where join_code = pg_catalog.regexp_replace(p_code, '[^0-9]', '', 'g')
  limit 1;
$$;

-- Return a consistent public snapshot, including the shareable code but never
-- voter identities or individual votes.
create or replace function public.pixel_event_snapshot(p_event uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', e.id, 'host_id', e.host_id, 'title', e.title, 'theme', e.theme,
    'size', e.size, 'phase', e.phase, 'join_code', e.join_code,
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

revoke all on function public.pixel_new_join_code() from public, anon, authenticated;
revoke all on function public.pixel_event_by_code(text) from public, anon, authenticated;
grant execute on function public.pixel_event_by_code(text) to anon, authenticated;

commit;
