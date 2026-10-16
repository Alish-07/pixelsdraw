begin;

-- Browser clients use checked RPCs, not the raw room directory.
revoke select on public.pixel_events from anon, authenticated;

create schema if not exists pixel_private;
create table pixel_private.pixel_security_limits (name text primary key, amount bigint not null check(amount > 0));
insert into pixel_private.pixel_security_limits values
 ('requests_per_minute',3000), ('requests_per_day',50000),
 ('ip_requests_per_minute',1200), ('account_requests_per_minute',120),
 ('read_bytes_per_day',134217728), ('reader_bytes_per_minute',16777216),
 ('rooms_per_hour',5), ('rooms_per_day',20), ('open_rooms_per_account',10), ('rooms_global_per_day',100),
 ('entry_pixels',65536), ('room_art_bytes',8388608), ('total_art_bytes',134217728),
 ('total_rooms',1000), ('total_public_rounds',10000), ('total_participants',20000), ('total_ballots',20000), ('total_reports',5000),
 ('new_accounts_per_day',100), ('total_accounts',1000);
create table pixel_private.pixel_usage (
 name text primary key, bucket timestamptz not null, amount bigint not null check(amount >= 0)
);
alter table pixel_private.pixel_security_limits enable row level security;
alter table pixel_private.pixel_usage enable row level security;
revoke all on pixel_private.pixel_security_limits, pixel_private.pixel_usage from public,anon,authenticated;

create function pixel_private.pixel_limit(p_name text) returns bigint language sql stable set search_path='' as $$
 select amount from pixel_private.pixel_security_limits where name=p_name;
$$;
create function pixel_private.pixel_consume(p_name text,p_seconds integer,p_amount bigint,p_limit bigint)
returns void language plpgsql set search_path='' as $$
declare slot timestamptz; total bigint;
begin
 if p_amount < 0 or p_limit is null or p_amount > p_limit then
   raise sqlstate 'PT429' using message='Usage limit reached. Please try again later.';
 end if;
 slot:=to_timestamp(floor(extract(epoch from clock_timestamp())/p_seconds)*p_seconds);
 insert into pixel_private.pixel_usage(name,bucket,amount) values(p_name,slot,p_amount)
 on conflict(name) do update set bucket=excluded.bucket,
   amount=case when pixel_usage.bucket=excluded.bucket then pixel_usage.amount+excluded.amount else excluded.amount end
 returning amount into total;
 if total>p_limit then raise sqlstate 'PT429' using message='Usage limit reached. Please try again later.'; end if;
end;
$$;

-- This executes in PostgREST, not in the browser. The global budget still holds
-- if someone rotates accounts/IPs or spoofs a forwarded header. Fixed hash slots
-- bound the counter table: attacker-controlled identities cannot grow it forever.
create function pixel_private.pixel_api_guard() returns void language plpgsql security definer set search_path='' as $$
declare method text:=current_setting('request.method',true); endpoint text:=current_setting('request.path',true);
 headers jsonb; address text; viewer uuid:=auth.uid();
begin
 if endpoint !~ '^/?rpc/' then return; end if;
 if endpoint !~ '^/?rpc/pixel_' then raise sqlstate 'PT403' using message='This API is not available.'; end if;
 if method is distinct from 'POST' then
   raise sqlstate 'PT405' using message='Use POST for competition requests.';
 end if;
 headers:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
 address:=left(btrim(split_part(coalesce(headers->>'x-forwarded-for','unknown'),',',1)),64);
 perform pixel_private.pixel_consume('requests:day',86400,1,pixel_private.pixel_limit('requests_per_day'));
 perform pixel_private.pixel_consume('requests:minute',60,1,pixel_private.pixel_limit('requests_per_minute'));
 perform pixel_private.pixel_consume('ip:'||(hashtextextended(address,17)%2048)::text,60,1,pixel_private.pixel_limit('ip_requests_per_minute'));
 if viewer is not null then
   perform pixel_private.pixel_consume('account:'||(hashtextextended(viewer::text,19)%8192)::text,60,1,pixel_private.pixel_limit('account_requests_per_minute'));
 end if;
end;
$$;

