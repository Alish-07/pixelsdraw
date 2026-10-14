begin;

-- These two lanes have no human host. Only owner-run scheduling creates rounds.
create table public.pixel_challenge_series (
  key text primary key,
  title text not null,
  drawing_seconds integer not null check (drawing_seconds between 1 and 86400),
  voting_seconds integer not null check (voting_seconds between 1 and 86400),
  size integer not null check (size between 1 and 1024),
  themes text[] not null check (cardinality(themes) > 0),
  enabled boolean not null default true
);
alter table public.pixel_challenge_series enable row level security;
revoke all on public.pixel_challenge_series from public, anon, authenticated;
insert into public.pixel_challenge_series values
 ('sprint', '15-minute sprint', 900, 300, 32, array['A tiny spaceship','Forest creature','A cozy room','Under the sea','A magical potion','Retro robot']),
 ('daily', 'Daily pixel challenge', 82800, 3600, 64, array['A floating island','City after dark','An unexpected hero','A miniature world','Mechanical garden','Dream landscape']);

alter table public.pixel_events alter column host_id drop not null;
alter table public.pixel_events add column challenge_key text references public.pixel_challenge_series(key),
 add column round_start timestamptz,
 add constraint pixel_event_owner check ((challenge_key is null and host_id is not null and round_start is null) or
   (challenge_key is not null and host_id is null and round_start is not null)),
 add constraint pixel_unique_public_round unique (challenge_key, round_start);

-- Null host IDs must not let older host RPCs change an autonomous round.
-- Configuration is immutable, and phase changes must match the actual deadline.
create function public.pixel_protect_public_round() returns trigger language plpgsql set search_path = '' as $$
declare enough boolean;
begin
 if old.challenge_key is null then
   if new.challenge_key is not null then raise exception 'Public rounds are scheduler-owned.'; end if;
   return new;
 end if;
 if (to_jsonb(new) - array['phase','phase_changed_at','voting_deadline','ended_reason']) is distinct from
    (to_jsonb(old) - array['phase','phase_changed_at','voting_deadline','ended_reason']) then
   raise exception 'Public challenge settings cannot be changed by a player.';
 end if;
 if new.phase = old.phase then
   if new.phase_changed_at is distinct from old.phase_changed_at or new.voting_deadline is distinct from old.voting_deadline or new.ended_reason is distinct from old.ended_reason then
     raise exception 'Public challenge deadlines are fixed.';
   end if;
 elsif old.phase = 'submissions' and old.submission_deadline <= now() then
   enough := (select count(*) from public.pixel_entries where event_id=old.id) >= 2;
   if new.phase <> (case when enough then 'voting' else 'results' end) or
      new.phase_changed_at is distinct from old.submission_deadline or
      new.voting_deadline is distinct from (case when enough then old.submission_deadline + make_interval(secs=>old.voting_duration_seconds) else null end) or
      new.ended_reason is distinct from (case when enough then null else 'drawing_insufficient' end) then
     raise exception 'Public rounds advance only at their deadlines.';
   end if;
 elsif old.phase = 'voting' and old.voting_deadline <= now() and new.phase = 'results' then
   if new.phase_changed_at is distinct from old.voting_deadline or new.ended_reason is distinct from 'voting_timeout' then
     raise exception 'Public voting closes at its fixed deadline.';
   end if;
 else raise exception 'Public rounds advance only at their deadlines.';
 end if;
 return new;
end;
$$;
create trigger pixel_public_round_protected before update on public.pixel_events for each row execute function public.pixel_protect_public_round();

-- Defense in depth covers old submission/join RPCs as well as the new UI.
create function public.pixel_public_account_required() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if exists(select 1 from public.pixel_events where id=new.event_id and challenge_key is not null) then
   perform public.pixel_verified_user();
 end if;
 return new;
end;
$$;
create trigger pixel_public_entry_account before insert on public.pixel_entries for each row execute function public.pixel_public_account_required();
create trigger pixel_public_ballot_account before insert or update on public.pixel_ballots for each row execute function public.pixel_public_account_required();
create trigger pixel_public_player_account before insert or update on public.pixel_participants for each row execute function public.pixel_public_account_required();

