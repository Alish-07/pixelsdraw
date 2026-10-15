begin;

-- Keep the stable lane key so links, entries, ballots and archives stay intact.
update public.pixel_challenge_series
set title='Six-hour pixel challenge', drawing_seconds=21600, voting_seconds=1800
where key='daily';

create or replace function public.pixel_tick_public_challenges() returns void language plpgsql security definer set search_path = '' as $$
declare lane public.pixel_challenge_series; slot bigint; starts timestamptz; room record; span integer;
begin
 for lane in select * from public.pixel_challenge_series where enabled order by key for update loop
   for room in select id from public.pixel_events where challenge_key=lane.key and phase<>'results' order by id loop
     perform public.pixel_tick_event_phases(room.id);
   end loop;
   -- A schedule update must not cut short an existing drawing or voting window,
   -- or open a competing round while that promised window is still running.
   if exists(select 1 from public.pixel_events
     where challenge_key=lane.key and phase<>'results' and deleted_at is null
       and (submission_duration_seconds<>lane.drawing_seconds or voting_duration_seconds<>lane.voting_seconds)) then
     continue;
   end if;
   span:=lane.drawing_seconds+lane.voting_seconds;
   slot:=floor(extract(epoch from now()) / span)::bigint;
   starts:=to_timestamp(slot*span);
   if not exists(select 1 from public.pixel_events where challenge_key=lane.key and round_start=starts) then
     insert into public.pixel_events(host_id,title,theme,size,phase,join_code,challenge_key,round_start,
       phase_changed_at,submission_deadline,submission_duration_seconds,voting_duration_seconds,
       canvas_rules,animation_mode,show_gallery,show_points,host_vote_percent,show_roster,admission_mode,allow_late_join)
     values(null,lane.title,lane.themes[1+(slot % cardinality(lane.themes))::integer],lane.size,'submissions',public.pixel_new_join_code(),lane.key,starts,
       starts,starts+make_interval(secs=>lane.drawing_seconds),lane.drawing_seconds,lane.voting_seconds,
       jsonb_build_object('mode','fixed','sizes',jsonb_build_array(lane.size),'min',1,'max',1024),
       'disabled',false,true,0,false,'auto',true);
   end if;
   select id into room from public.pixel_events where challenge_key=lane.key and round_start=starts;
   perform public.pixel_tick_event_phases(room.id);
 end loop;
end;
$$;
revoke all on function public.pixel_tick_public_challenges() from public,anon,authenticated;
commit;
