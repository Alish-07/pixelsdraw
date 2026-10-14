begin;

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
  if competition.phase <> 'submissions' then
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
    submission_deadline = case
      when p_duration_minutes is null then submission_deadline
      when p_duration_minutes = 0 then null
      else now() + make_interval(mins => p_duration_minutes)
    end,
    host_vote_percent = p_host_vote_percent
  where id = p_event;
end;
$$;

commit;
