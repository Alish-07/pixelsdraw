begin;

-- Even read-only RPCs need a read/write POST transaction because the
-- PostgREST pre-request hook records usage. Keep its limits intact.
create or replace function public.pixel_event_by_code(p_code text)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare room uuid; code text := regexp_replace(coalesce(p_code, ''), '[[:space:]-]', '', 'g');
begin
  if length(p_code) > 32 or code !~ '^[0-9]{6}$' then return null; end if;
  select id into room from public.pixel_events
    where join_code = code and deleted_at is null and challenge_key is null and phase <> 'results';
  if room is null then return null; end if;
  perform public.pixel_tick_event_phases(room);
  return (select id from public.pixel_events where id = room and deleted_at is null and phase in ('lobby', 'submissions', 'voting'));
end;
$$;
alter function public.pixel_moderation_status() volatile;

-- During voting, membership means audience access only. Drawing, submitting,
-- and voting are still independently enforced by their existing phase guards.
create or replace function public.pixel_join_event_v2(p_event uuid, p_nickname text, p_suggested boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare viewer uuid := public.pixel_participant_user(); e public.pixel_events; player public.pixel_participants;
  chosen text; base text; suffix integer := 1;
begin
  select * into e from public.pixel_events where id = p_event and deleted_at is null for update;
  if not found then raise exception 'Competition not found or deleted.'; end if;
  perform public.pixel_tick_event_phases(p_event);
  select * into e from public.pixel_events where id = p_event;
  select * into player from public.pixel_participants where event_id = p_event and user_id = viewer;
  if found then
    update public.pixel_participants set last_seen = now(), is_present = true where event_id = p_event and user_id = viewer;
    return jsonb_build_object('nickname', player.nickname, 'admission', player.admission_status);
  end if;
  if e.phase not in ('lobby', 'submissions', 'voting')
     or (e.phase = 'voting' and (e.challenge_key is not null or e.voting_deadline <= clock_timestamp()))
     or e.admission_mode = 'closed'
     or (e.phase = 'submissions' and not e.allow_late_join) then
    raise exception 'This room is not accepting new participants right now.';
  end if;
  base := regexp_replace(btrim(coalesce(p_nickname, '')), '\s+', ' ', 'g');
  if length(base) not between 1 and 60 then raise exception 'Choose a nickname, up to 60 characters.'; end if;
  chosen := base;
  while exists(select 1 from public.pixel_participants where event_id = p_event and lower(nickname) = lower(chosen)) loop
    if not coalesce(p_suggested, false) then raise exception 'That nickname is already taken in this room. Choose another or use a suggestion.'; end if;
    suffix := suffix + 1; chosen := left(base, 52) || ' ' || suffix;
  end loop;
  if (select count(*) from public.pixel_participants where event_id = p_event) >= 500 then
    raise exception 'This room has reached its 500-participant limit.';
  end if;
  insert into public.pixel_participants(event_id, user_id, nickname, admission_status)
    values(p_event, viewer, chosen, case when e.admission_mode = 'approval' then 'pending' else 'admitted' end)
    returning * into player;
  return jsonb_build_object('nickname', player.nickname, 'admission', player.admission_status);
end;
$$;

create or replace function public.pixel_admit_player(p_event uuid, p_player uuid, p_admit boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare viewer uuid := public.pixel_verified_user(); e public.pixel_events;
begin
  select * into e from public.pixel_events where id = p_event for update;
  if not found or e.deleted_at is not null or e.host_id <> viewer then raise exception 'Only the host can approve players.'; end if;
  perform public.pixel_tick_event_phases(p_event);
  select * into e from public.pixel_events where id = p_event;
  if p_admit and (e.phase not in ('lobby', 'submissions', 'voting') or e.admission_mode = 'closed'
    or (e.phase = 'submissions' and not e.allow_late_join)
    or (e.phase = 'voting' and e.voting_deadline <= clock_timestamp())) then
    raise exception 'New admissions are stopped. Change the dashboard setting to admit this player.';
  end if;
  update public.pixel_participants set admission_status = case when p_admit then 'admitted' else 'rejected' end
    where event_id = p_event and user_id = p_player and admission_status = 'pending';
  if not found then raise exception 'This player is no longer waiting for approval.'; end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
