import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role authenticator;
create schema auth;create table auth.users(id uuid primary key,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated;
grant execute on function auth.uid() to anon,authenticated;
insert into auth.users(id,email_confirmed_at) values('00000000-0000-0000-0000-000000000001',now()),('00000000-0000-0000-0000-000000000002',null),('00000000-0000-0000-0000-000000000003',now());`);
for(const f of (await readdir('supabase/migrations')).sort())await db.exec(await readFile('supabase/migrations/'+f,'utf8'));
await db.exec(await readFile('supabase/finish_security_cutover.sql','utf8'));
const uid=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
const as=async n=>db.query("select set_config('request.jwt.claim.sub',$1,false)",[n?uid(n):'']);
const rpc=async(name,args=[]) => (await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args)).rows[0].result;
async function limit(name,amount){await db.query('update pixel_private.pixel_security_limits set amount=$2 where name=$1',[name,amount]);}
async function create(size=32){return rpc('pixel_create_event_v5',['Security fixture','Not a real room',size,JSON.stringify({mode:'fixed',sizes:[size],min:1,max:1024}),'disabled',false,false,900,0,true,'auto',true,300]);}
await as(1);
const rooms=[];for(let i=0;i<5;i++)rooms.push(await create());
await assert.rejects(()=>create(),/Room creation limit/);
await rpc('pixel_set_event_deleted',[rooms[0],true]);
await assert.rejects(()=>create(),/Room creation limit/); // soft deletion cannot reset the quota
await limit('rooms_per_hour',1000);await limit('rooms_global_per_day',5);await as(3);
await assert.rejects(()=>create(),/Room creation limit/);
await limit('rooms_global_per_day',100);await as(2);
await assert.rejects(()=>create(),/confirmed/);
await as(1);await assert.rejects(()=>create(512),/256/);

await as(null);await db.exec('set role anon');
for(const table of ['pixel_events','pixel_ballots','pixel_entries','pixel_participants','pixel_moderators','pixel_entry_reports','pixel_moderation_audit']){
 await assert.rejects(()=>db.query(`select * from public.${table} limit 1`),/permission denied/);
}
await assert.rejects(()=>db.query('select * from pixel_private.pixel_usage'),/permission denied/);
await assert.rejects(()=>rpc('pixel_event_snapshot_unmetered',[rooms[1]]),/permission denied/);
await db.exec('reset role');await as(1);await db.exec('set role authenticated');
await assert.rejects(()=>rpc('pixel_create_event',['Bypass','Legacy',32]),/permission denied/);
await db.exec('reset role');

const room=rooms[1];
await as(2);await rpc('pixel_join_event_v2',[room,'Guest',false]);
await as(3);await rpc('pixel_join_event_v2',[room,'Reader',false]);
await as(1);await rpc('pixel_advance_event',[room,'submissions']);
await as(2);
const frame=Array(1024).fill('#123456');
await assert.rejects(()=>rpc('pixel_submit_entry_v2',[room,'Guest','Too large',256,JSON.stringify([Array(65536).fill('#123456'),Array(65536).fill('#123456')]),6]),/65,536/);
await limit('room_art_bytes',10);
await assert.rejects(()=>rpc('pixel_submit_entry_v2',[room,'Guest','Full room',32,JSON.stringify([frame]),6]),/storage limit/);
await limit('room_art_bytes',8388608);
await rpc('pixel_submit_entry_v2',[room,'Guest','Safe entry',32,JSON.stringify([frame]),6]);
let first=await rpc('pixel_event_snapshot_delta',[room,null]);assert.equal(first.entries.length,1);
let second=await rpc('pixel_event_snapshot_delta',[room,first.art_version]);
assert.equal(second.art_unchanged,true);assert.equal('entries' in second,false);
assert.ok(JSON.stringify(second).length<JSON.stringify(first).length/2);
await as(3);let outsider=await rpc('pixel_event_snapshot_delta',[room,first.art_version]);
assert.equal(outsider.art_unchanged,false);assert.equal(outsider.entries.length,0);
await as(1);await rpc('pixel_update_event_settings_v5',[room,32,JSON.stringify({mode:'fixed',sizes:[32],min:1,max:1024}),'disabled',false,true,null,0,true,'auto',true,300]);
await as(3);outsider=await rpc('pixel_event_snapshot_delta',[room,outsider.art_version]);assert.equal(outsider.entries.length,1);
await as(1);await rpc('pixel_update_event_settings_v5',[room,32,JSON.stringify({mode:'fixed',sizes:[32],min:1,max:1024}),'disabled',false,false,null,0,true,'auto',true,300]);
await as(3);let hidden=await rpc('pixel_event_snapshot_delta',[room,outsider.art_version]);
assert.equal(hidden.art_unchanged,false);assert.deepEqual(hidden.entries,[]);

// Simulate the separate PostgREST pre-request call. It covers direct calls with
// rotating IPs, not merely the UI's retry delay. No external requests are made.
await db.exec("select set_config('request.path','/rpc/pixel_event_snapshot_delta',false);select set_config('request.method','GET',false);set role anon;");
await assert.rejects(()=>db.query('select pixel_private.pixel_api_guard()'),/Use POST/);
await db.exec('reset role');await limit('requests_per_day',3);
await db.exec("select set_config('request.method','POST',false)");
for(let i=0;i<3;i++){
 await db.query("select set_config('request.headers',$1,false)",[JSON.stringify({'x-forwarded-for':`198.51.100.${i}`})]);
 await db.query('select pixel_private.pixel_api_guard()');
}
await assert.rejects(()=>db.query('select pixel_private.pixel_api_guard()'),/Usage limit/);
await limit('read_bytes_per_day',1);await as(2);
await assert.rejects(()=>rpc('pixel_event_snapshot_delta',[room,null]),/Usage limit/);
assert.ok((await db.query('select count(*)::integer as amount from pixel_private.pixel_usage')).rows[0].amount<=10);
assert.deepEqual((await db.query("select rolconfig from pg_roles where rolname='authenticator'")).rows[0].rolconfig,['pgrst.db_pre_request=pixel_private.pixel_api_guard']);
await db.exec("select set_config('request.method','',false)");
await limit('new_accounts_per_day',1);
await assert.rejects(()=>db.query("update auth.users set raw_user_meta_data=$1 where id=$2",[JSON.stringify({bio:'x'.repeat(10000)}),uid(1)]),/metadata is too large/);
await db.exec("insert into auth.users(id,email_confirmed_at) values('00000000-0000-0000-0000-000000000004',null)");
await assert.rejects(()=>db.exec("insert into auth.users(id,email_confirmed_at) values('00000000-0000-0000-0000-000000000005',null)"),/Usage limit/);
await limit('new_accounts_per_day',100);await limit('total_accounts',4);
await assert.rejects(()=>db.exec("insert into auth.users(id,email_confirmed_at) values('00000000-0000-0000-0000-000000000005',null)"),/Registration is temporarily full/);
await as(3);assert.deepEqual(await rpc('pixel_my_ballot',[room]),[]);
await db.close();
console.log('PASS: room enumeration denied, private helpers inaccessible, creation/storage/request/transfer budgets enforced, rotating-IP guard, delta payload privacy and hook registration.');