-- Enforce storage quotas underneath every old and new creation/submission RPC.
create index pixel_events_host_created on public.pixel_events(host_id,created_at);
create function pixel_private.pixel_room_budget() returns trigger language plpgsql security definer set search_path='' as $$
declare viewer uuid; sizes jsonb;
begin
 if new.challenge_key is not null then
   if tg_op='INSERT' and (select count(*) from public.pixel_events where challenge_key is not null)>=pixel_private.pixel_limit('total_public_rounds') then
     raise sqlstate 'PT429' using message='New public rounds are temporarily paused at beta capacity.';
   end if;
   return new;
 end if;
 if new.size>256 or (new.canvas_rules->>'mode'='range' and (new.canvas_rules->>'max')::integer>256) or
   exists(select 1 from jsonb_array_elements_text(coalesce(new.canvas_rules->'sizes','[]')) s where s::integer>256) then
   raise exception 'Online competitions support canvas sides up to 256 pixels during beta. Larger artwork is available in the personal editor.';
 end if;
 if tg_op<>'INSERT' then return new; end if;
 viewer:=public.pixel_verified_user();
 if new.host_id is distinct from viewer then raise exception 'Create rooms with your own account.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('pixel-room-budget',31));
 if (select count(*) from public.pixel_events where host_id=viewer and created_at>now()-interval '1 hour')>=pixel_private.pixel_limit('rooms_per_hour') or
    (select count(*) from public.pixel_events where host_id=viewer and created_at>now()-interval '1 day')>=pixel_private.pixel_limit('rooms_per_day') or
    (select count(*) from public.pixel_events where host_id=viewer and deleted_at is null and phase<>'results')>=pixel_private.pixel_limit('open_rooms_per_account') or
    (select count(*) from public.pixel_events where host_id is not null and created_at>now()-interval '1 day')>=pixel_private.pixel_limit('rooms_global_per_day') or
    (select count(*) from public.pixel_events where challenge_key is null)>=pixel_private.pixel_limit('total_rooms') then
   raise sqlstate 'PT429' using message='Room creation limit reached. Finish an existing room or try again later.';
 end if;
 return new;
end;
$$;
create trigger pixel_room_budget before insert or update of size,canvas_rules on public.pixel_events
 for each row execute function pixel_private.pixel_room_budget();

alter table public.pixel_entries add column art_bytes integer not null default 0;
update public.pixel_entries set art_bytes=octet_length(coalesce(frames::text,to_jsonb(pixels)::text));
create function pixel_private.pixel_art_budget() returns trigger language plpgsql security definer set search_path='' as $$
declare content jsonb:=coalesce(new.frames,jsonb_build_array(to_jsonb(new.pixels))); total bigint;
begin
 -- Bound shape before looping pixels or constructing large snapshot responses.
 if new.width is null or new.width<1 or new.width>256 or jsonb_typeof(content)<>'array' or
    jsonb_array_length(content) not between 1 and 32 or
    jsonb_array_length(content)::bigint*new.width*new.width>pixel_private.pixel_limit('entry_pixels') then
   raise exception 'Online submissions allow up to 65,536 pixels across all frames during beta.';
 end if;
 new.art_bytes:=octet_length(content::text);
 if new.art_bytes>1048576 then raise exception 'This submission is too large for online sharing.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('pixel-art-budget',37));
 perform 1 from public.pixel_events where id=new.event_id for update;
 select coalesce(sum(art_bytes),0) into total from public.pixel_entries where event_id=new.event_id and id<>new.id;
 if total+new.art_bytes>pixel_private.pixel_limit('room_art_bytes') then
   raise sqlstate 'PT429' using message='This room has reached its artwork storage limit.';
 end if;
 if (select coalesce(sum(art_bytes),0) from public.pixel_entries where id<>new.id)+new.art_bytes>pixel_private.pixel_limit('total_art_bytes') then
   raise sqlstate 'PT429' using message='Online artwork storage is temporarily full. Keep your local copy and try again later.';
 end if;
 return new;
end;
$$;
create trigger a_pixel_art_budget before insert or update of pixels,frames,width on public.pixel_entries
 for each row execute function pixel_private.pixel_art_budget();

-- Bound account/metadata growth too: anonymous signups are billable identities,
-- and rotating IPs must not bypass a project-wide registration safety ceiling.
create function pixel_private.pixel_account_budget() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if octet_length(coalesce(to_jsonb(new)->'raw_user_meta_data','{}')::text)>8192 and
    (tg_op='INSERT' or (to_jsonb(new)->'raw_user_meta_data') is distinct from (to_jsonb(old)->'raw_user_meta_data')) then
   raise exception 'Account profile metadata is too large.';
 end if;
 if tg_op='INSERT' then
   perform pg_advisory_xact_lock(hashtextextended('pixel-account-budget',41));
   if (select count(*) from auth.users)>=pixel_private.pixel_limit('total_accounts') then
     raise exception 'Registration is temporarily full. Existing accounts can still sign in.';
   end if;
   perform pixel_private.pixel_consume('signups:day',86400,1,pixel_private.pixel_limit('new_accounts_per_day'));
 end if;
 return new;