-- Audience members need a verified account, not a submitted entry or nickname.
create or replace function public.pixel_require_admitted_player() returns trigger language plpgsql security definer set search_path = '' as $$
declare e public.pixel_events; viewer uuid; chosen text;
begin
 select * into e from public.pixel_events where id=new.event_id for update;
 if tg_table_name='pixel_entries' then viewer:=new.artist_id; else viewer:=new.voter_id; end if;
 if tg_table_name='pixel_ballots' and e.challenge_key is not null then
   if viewer is distinct from public.pixel_verified_user() then raise exception 'Vote with your own account.'; end if;
   return new;
 end if;
 if tg_table_name='pixel_ballots' and e.host_id=viewer then return new; end if;
 select nickname into chosen from public.pixel_participants where event_id=new.event_id and user_id=viewer and admission_status='admitted';
 if not found then raise exception 'Join and wait to be admitted before submitting or voting.'; end if;
 if tg_table_name='pixel_entries' then new.artist:=chosen; new.title:=coalesce(nullif(btrim(new.title),''),'Untitled'); end if;
 return new;
end;
$$;

-- Create only the current slot after downtime, not hundreds of empty historical
-- rooms. Unique keys + lane locks make concurrent polls/cron runs idempotent.
create function public.pixel_tick_public_challenges() returns void language plpgsql security definer set search_path = '' as $$
declare lane public.pixel_challenge_series; slot bigint; starts timestamptz; room record; span integer;
begin
 for lane in select * from public.pixel_challenge_series where enabled order by key for update loop
   for room in select id from public.pixel_events where challenge_key=lane.key and phase<>'results' order by id loop
     perform public.pixel_tick_event_phases(room.id);
   end loop;
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

alter function public.pixel_tick_due_events() rename to pixel_tick_due_events_v5;
create function public.pixel_tick_due_events() returns integer language plpgsql security definer set search_path = '' as $$
begin
 perform public.pixel_tick_public_challenges();
 return public.pixel_tick_due_events_v5();
end;
$$;

-- Preserve room visibility and private ballots; correct scoring for hostless
-- rooms using all verified audience ballots (one replaceable ballot/account).
alter function public.pixel_event_snapshot(uuid) rename to pixel_event_snapshot_v5;
revoke all on function public.pixel_event_snapshot_v5(uuid) from public, anon, authenticated;
create function public.pixel_event_snapshot(p_event uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb; e public.pixel_events; entries jsonb;
begin
 result:=public.pixel_event_snapshot_v5(p_event);
 if result is null then return null; end if;
 select * into e from public.pixel_events where id=p_event;
 if e.challenge_key is null then return result; end if;
 if e.phase='results' then
   with scores as (
     select a.id, coalesce((select sum(4-choice.ordinality) from public.pixel_ballots b,
       unnest(b.choices) with ordinality choice(id,ordinality) where b.event_id=p_event and choice.id=a.id),0) as points
     from public.pixel_entries a where a.event_id=p_event
   ) select coalesce(jsonb_agg(item.value || jsonb_build_object('score',s.points,'rank',
     1+(select count(*) from scores other where other.points>s.points)) order by item.ordinality),'[]'::jsonb)
   into entries from jsonb_array_elements(result->'entries') with ordinality item(value,ordinality)
   join scores s on s.id=(item.value->>'id')::uuid;
   result:=result || jsonb_build_object('entries',entries);
 end if;
 return result || jsonb_build_object('challenge_key',e.challenge_key,'round_start',e.round_start,
   'next_round_at',e.round_start+make_interval(secs=>e.submission_duration_seconds+e.voting_duration_seconds),
   'communityBallotCount',result->'ballotCount');
end;
$$;

-- Cards intentionally omit artwork and identity data. Archive is bounded.
create function public.pixel_public_challenges() returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
 perform public.pixel_tick_public_challenges();
 select coalesce(jsonb_agg(to_jsonb(card) order by card.round_start desc,card.challenge_key),'[]'::jsonb) into result from (
   select e.id,e.title,e.theme,e.size,e.phase,e.challenge_key,e.round_start,e.submission_deadline,e.voting_deadline,
     e.round_start+make_interval(secs=>e.submission_duration_seconds+e.voting_duration_seconds) as next_round_at,
     (select count(*) from public.pixel_entries where event_id=e.id) as entry_count,
     (select count(*) from public.pixel_ballots where event_id=e.id) as ballot_count
   from (select ranked.* from (
     select source.*, row_number() over (partition by challenge_key order by round_start desc) as history_position
     from public.pixel_events source where challenge_key is not null and deleted_at is null
   ) ranked where history_position<=31) e
 ) card;
 return result;
end;
$$;
revoke all on function public.pixel_protect_public_round(), public.pixel_public_account_required(), public.pixel_tick_public_challenges(), public.pixel_tick_due_events(), public.pixel_tick_due_events_v5() from public,anon,authenticated;
revoke all on function public.pixel_public_challenges(), public.pixel_event_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.pixel_public_challenges(), public.pixel_event_snapshot(uuid) to anon,authenticated;
commit;
