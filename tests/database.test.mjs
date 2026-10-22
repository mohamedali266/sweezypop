import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role;
create schema auth; create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
create function auth.role() returns text language sql as $$ select case when auth.uid() is null then 'anon' else 'authenticated' end $$;`);
const schema = (await readFile(new URL('../supabase/schema.sql',import.meta.url),'utf8')).replace('create extension if not exists pgcrypto;','');
await db.exec(schema);
await db.exec(`grant usage on schema public,auth to anon,authenticated; grant all on all tables in schema public to anon,authenticated;`);
for (const migration of ['202610140000_pre_pos_snapshot.sql','202610140001_order_integrity.sql','202610140002_catalog_changes.sql','202610140003_profile_changes.sql','202610160001_orders_workspace.sql','202610220001_staff_operations.sql']) {
  await db.exec(await readFile(new URL('../supabase/migrations/'+migration,import.meta.url),'utf8'));
}
const admin='00000000-0000-4000-8000-000000000001';
const owner='00000000-0000-4000-8000-000000000002';
const staff='00000000-0000-4000-8000-000000000003';
await db.exec(`insert into auth.users values ('${admin}'),('${owner}'),('${staff}');
insert into profiles(id,auth_user_id,restaurant_id,name,email,role) values
('admin','${admin}','sweezypop','Admin','admin@test.test','admin'),('owner','${owner}','sweezypop','Owner','owner@test.test','owner'),
('staff','${staff}','sweezypop','Kitchen','staff@test.test','staff');
insert into categories(id,restaurant_id,name_en,name_de) values ('food','sweezypop','Food','Speisen'),('offers','sweezypop','Offers','Angebote');
insert into menu_items(id,restaurant_id,category_id,name_en,name_de,price) values ('cake','sweezypop','food','Cake','Kuchen',6.50),('drink','sweezypop','food','Drink','Getränk',3);
insert into menu_items(id,restaurant_id,category_id,name_en,name_de,price,included_item_ids) values ('combo','sweezypop','offers','Combo','Kombi',8,array['cake','drink']);`);
after(() => db.close());
let saved;
const key = '00000000-0000-4000-8000-000000000010';
const place = async (requestKey=key,lines=[{id:'cake',quantity:2}],source='menu',clientToken='test-client-main-0001') =>
  (await db.query('select place_order($1,$2,$3,$4,$5::jsonb,$6,$7) as result',['sweezypop',requestKey,'Anna','Ohne Sahne',JSON.stringify(lines),source,clientToken])).rows[0].result;
test('atomic order, server prices, snapshots and unique number', async () => {
  saved=await place(key,[{id:'cake',quantity:2,price:0.01}]);
  assert.equal(saved.total,13);
  assert.equal(saved.lines[0].name_de,'Kuchen');
  assert.ok(saved.order_number);
});
test('idempotent retries return the exact existing order; changed requests rejected',async () => {
  assert.equal((await place(key,[{id:'cake',quantity:2,price:0.01}])).id,saved.id);
  await assert.rejects(place(key,[{id:'cake',quantity:3}]),/Request key/);
});
test('invalid line rolls back the entire order',async () => {
  const before=(await db.query('select count(*)::int as n from orders')).rows[0].n;
  await assert.rejects(place(randomUUID(),[{id:'cake',quantity:1},{id:'missing',quantity:1}]),/unavailable/);
  assert.equal((await db.query('select count(*)::int as n from orders')).rows[0].n,before);
});
test('reject bad quantities, duplicate lines, empty name and anonymous POS',async () => {
  await assert.rejects(place(randomUUID(),[{id:'cake',quantity:-1}]),/quantity/);
  await assert.rejects(place(randomUUID(),[{id:'cake',quantity:1},{id:'cake',quantity:1}]),/Duplicate/);
  await assert.rejects(place(randomUUID(),undefined,'pos'),/Access denied/);
  await assert.rejects(db.query("select place_order('sweezypop',$1,'','', '[{\"id\":\"cake\",\"quantity\":1}]')",[randomUUID()]),/Invalid name/);
});
test('disabling a component permanently stops its offer; server refuses it',async () => {
  await db.exec("update menu_items set available=false where id='drink'");
  assert.equal((await db.query("select available from menu_items where id='combo'")).rows[0].available,false);
  await assert.rejects(place(randomUUID(),[{id:'combo',quantity:1}]),/unavailable/);
  await db.exec("update menu_items set available=true where id='drink'");
  assert.equal((await db.query("select available from menu_items where id='combo'")).rows[0].available,false);
});
test('anonymous callers cannot read orders or bypass order creation',async () => {
  await db.exec('set role anon');
  try {
    assert.equal((await db.query('select * from orders')).rows.length,0);
    await assert.rejects(db.exec("insert into orders(id,restaurant_id,customer_name,phone,total) values ('bad','sweezypop','X','',1)"),/permission denied/);
    await assert.rejects(db.exec("update orders set total=0"),/permission denied/);
  } finally { await db.exec('reset role'); }
});
test('authorized POS and cancellation, audit log, terminal state protected',async () => {
  await db.query("select set_config('test.uid',$1,false)",[admin]);
  const pos=await place(randomUUID(),undefined,'pos');
  await db.query("select set_order_status($1,'new','cancelled')",[pos.id]);
  assert.equal((await db.query('select status from orders where id=$1',[pos.id])).rows[0].status,'cancelled');
  assert.equal((await db.query('select count(*)::int n from order_events where order_id=$1',[pos.id])).rows[0].n,1);
  await assert.rejects(db.query("select set_order_status($1,'cancelled','new')",[pos.id]),/Invalid status/);
});
test('menu rate limits are atomic per client while idempotent retries remain available',async () => {
  await db.query("select set_config('test.uid','',false)");
  const token='rate-limit-client-0001';
  for(let index=0;index<6;index+=1) await place(randomUUID(),[{id:'drink',quantity:1}],'menu',token);
  await assert.rejects(place(randomUUID(),[{id:'drink',quantity:1}],'menu',token),/Rate limit exceeded/);
  const retryKey=randomUUID();
  const otherToken='rate-limit-client-0002';
  const first=await place(retryKey,[{id:'drink',quantity:1}],'menu',otherToken);
  assert.equal((await place(retryKey,[{id:'drink',quantity:1}],'menu',otherToken)).id,first.id);
});
test('staff need an open shift and can only advance orders through the kitchen workflow',async () => {
  await db.query("select set_config('test.uid',$1,false)",[staff]);
  await assert.rejects(db.query('select get_staff_order_board()'),/Active shift required/);
  const shift=(await db.query('select start_staff_shift() result')).rows[0].result;
  assert.equal(shift.status,'open');
  assert.equal((await db.query('select start_staff_shift() result')).rows[0].result.id,shift.id);
  const order=await place(randomUUID(),[{id:'drink',quantity:1}],'menu','staff-flow-client-0001');
  const board=(await db.query('select get_staff_order_board() result')).rows[0].result;
  assert.ok(board.some(row=>row.id===order.id));
  for(const [from,to] of [['new','accepted'],['accepted','preparing'],['preparing','ready'],['ready','done']]) {
    await db.query('select set_staff_order_status($1,$2,$3)',[order.id,from,to]);
  }
  assert.equal((await db.query('select status from orders where id=$1',[order.id])).rows[0].status,'done');
  const ended=(await db.query('select end_staff_shift() result')).rows[0].result;
  assert.equal(ended.orders_handled,1);
  await assert.rejects(db.query('select set_staff_order_status($1,$2,$3)',[saved.id,'new','accepted']),/Active staff shift required/);
});
test('owners can edit existing staff but cannot change roles or create profiles',async () => {
  await db.query("select set_config('test.uid',$1,false)",[owner]);
  await db.query("select update_staff_member('staff','Prep','true','drinks')");
  const changed=(await db.query("select name,station,role from profiles where id='staff'")).rows[0];
  assert.deepEqual(changed,{name:'Prep',station:'drinks',role:'staff'});
  await assert.rejects(db.query("select save_profile_changes('sweezypop','[]')"),/Access denied/);
  await db.query("select set_config('test.uid',$1,false)",[admin]);
});
test('catalog writes are targeted, optimistic and atomic',async () => {
  const before={id:'cake',restaurant_id:'sweezypop',price:6.5};
  const changes=[{table:'menu_items',id:'cake',before,after:{...before,price:7,category_id:'food'}}];
  await db.query("select save_catalog_changes('sweezypop',$1)",[JSON.stringify(changes)]);
  await assert.rejects(db.query("select save_catalog_changes('sweezypop',$1)",[JSON.stringify(changes)]),/Data changed/);
  assert.equal((await db.query("select unit_price from order_lines where order_id=$1",[saved.id])).rows[0].unit_price,'6.50');
  assert.equal((await db.query("select name_de from order_lines where order_id=$1",[saved.id])).rows[0].name_de,'Kuchen');
  const bad=[{table:'menu_items',id:'cake',before:{id:'cake',price:7},after:{...before,price:9,category_id:'food'}},{table:'orders',id:'bad',before:null,after:{id:'bad'}}];
  await assert.rejects(db.query("select save_catalog_changes('sweezypop',$1)",[JSON.stringify(bad)]),/Invalid entity/);
  assert.equal((await db.query("select price from menu_items where id='cake'")).rows[0].price,'7.00');
});
test('owner cannot alter roles; temporary-password profiles cannot use POS',async () => {
  await db.query("select set_config('test.uid',$1,false)",[owner]);
  await assert.rejects(db.query("select save_profile_changes('sweezypop','[]')"),/Access denied/);
  await db.exec("update profiles set must_change_password=true where id='owner'");
  await assert.rejects(place(randomUUID(),undefined,'pos'),/Access denied/);
  await db.query("select set_config('test.uid',$1,false)",[admin]);
});
test('deleting a product keeps historical snapshots and disables offers',async () => {
  await db.exec("update menu_items set available=true where id='combo'");
  await db.exec("delete from menu_items where id='cake'");
  assert.equal((await db.query("select available from menu_items where id='combo'")).rows[0].available,false);
  const line=(await db.query('select * from order_lines where order_id=$1',[saved.id])).rows[0];
  assert.equal(line.menu_item_id,null); assert.equal(line.name_de,'Kuchen');
});
test('order workspace is paginated, searchable and excludes cancelled revenue',async () => {
  await db.query("select set_config('test.uid',$1,false)",[admin]);
  const page=(await db.query("select get_order_page('all','Anna','','',null,null,1,1) result")).rows[0].result;
  assert.equal(page.page_size,1); assert.ok(page.total>=1); assert.equal(page.rows.length,1);
  const stats=(await db.query('select get_order_workspace_stats() result')).rows[0].result;
  assert.equal(Number(stats.today_revenue)>=0,true);
  const cancelled=(await db.query("select coalesce(sum(total),0) total from orders where status='cancelled' and (created_at at time zone 'Europe/Berlin')::date=(now() at time zone 'Europe/Berlin')::date")).rows[0].total;
  const nonCancelled=(await db.query("select coalesce(sum(total),0) total from orders where status<>'cancelled' and (created_at at time zone 'Europe/Berlin')::date=(now() at time zone 'Europe/Berlin')::date")).rows[0].total;
  assert.equal(Number(stats.today_revenue),Number(nonCancelled)); assert.ok(Number(cancelled)>=0);
});
test('POS drafts are isolated to authenticated restaurant managers',async () => {
  await db.query("select set_config('test.uid',$1,false)",[admin]);
  const id=(await db.query("select save_pos_draft(null,'Anna','Later',$1::jsonb) id",[JSON.stringify([{id:'drink',quantity:2}])])).rows[0].id;
  const drafts=(await db.query('select list_pos_drafts() result')).rows[0].result;
  assert.equal(drafts[0].customer_name,'Anna');
  await db.query('select delete_pos_draft($1)',[id]);
  assert.equal((await db.query('select jsonb_array_length(list_pos_drafts()) n')).rows[0].n,0);
  await db.query("select set_config('test.uid','',false)");
  await assert.rejects(db.query('select list_pos_drafts()'),/Access denied/);
});