end;
$$;
create trigger pixel_account_budget before insert or update on auth.users
 for each row execute function pixel_private.pixel_account_budget();

create function pixel_private.pixel_row_budget() returns trigger language plpgsql security definer set search_path='' as $$
declare total bigint; cap bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended('pixel-row-budget:'||tg_table_name,43));
 if tg_table_name='pixel_participants' then
   select count(*) into total from public.pixel_participants; cap:=pixel_private.pixel_limit('total_participants');
 elsif tg_table_name='pixel_ballots' then
   if exists(select 1 from public.pixel_ballots where event_id=new.event_id and voter_id=new.voter_id) then return new; end if;
   select count(*) into total from public.pixel_ballots; cap:=pixel_private.pixel_limit('total_ballots');
 else
   select count(*) into total from public.pixel_entry_reports; cap:=pixel_private.pixel_limit('total_reports');
 end if;
 if total>=cap then raise sqlstate 'PT429' using message='This feature has reached its beta capacity. Please try again later.'; end if;
 return new;
end;
$$;
create trigger a_pixel_player_budget before insert on public.pixel_participants for each row execute function pixel_private.pixel_row_budget();
create trigger a_pixel_ballot_budget before insert on public.pixel_ballots for each row execute function pixel_private.pixel_row_budget();
create trigger a_pixel_report_budget before insert on public.pixel_entry_reports for each row execute function pixel_private.pixel_row_budget();

