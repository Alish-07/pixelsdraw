import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create schema auth;
create table auth.users(id uuid primary key, email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
insert into auth.users values ('00000000-0000-0000-0000-000000000001',now()),('00000000-0000-0000-0000-000000000002',null),('00000000-0000-0000-0000-000000000003',null),('00000000-0000-0000-0000-000000000004',now());`);
const root = process.cwd();
for (const file of (await readdir(root+'/supabase/migrations')).sort()) {
  try { await db.exec(await readFile(root+'/supabase/migrations/'+file,'utf8')); console.log('Applied:',file); }
  catch(error) { console.error('Migration failed:',file,error.message); process.exit(1); }
}
// These regression fixtures create many rooms for one host. Default quota
// enforcement is tested separately in security-budgets.mjs.
await db.exec("update pixel_private.pixel_security_limits set amount=1000 where name in ('rooms_per_hour','rooms_per_day','open_rooms_per_account','rooms_global_per_day')");
const uid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
async function as(n) { await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid(n)]); }
async function rpc(name,args) { const rows=(await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args)).rows; return rows[0].result; }
async function create(rules, animation='disabled', seconds=630) { await as(1); return rpc('pixel_create_event_v3',['Test room','Tiny worlds',rules.mode==='range'?rules.min:rules.sizes[0],JSON.stringify(rules),animation,false,false,seconds,37]); }
async function join(id,n) { await as(n); await rpc('pixel_join_event',[id,'Player '+n]); }
async function start(id) { await as(1); await rpc('pixel_advance_event',[id,'submissions']); }
const rules={mode:'list',sizes:[37,91],min:1,max:1024};
const id=await create(rules,'required'); await join(id,2); await join(id,3); await start(id);
let e=await rpc('pixel_event_snapshot',[id]); assert.equal(e.phase,'submissions'); assert.equal(e.submission_duration_seconds,630); assert.deepEqual(e.canvas_rules,rules);
assert.equal(Math.round((Date.parse(e.submission_deadline)-Date.now())/1000),630);
await as(1); await rpc('pixel_update_event_settings_v3',[id,37,JSON.stringify(rules),'required',false,false,null,41]);
assert.equal((await rpc('pixel_event_snapshot',[id])).submission_deadline,e.submission_deadline);
await rpc('pixel_update_event_settings_v3',[id,37,JSON.stringify(rules),'required',false,false,630,37]);
const pixels = size=>Array(size*size).fill('#000000');
await as(2);
await assert.rejects(()=>rpc('pixel_submit_entry_v2',[id,'Player 2','Still',37,JSON.stringify([pixels(37)]),6]),/Animation/);
await assert.rejects(()=>rpc('pixel_submit_entry_v2',[id,'Player 2','Wrong',64,JSON.stringify([pixels(64),pixels(64)]),6]),/size/);
const a=await rpc('pixel_submit_entry_v2',[id,'Player 2','Animation A',37,JSON.stringify([pixels(37),pixels(37)]),6]);
await assert.rejects(()=>rpc('pixel_submit_entry_v2',[id,'Player 2','Again',37,JSON.stringify([pixels(37),pixels(37)]),6]),/already/);
await as(3); const b=await rpc('pixel_submit_entry_v2',[id,'Player 3','Animation B',91,JSON.stringify([pixels(91),pixels(91)]),8]);
assert.equal((await rpc('pixel_event_snapshot',[id])).entries.length,1);
await as(1); await rpc('pixel_advance_event',[id,'voting']); await rpc('pixel_save_ballot',[id,[a,b]]);
await as(2); await rpc('pixel_save_ballot',[id,[b]]);
await assert.rejects(()=>rpc('pixel_save_ballot',[id,[a]]),/own/);
await as(1); await rpc('pixel_advance_event',[id,'results']);
e=await rpc('pixel_event_snapshot',[id]); assert.ok(e.entries.every(x=>typeof x.score==='number')); assert.equal(e.entries[0].frames.length,2);
await as(3); e=await rpc('pixel_event_snapshot',[id]); assert.ok(e.entries.every(x=>x.score===null)); assert.ok(e.entries.every(x=>x.rank>=1));
await as(4); await assert.rejects(()=>rpc('pixel_set_event_deleted',[id,true]),/host/);
await as(1); await rpc('pixel_set_event_deleted',[id,true]); assert.equal(await rpc('pixel_event_snapshot',[id]),null); assert.equal(await rpc('pixel_event_by_code',[e.join_code]),null);
await as(2); await assert.rejects(()=>rpc('pixel_join_event',[id,'Deleted visitor']),/deleted/);
await as(1); await rpc('pixel_set_event_deleted',[id,false]); assert.equal((await rpc('pixel_event_snapshot',[id])).entries.length,2);
const range=await create({mode:'range',sizes:[],min:23,max:150},'optional'); await join(range,2); await start(range); await as(2);
await rpc('pixel_submit_entry_v2',[range,'Player 2','Range',63,JSON.stringify([pixels(63)]),6]);
await as(1); await assert.rejects(()=>rpc('pixel_update_event_settings_v3',[range,32,JSON.stringify({mode:'fixed',sizes:[32],min:1,max:1024}),'optional',false,false,null,37]),/lock/);
const empty=await create({mode:'fixed',sizes:[17],min:1,max:1024},'disabled',1); await join(empty,2); await start(empty);
await db.query("update public.pixel_events set submission_deadline=now()-interval '1 second' where id=$1",[empty]);
await as(2); e=await rpc('pixel_event_snapshot',[empty]); assert.equal(e.phase,'results'); assert.equal(e.ended_empty,true);
await as(1); assert.ok((await rpc('pixel_host_events',[])).some(room=>room.id===empty && room.phase==='results'));
const stale=await create({mode:'fixed',sizes:[17],min:1,max:1024});
await db.query("update public.pixel_events set submission_deadline=now()-interval '1 second' where id=$1",[stale]);
assert.equal((await rpc('pixel_event_snapshot',[stale])).phase,'results');
assert.equal((await db.query("select has_function_privilege('anon','public.pixel_event_snapshot_v2(uuid)','EXECUTE') as allowed")).rows[0].allowed,false);
await as(2); await db.exec('set role authenticated');
assert.equal((await rpc('pixel_event_snapshot',[id])).entries[0].score,null);
await assert.rejects(()=>rpc('pixel_event_snapshot_v2',[id]),/permission denied/);
await db.exec('reset role');
// Admission, nickname collisions, privacy, heartbeat recovery and countdowns.
const controlled = await create({mode:'fixed',sizes:[2],min:1,max:1024});
await as(1); await rpc('pixel_set_room_controls',[controlled,'approval',false,false]);
await as(2); const request = await rpc('pixel_join_event_v2',[controlled,'Pixel Panda',true]); assert.equal(request.admission,'pending');
await as(3); await assert.rejects(()=>rpc('pixel_join_event_v2',[controlled,'  pixel   panda  ',false]),/taken/);
const other = await rpc('pixel_join_event_v2',[controlled,'Pixel Panda',true]); assert.equal(other.nickname,'Pixel Panda 2');
await as(2); assert.deepEqual((await rpc('pixel_event_snapshot',[controlled])).participants,[]);
await as(1); e=await rpc('pixel_event_snapshot',[controlled]); assert.equal(e.pendingPlayers.length,2); assert.equal(e.participantCount,0);
await assert.rejects(()=>rpc('pixel_advance_event',[controlled,'submissions']),/Admit/);
await assert.rejects(()=>rpc('pixel_schedule_start',[controlled,120]),/Admit/);
await as(4); await assert.rejects(()=>rpc('pixel_admit_player',[controlled,uid(2),true]),/host/);
await as(1); await rpc('pixel_admit_player',[controlled,uid(2),true]); await rpc('pixel_schedule_start',[controlled,120]);
await db.query("update public.pixel_events set scheduled_start_at=now()-interval '3 seconds' where id=$1",[controlled]);
await as(2); e=await rpc('pixel_event_snapshot',[controlled]); assert.equal(e.phase,'submissions'); assert.equal(e.my_admission,'admitted'); assert.equal(e.scheduled_start_at,null);
await rpc('pixel_heartbeat_v2',[controlled,'drawing',false]); assert.equal((await rpc('pixel_event_snapshot',[controlled])).activeCount,0);
await rpc('pixel_heartbeat_v2',[controlled,'drawing',true]); assert.equal((await rpc('pixel_event_snapshot',[controlled])).activeCount,1);
await as(3); await assert.rejects(()=>rpc('pixel_submit_entry_v2',[controlled,'Fake name','',2,JSON.stringify([pixels(2)]),6]),/admit/);
await as(1); await assert.rejects(()=>rpc('pixel_admit_player',[controlled,uid(3),true]),/stopped/);
await rpc('pixel_set_room_controls',[controlled,'approval',true,false]); await rpc('pixel_admit_player',[controlled,uid(3),true]);
await as(3); await rpc('pixel_submit_entry_v2',[controlled,'Fake name','  ',2,JSON.stringify([pixels(2)]),6]); e=await rpc('pixel_event_snapshot',[controlled]); assert.equal(e.entries[0].title,'Untitled'); assert.equal(e.entries[0].artist,'Pixel Panda 2');
await as(1); await rpc('pixel_set_room_controls',[controlled,'closed',true,false]);
await as(4); await assert.rejects(()=>rpc('pixel_join_event_v2',[controlled,'New player',true]),/accepting/);
await as(2); assert.equal((await rpc('pixel_join_event_v2',[controlled,'Changed nickname',true])).nickname,'Pixel Panda');
await as(1); await rpc('pixel_set_room_controls',[controlled,'auto',true,true]);
await as(4); assert.equal((await rpc('pixel_join_event_v2',[controlled,'New player',true])).admission,'admitted');
await as(2); assert.equal((await rpc('pixel_event_snapshot',[controlled])).participants.length,3);
await as(1); assert.equal((await rpc('pixel_event_snapshot',[controlled])).activeCount,3);
// Reject pending votes even when someone bypasses the browser's disabled UI.
const gated = await create({mode:'fixed',sizes:[2],min:1,max:1024}); await join(gated,2); await join(gated,3); await start(gated);
await as(2); const ga=await rpc('pixel_submit_entry_v2',[gated,'Player 2','',2,JSON.stringify([pixels(2)]),6]);
await as(3); await rpc('pixel_submit_entry_v2',[gated,'Player 3','',2,JSON.stringify([pixels(2)]),6]);
await as(1); await rpc('pixel_set_room_controls',[gated,'approval',true,true]);
await as(4); await rpc('pixel_join_event_v2',[gated,'Waiting',true]);
await as(1); await rpc('pixel_advance_event',[gated,'voting']);
await as(4); await assert.rejects(()=>rpc('pixel_save_ballot',[gated,[ga]]),/admit/);
assert.equal((await db.query("select has_function_privilege('authenticated','public.pixel_event_snapshot_v3(uuid)','EXECUTE') as allowed")).rows[0].allowed,false);
// Automatic drawing -> voting -> results, even without an open client.
await as(1);
const v5args=['New timed room','Tiny worlds',2,JSON.stringify({mode:'fixed',sizes:[2],min:1,max:1024}),'disabled',false,false,900,0,true,'auto',true,600];
const customRoom=await rpc('pixel_create_event_v5',v5args);
assert.equal((await rpc('pixel_event_snapshot',[customRoom])).voting_duration_seconds,600);
await assert.rejects(()=>rpc('pixel_create_event_v5',[...v5args.slice(0,-1),0]),/duration/);
const timed = await create({mode:'fixed',sizes:[2],min:1,max:1024},'disabled',900);
await as(1); await rpc('pixel_update_event_settings_v5',[timed,2,JSON.stringify({mode:'fixed',sizes:[2],min:1,max:1024}),'disabled',false,false,null,37,true,'auto',true,450]);
await join(timed,2); await join(timed,3); await start(timed);
await as(2); const ta=await rpc('pixel_submit_entry_v2',[timed,'Player 2','Timed A',2,JSON.stringify([pixels(2)]),6]);
await as(3); const tb=await rpc('pixel_submit_entry_v2',[timed,'Player 3','Timed B',2,JSON.stringify([pixels(2)]),6]);
await db.query("update public.pixel_events set submission_deadline=now()-interval '10 seconds' where id=$1",[timed]);
await as(2); e=await rpc('pixel_event_snapshot',[timed]); assert.equal(e.phase,'voting'); assert.equal(e.voting_duration_seconds,450);
assert.equal(Date.parse(e.voting_deadline)-Date.parse(e.submission_deadline),450000);
assert.equal(Math.round((Date.parse(e.voting_deadline)-Date.now())/1000),440);
await rpc('pixel_save_ballot',[timed,[tb]]);
await as(1); await assert.rejects(()=>rpc('pixel_update_event_settings_v5',[timed,2,JSON.stringify({mode:'fixed',sizes:[2],min:1,max:1024}),'disabled',false,false,null,37,true,'auto',true,600]),/locked/);
await assert.rejects(()=>db.query("update public.pixel_events set voting_deadline=now()+interval '1 hour' where id=$1",[timed]),/extended/);
// Move the fixture clock backwards while it is still drawing, not by changing
// an already-open voting deadline that production clients cannot extend.
const unattended = await create({mode:'fixed',sizes:[2],min:1,max:1024});
await join(unattended,2); await join(unattended,3); await start(unattended);
await as(2); await rpc('pixel_submit_entry_v2',[unattended,'Player 2','A',2,JSON.stringify([pixels(2)]),6]);
await as(3); await rpc('pixel_submit_entry_v2',[unattended,'Player 3','B',2,JSON.stringify([pixels(2)]),6]);
await db.query("update public.pixel_events set submission_deadline=now()-interval '6 minutes' where id=$1",[unattended]);
assert.ok(await rpc('pixel_tick_due_events',[])>=1);
assert.equal((await db.query('select phase from public.pixel_events where id=$1',[unattended])).rows[0].phase,'results');
e=await rpc('pixel_event_snapshot',[unattended]); assert.equal(e.ended_reason,'voting_timeout'); assert.equal(e.no_winner,true); assert.equal(e.ballotCount,0);
await as(2); await assert.rejects(()=>rpc('pixel_save_ballot',[unattended,[ta]]),/closed/);
// Even a stale voting row rejects late ballots before the scheduled tick runs.
const staleVote = await create({mode:'fixed',sizes:[2],min:1,max:1024}); await join(staleVote,2); await join(staleVote,3); await start(staleVote);
await as(2); await rpc('pixel_submit_entry_v2',[staleVote,'Player 2','A',2,JSON.stringify([pixels(2)]),6]);
await as(3); const sv=await rpc('pixel_submit_entry_v2',[staleVote,'Player 3','B',2,JSON.stringify([pixels(2)]),6]);
await db.query("update public.pixel_events set phase='voting',voting_deadline=now()-interval '1 second',phase_changed_at=now()-interval '301 seconds' where id=$1",[staleVote]);
await as(2); await assert.rejects(()=>rpc('pixel_save_ballot',[staleVote,[sv]]),/closed/);
await as(1); await assert.rejects(()=>rpc('pixel_save_ballot',[staleVote,[sv]]),/closed/);
assert.equal((await rpc('pixel_event_snapshot',[staleVote])).phase,'results');
// With ballots, timeout finalizes without requiring the host's missing ballot.
const voted = await create({mode:'fixed',sizes:[2],min:1,max:1024}); await join(voted,2); await join(voted,3); await start(voted);
await as(2); await rpc('pixel_submit_entry_v2',[voted,'Player 2','A',2,JSON.stringify([pixels(2)]),6]);
await as(3); const vb=await rpc('pixel_submit_entry_v2',[voted,'Player 3','B',2,JSON.stringify([pixels(2)]),6]);
await as(1); await rpc('pixel_advance_event',[voted,'voting']);
e=await rpc('pixel_event_snapshot',[voted]); assert.equal(e.voting_duration_seconds,300); assert.ok(Date.parse(e.voting_deadline)>Date.now());
await as(2); await rpc('pixel_save_ballot',[voted,[vb]]);
// Owner-only fixture adjustment simulates passage of five minutes.
await db.exec('alter table public.pixel_events disable trigger pixel_voting_timer');
await db.query("update public.pixel_events set voting_deadline=now()-interval '1 second' where id=$1",[voted]);
await db.exec('alter table public.pixel_events enable trigger pixel_voting_timer');
e=await rpc('pixel_event_snapshot',[voted]); assert.equal(e.phase,'results'); assert.equal(e.no_winner,false); assert.equal(e.entries.find(x=>x.id===vb).rank,1); assert.equal(e.hostBallotCount,0);
await as(1); await rpc('pixel_set_event_deleted',[timed,true]); assert.equal(await rpc('pixel_event_snapshot',[timed]),null);
await rpc('pixel_tick_due_events',[]);
assert.equal((await db.query('select phase from public.pixel_events where id=$1',[timed])).rows[0].phase,'voting');
assert.equal((await db.query("select has_function_privilege('authenticated','public.pixel_tick_due_events()','EXECUTE') as allowed")).rows[0].allowed,false);
assert.equal((await db.query("select has_function_privilege('anon','public.pixel_event_snapshot_v4(uuid)','EXECUTE') as allowed")).rows[0].allowed,false);
// Autonomous lanes: public discovery, fixed clocks, verified audience voting.
await as(1);
let publicRounds = await rpc('pixel_public_challenges',[]);
assert.equal(publicRounds.filter(x=>x.challenge_key==='sprint').length,1);
assert.equal(publicRounds.filter(x=>x.challenge_key==='daily').length,1);
assert.deepEqual((await rpc('pixel_public_challenges',[])).map(x=>x.id),publicRounds.map(x=>x.id));
const longRound = publicRounds.find(x=>x.challenge_key==='daily');
assert.equal(Date.parse(longRound.submission_deadline)-Date.parse(longRound.round_start),21600*1000);
assert.equal(Date.parse(longRound.next_round_at)-Date.parse(longRound.submission_deadline),1800*1000);
// Simulate a daily round already running when the new lane configuration arrives.
await db.exec('alter table public.pixel_events disable trigger pixel_public_round_protected; alter table public.pixel_events disable trigger pixel_voting_timer;');
await db.query("update public.pixel_events set round_start=round_start-interval '24 hours',phase='submissions',submission_duration_seconds=82800,voting_duration_seconds=3600,submission_deadline=now()+interval '1 hour',voting_deadline=null where id=$1",[longRound.id]);
await db.exec('alter table public.pixel_events enable trigger pixel_public_round_protected; alter table public.pixel_events enable trigger pixel_voting_timer;');
assert.equal((await rpc('pixel_public_challenges',[])).filter(x=>x.challenge_key==='daily').length,1,'old drawing/voting windows must finish before the new schedule starts');
await db.exec('alter table public.pixel_events disable trigger pixel_public_round_protected; alter table public.pixel_events disable trigger pixel_voting_timer;');
await db.query("update public.pixel_events set phase='voting',submission_deadline=now()-interval '30 minutes',voting_deadline=now()+interval '30 minutes' where id=$1",[longRound.id]);
await db.exec('alter table public.pixel_events enable trigger pixel_public_round_protected; alter table public.pixel_events enable trigger pixel_voting_timer;');
assert.equal((await rpc('pixel_public_challenges',[])).filter(x=>x.challenge_key==='daily').length,1,'old voting windows must not be cut short');
await db.exec('alter table public.pixel_events disable trigger pixel_public_round_protected; alter table public.pixel_events disable trigger pixel_voting_timer;');
await db.query("update public.pixel_events set phase='results' where id=$1",[longRound.id]);
await db.exec('alter table public.pixel_events enable trigger pixel_public_round_protected; alter table public.pixel_events enable trigger pixel_voting_timer;');
const nextLongRound=(await rpc('pixel_public_challenges',[])).find(x=>x.challenge_key==='daily' && x.id!==longRound.id);
assert.ok(nextLongRound);
assert.equal(Date.parse(nextLongRound.next_round_at)-Date.parse(nextLongRound.round_start),23400*1000);
// A deterministic owner fixture opens the sprint now, irrespective of test time.
const sprint = publicRounds.find(x=>x.challenge_key==='sprint');
await db.exec('alter table public.pixel_events disable trigger pixel_public_round_protected; alter table public.pixel_events disable trigger pixel_voting_timer;');
await db.query("update public.pixel_events set phase='submissions', submission_deadline=now()+interval '15 minutes', voting_deadline=null, ended_reason=null where id=$1",[sprint.id]);
await db.exec('alter table public.pixel_events enable trigger pixel_public_round_protected; alter table public.pixel_events enable trigger pixel_voting_timer;');
await as(2); await assert.rejects(()=>rpc('pixel_join_event_v2',[sprint.id,'Anonymous',true]),/confirmed/);
await assert.rejects(()=>rpc('pixel_submit_entry_v2',[sprint.id,'Anonymous','A',32,JSON.stringify([pixels(32)]),6]),/confirmed|Join/);
await as(1); await rpc('pixel_join_event_v2',[sprint.id,'Artist One',true]);
const pa=await rpc('pixel_submit_entry_v2',[sprint.id,'Artist One','Public A',32,JSON.stringify([pixels(32)]),6]);
await as(4); await rpc('pixel_join_event_v2',[sprint.id,'Artist Two',true]);
const pb=await rpc('pixel_submit_entry_v2',[sprint.id,'Artist Two','Public B',32,JSON.stringify([pixels(32)]),6]);
await db.query("select set_config('request.jwt.claim.sub','',false)");
await db.exec('set role anon');
assert.equal((await rpc('pixel_event_snapshot',[sprint.id])).entries.length,0);
await assert.rejects(()=>rpc('pixel_tick_public_challenges',[]),/permission/);
await db.exec('reset role');
await as(1);
await assert.rejects(()=>rpc('pixel_advance_event',[sprint.id,'voting']),/deadlines/);
await assert.rejects(()=>rpc('pixel_update_event_settings_v5',[sprint.id,32,JSON.stringify({mode:'fixed',sizes:[32],min:1,max:1024}),'disabled',false,false,null,0,false,'auto',true,300]),/cannot be changed/);
await db.exec('alter table public.pixel_events disable trigger pixel_public_round_protected');
await db.query("update public.pixel_events set submission_deadline=now()-interval '1 second' where id=$1",[sprint.id]);
await db.exec('alter table public.pixel_events enable trigger pixel_public_round_protected');
e=await rpc('pixel_event_snapshot',[sprint.id]); assert.equal(e.phase,'voting'); assert.equal(e.challenge_key,'sprint'); assert.equal(e.entries.length,2);
await as(2); await assert.rejects(()=>rpc('pixel_save_ballot',[sprint.id,[pa]]),/confirmed/);
await db.query("insert into auth.users values ($1,now())",[uid(5)]); await as(5);
// No nickname, join or submitted entry is required for the verified audience.
await rpc('pixel_save_ballot',[sprint.id,[pa,pb]]);
await rpc('pixel_save_ballot',[sprint.id,[pb,pa]]);
assert.equal((await rpc('pixel_event_snapshot',[sprint.id])).ballotCount,1);
await assert.rejects(()=>rpc('pixel_save_ballot',[sprint.id,[pb,pb]]),/different/);
await as(1); await assert.rejects(()=>rpc('pixel_save_ballot',[sprint.id,[pa]]),/own/);
await rpc('pixel_save_ballot',[sprint.id,[pb]]);
await db.exec('alter table public.pixel_events disable trigger pixel_public_round_protected; alter table public.pixel_events disable trigger pixel_voting_timer');
await db.query("update public.pixel_events set voting_deadline=now()-interval '1 second' where id=$1",[sprint.id]);
await db.exec('alter table public.pixel_events enable trigger pixel_public_round_protected; alter table public.pixel_events enable trigger pixel_voting_timer');
e=await rpc('pixel_event_snapshot',[sprint.id]); assert.equal(e.phase,'results'); assert.equal(e.no_winner,false);
assert.equal(e.entries.find(x=>x.id===pb).score,6); assert.equal(e.entries.find(x=>x.id===pb).rank,1);
await assert.rejects(()=>rpc('pixel_save_ballot',[sprint.id,[pb]]),/closed/);
// Old rounds remain archived; the next slot is created once, without backfill.
await db.exec('alter table public.pixel_events disable trigger pixel_public_round_protected');
await db.query("update public.pixel_events set round_start=round_start-interval '20 minutes' where id=$1",[sprint.id]);
await db.exec('alter table public.pixel_events enable trigger pixel_public_round_protected');
publicRounds=await rpc('pixel_public_challenges',[]);
assert.equal(publicRounds.filter(x=>x.challenge_key==='sprint').length,2);
assert.equal((await rpc('pixel_public_challenges',[])).length,publicRounds.length);
assert.equal((await rpc('pixel_event_snapshot',[sprint.id])).entries.length,2);
assert.equal((await db.query("select has_function_privilege('anon','public.pixel_event_snapshot_v5(uuid)','execute') as allowed")).rows[0].allowed,false);
// Moderator accounts exist only in this disposable database fixture. Production
// ships with no moderator grants until the owner chooses a verified account.
await as(2); await assert.rejects(()=>rpc('pixel_report_entry',[pb,'spam','Test']),/confirmed/);
await as(5);
await assert.rejects(()=>rpc('pixel_moderation_queue',[false]),/Moderator/);
await assert.rejects(()=>rpc('pixel_report_entry',[pb,'invalid','']),/reason/);
const reportB=await rpc('pixel_report_entry',[pb,'spam','Private report']);
assert.equal(await rpc('pixel_report_entry',[pb,'spam','Duplicate']),reportB);
assert.equal((await db.query('select count(*)::int as n from public.pixel_entry_reports')).rows[0].n,1);
assert.equal((await rpc('pixel_event_snapshot',[sprint.id])).entries.length,2,'reports must not automatically hide entries');
await db.exec('set role authenticated');
await assert.rejects(()=>db.query('select * from public.pixel_entry_reports'),/permission/);
await assert.rejects(()=>db.query('insert into public.pixel_moderators(user_id) values ($1)',[uid(5)]),/permission/);
await db.exec('reset role');
// Owner-only fixture rows exercise the hourly cap without creating live reports.
await db.query("insert into public.pixel_entry_reports(entry_id,reporter_id,reason) select id,$1,'other' from public.pixel_entries where event_id<>$2 limit 9",[uid(5),sprint.id]);
await assert.rejects(()=>rpc('pixel_report_entry',[pa,'other','']),/limit/);
await db.query('delete from public.pixel_entry_reports where reporter_id=$1 and entry_id not in ($2,$3)',[uid(5),pa,pb]);
const reportA=await rpc('pixel_report_entry',[pa,'other','Please review']);
await db.query('insert into public.pixel_moderators(user_id) values ($1)',[uid(4)]);
await as(4); assert.equal(await rpc('pixel_moderation_status',[]),true);
const queue=await rpc('pixel_moderation_queue',[false]);
assert.equal((await rpc('pixel_moderation_queue',[false,50])).length,0);
await assert.rejects(()=>rpc('pixel_moderation_queue',[false,-1]),/page/);
assert.equal(queue.length,2); assert.equal(queue.find(x=>x.id===reportB).details,'Private report');
assert.equal(Object.hasOwn(queue[0],'reporter_id'),false);
await assert.rejects(()=>rpc('pixel_review_report',[reportB,'hide','']),/explain/);
await rpc('pixel_review_report',[reportB,'hide','Fixture hide']);
e=await rpc('pixel_event_snapshot',[sprint.id]);
assert.equal(e.my_entry_exists,true); assert.equal(e.my_entry_hidden,true);
assert.equal(e.entries.length,1); assert.equal(e.entries[0].id,pa); assert.equal(e.entries[0].rank,1);
assert.equal(e.no_winner,false); assert.equal(e.moderation_notice,true);
await as(5); await assert.rejects(()=>rpc('pixel_report_entry',[pb,'other','']),/visible/);
await assert.rejects(()=>rpc('pixel_review_report',[reportA,'hide','Not a moderator']),/Moderator/);
// Hidden choices are rejected even by an older client during an open vote.
await db.exec('alter table public.pixel_events disable trigger pixel_public_round_protected; alter table public.pixel_events disable trigger pixel_voting_timer');
await db.query("update public.pixel_events set phase='voting',voting_deadline=now()+interval '5 minutes' where id=$1",[sprint.id]);
await db.exec('alter table public.pixel_events enable trigger pixel_public_round_protected; alter table public.pixel_events enable trigger pixel_voting_timer');
await assert.rejects(()=>rpc('pixel_save_ballot',[sprint.id,[pb]]),/no longer available/);
await db.exec('alter table public.pixel_events disable trigger pixel_public_round_protected; alter table public.pixel_events disable trigger pixel_voting_timer');
await db.query("update public.pixel_events set phase='results' where id=$1",[sprint.id]);
await db.exec('alter table public.pixel_events enable trigger pixel_public_round_protected; alter table public.pixel_events enable trigger pixel_voting_timer');
await as(4); await rpc('pixel_review_report',[reportA,'hide','Fixture hide A']);
e=await rpc('pixel_event_snapshot',[sprint.id]); assert.equal(e.entries.length,0); assert.equal(e.no_winner,true);
await rpc('pixel_review_report',[reportB,'restore','Fixture restore']);
e=await rpc('pixel_event_snapshot',[sprint.id]); assert.equal(e.entries[0].id,pb); assert.equal(e.entries[0].score,6); assert.equal(e.no_winner,false);
assert.equal((await db.query('select count(*)::int as n from public.pixel_moderation_audit')).rows[0].n,3);
assert.equal((await rpc('pixel_moderation_queue',[true])).length,2);
assert.equal((await db.query("select has_function_privilege('anon','public.pixel_event_snapshot_v6(uuid)','execute') as allowed")).rows[0].allowed,false);
console.log('PASS: complete migrations, hosted regressions, autonomous clocks, private reporting, rate limits, moderator authorization, reversible hiding, eligible scores and audit history.');
await db.close();