-- A shared transfer circuit breaker limits successful gallery responses, even
-- across rotating identities. It cannot prevent connection-level DDoS traffic.
create function pixel_private.pixel_read_budget(p_event uuid,p_include_art boolean default true,p_kind text default 'catalog') returns void language plpgsql security definer set search_path='' as $$
declare estimate bigint; reader text; e public.pixel_events;
begin
 if nullif(current_setting('request.method',true),'') is null then return; end if;
 if p_event is not null then
   select * into e from public.pixel_events where id=p_event;
   select 4096+case when p_include_art then coalesce(sum(art_bytes*2+2048),0) else 0 end into estimate from public.pixel_entries
   where event_id=p_event and moderation_hidden_at is null and
     (e.host_id=auth.uid() or e.show_gallery or e.phase<>'submissions' or artist_id=auth.uid());
   if e.host_id=auth.uid() or e.show_roster then
     estimate:=estimate+512*(select count(*) from public.pixel_participants where event_id=p_event);
   end if;
 elsif p_kind='host' then
   select 4096+coalesce(sum(octet_length(title)+octet_length(theme)+1024),0) into estimate
   from (select title,theme from public.pixel_events where host_id=auth.uid() order by created_at desc limit 200) rooms;
 else
   select 4096+coalesce(sum(octet_length(title)+octet_length(theme)+1024),0) into estimate
   from (select title,theme from public.pixel_events where challenge_key is not null and deleted_at is null order by round_start desc limit 62) rooms;
 end if;
 reader:=coalesce(auth.uid()::text,left(btrim(split_part(coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-forwarded-for','unknown'),',',1)),64));
 perform pixel_private.pixel_consume('transfer:day',86400,estimate,pixel_private.pixel_limit('read_bytes_per_day'));
 perform pixel_private.pixel_consume('transfer:reader:'||(hashtextextended(reader,23)%8192)::text,60,estimate,pixel_private.pixel_limit('reader_bytes_per_minute'));
end;
$$;

-- The immutable art payload need not be recomputed/transferred every poll.
-- Only this pixel_private branch of the snapshot stack can omit it; clients cannot
-- use an old version to retain artwork after visibility/moderation changes.
do $$
declare definition text;
begin
 select pg_get_functiondef('public.pixel_event_snapshot_v2(uuid)'::regprocedure) into definition;
 if strpos(definition,'where a.event_id = e.id and (')=0 then raise exception 'Unexpected snapshot definition; review before upgrading.'; end if;
 definition:=replace(definition,'where a.event_id = e.id and (',
   'where a.event_id = e.id and coalesce(current_setting(''pixelsdraw.omit_art'',true),'''')<>''1'' and (');
 execute definition;
end;
$$;
create function public.pixel_event_snapshot_delta(p_event uuid,p_art_version text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.pixel_events; version text; unchanged boolean; result jsonb;
begin
 select * into e from public.pixel_events where id=p_event for update;
 if not found or e.deleted_at is not null then return null; end if;
 perform public.pixel_tick_event_phases(p_event);
 select * into e from public.pixel_events where id=p_event;
 version:=md5(jsonb_build_array(auth.uid(),e.phase,e.show_gallery,e.show_points,e.host_vote_percent,
   (select jsonb_agg(jsonb_build_array(id,moderation_hidden_at) order by id) from public.pixel_entries where event_id=p_event))::text);
 unchanged:=p_art_version is not distinct from version;
 perform pixel_private.pixel_read_budget(p_event,not unchanged);
 perform set_config('pixelsdraw.omit_art',case when unchanged then '1' else '0' end,true);
 result:=public.pixel_event_snapshot_unmetered(p_event);
 return (case when unchanged then result-array['entries','no_winner','moderation_no_winner'] else result end) ||
   jsonb_build_object('art_version',version,'art_unchanged',unchanged);
end;
$$;
alter function public.pixel_event_snapshot(uuid) rename to pixel_event_snapshot_unmetered;
revoke all on function public.pixel_event_snapshot_unmetered(uuid) from public,anon,authenticated;
create function public.pixel_event_snapshot(p_event uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform pixel_private.pixel_read_budget(p_event);
 return public.pixel_event_snapshot_unmetered(p_event);
end;
$$;
alter function public.pixel_public_challenges() rename to pixel_public_challenges_unmetered;
revoke all on function public.pixel_public_challenges_unmetered() from public,anon,authenticated;
create function public.pixel_public_challenges() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform pixel_private.pixel_read_budget(null);
 return public.pixel_public_challenges_unmetered();
end;
$$;
alter function public.pixel_host_events() rename to pixel_host_events_unmetered;
revoke all on function public.pixel_host_events_unmetered() from public,anon,authenticated;
create function public.pixel_host_events() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform public.pixel_verified_user();
 perform pixel_private.pixel_read_budget(null,true,'host');
 return public.pixel_host_events_unmetered();
end;
$$;
create function public.pixel_my_ballot(p_event uuid) returns jsonb language sql security definer set search_path='' as $$
 select coalesce((select to_jsonb(choices) from public.pixel_ballots where event_id=p_event and voter_id=auth.uid()),'[]'::jsonb);
$$;

-- Remove unused public compatibility entry points. The current site calls v5
-- creation/settings and v2 joins/submissions; internal delegation still works.
revoke execute on function public.pixel_create_event(text,text,integer),
 public.pixel_create_event_v2(text,text,integer,boolean,integer,integer),
 public.pixel_create_event_v3(text,text,integer,jsonb,text,boolean,boolean,integer,integer),
 public.pixel_create_event_v4(text,text,integer,jsonb,text,boolean,boolean,integer,integer,boolean,text,boolean),
 public.pixel_update_event_settings(uuid,boolean,integer,integer),
 public.pixel_update_event_settings_v3(uuid,integer,jsonb,text,boolean,boolean,integer,integer),
 public.pixel_update_event_settings_v4(uuid,integer,jsonb,text,boolean,boolean,integer,integer,boolean,text,boolean),
 public.pixel_join_event(uuid,text),public.pixel_participant_heartbeat(uuid,text),
 public.pixel_submit_entry(uuid,text,text,integer,text[]) from public,anon,authenticated;
revoke all on all functions in schema pixel_private from public,anon,authenticated;
grant usage on schema pixel_private to anon,authenticated;
grant execute on function pixel_private.pixel_api_guard() to anon,authenticated;
revoke all on function public.pixel_host_events(),public.pixel_my_ballot(uuid),public.pixel_event_snapshot(uuid),public.pixel_event_snapshot_delta(uuid,text),public.pixel_public_challenges() from public,anon,authenticated;
grant execute on function public.pixel_event_snapshot(uuid),public.pixel_event_snapshot_delta(uuid,text),public.pixel_public_challenges() to anon,authenticated;
grant execute on function public.pixel_host_events(),public.pixel_my_ballot(uuid) to authenticated;
alter default privileges in schema public revoke execute on functions from public,anon,authenticated;
alter default privileges in schema public revoke all on tables from anon,authenticated;

-- Preserve any existing owner-installed request hook instead of overwriting it.
do $$
declare existing text;
begin
 if exists(select 1 from pg_roles where rolname='authenticator') then
   select setting into existing from pg_roles r cross join lateral unnest(r.rolconfig) setting
   where r.rolname='authenticator' and setting like 'pgrst.db_pre_request=%';
   if existing is not null and existing<>'pgrst.db_pre_request=pixel_private.pixel_api_guard' then
     raise exception 'An API request hook already exists. Review and compose the hooks before applying this migration.';
   end if;
   alter role authenticator set pgrst.db_pre_request='pixel_private.pixel_api_guard';
 end if;
end;
$$;
notify pgrst,'reload config';
notify pgrst,'reload schema';
commit;
