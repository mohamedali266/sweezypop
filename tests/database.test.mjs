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
for (const migration of ['202610140000_pre_pos_snapshot.sql','202610140001_order_integrity.sql','202610140002_catalog_changes.sql','202610140003_profile_changes.sql','202610160001_orders_workspace.sql','202610220001_staff_operations.sql','202610230001_staff_three_stage_workflow.sql','202610230002_staff_cancel_new_orders.sql','202610270001_staff_guides.sql','202610280001_public_order_tracking.sql','202610280002_order_feedback.sql','202610280003_reviews_footer.sql','202610280004_reviews_security.sql','202610280005_staff_order_realtime_signal.sql','202611010001_staff_guide_images_and_order_push.sql','202611020001_cashier_operations.sql','202611040001_product_options.sql','202611040002_option_availability_guard.sql','202611040003_shared_product_options.sql','202611040004_size_base_price_guard.sql','202611040005_option_availability_integrity.sql','202611060003_verified_site_settings.sql','202611060004_public_menu_bootstrap.sql']) {
  await db.exec(await readFile(new URL('../supabase/migrations/'+migration,import.meta.url),'utf8'));
}
const admin='00000000-0000-4000-8000-000000000001';
const owner='00000000-0000-4000-8000-000000000002';
const staff='00000000-0000-4000-8000-000000000003';
const cashier='00000000-0000-4000-8000-000000000004';
await db.exec(`insert into auth.users values ('${admin}'),('${owner}'),('${staff}'),('${cashier}');
insert into profiles(id,auth_user_id,restaurant_id,name,email,role) values
('admin','${admin}','sweezypop','Admin','admin@test.test','admin'),('owner','${owner}','sweezypop','Owner','owner@test.test','owner'),
('staff','${staff}','sweezypop','Kitchen','staff@test.test','staff'),('cashier','${cashier}','sweezypop','Mia Cashier','cashier@test.test','cashier');
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
test('public tracking requires the private request key and returns immutable snapshots',async () => {
  const tracked=(await db.query('select get_public_order_tracking($1,$2) result',[saved.id,key])).rows[0].result;
  assert.equal(tracked.order_number,saved.order_number);
  assert.equal(tracked.status,'new');
  assert.equal(tracked.lines[0].name_de,'Kuchen');
  await assert.rejects(
    db.query('select get_public_order_tracking($1,$2)',[saved.id,randomUUID()]),
    /Order not found/,
  );
  for(let index=0;index<11;index+=1) await db.query('select get_public_order_tracking($1,$2)',[saved.id,key]);
  await assert.rejects(db.query('select get_public_order_tracking($1,$2)',[saved.id,key]),/Rate limit exceeded/);
});
test('customer receipt confirmation is capability-protected, ready-only and stores feedback',async () => {
  const feedbackKey=randomUUID();
  const order=await place(feedbackKey,[{id:'drink',quantity:1}],'menu','feedback-client-0001');
  await assert.rejects(
    db.query('select complete_public_order($1,$2,$3,$4)',[order.id,feedbackKey,5,'Great']),
    /not ready/,
  );
  await db.query("select set_config('test.uid',$1,false)",[admin]);
  await db.query("select set_order_status($1,'new','preparing')",[order.id]);
  await db.query("select set_order_status($1,'preparing','ready')",[order.id]);
  await db.query("select set_config('test.uid','',false)");
  await assert.rejects(
    db.query('select complete_public_order($1,$2,$3,$4)',[order.id,randomUUID(),5,'Great']),
    /Order not found/,
  );
  const completed=(await db.query('select complete_public_order($1,$2,$3,$4) result',[order.id,feedbackKey,5,'Great service'])).rows[0].result;
  assert.equal(completed.status,'done');
  assert.deepEqual((await db.query('select rating,feedback from order_feedback where order_id=$1',[order.id])).rows[0],{rating:5,feedback:'Great service'});
  assert.equal((await db.query("select count(*)::int n from order_events where order_id=$1 and previous_status='ready' and next_status='done'",[order.id])).rows[0].n,1);
});
test('review moderation is manager controlled and footer content is admin only',async () => {
  const feedback=(await db.query("select id from order_feedback where feedback='Great service'")).rows[0];
  await db.query("select set_config('test.uid',$1,false)",[owner]);
  await db.query('select set_review_visibility($1,true)',[feedback.id]);
  await db.query('select set_reviews_section_visibility(true)');
  const ownerView=(await db.query('select get_review_management() result')).rows[0].result;
  assert.equal(ownerView.reviews.find(review=>review.id===feedback.id).visible,true);
  await assert.rejects(db.query("select save_footer_content('Owner edit','Owner edit')"),/Access denied/);
  await db.exec("update profiles set must_change_password=true where id='owner'");
  await assert.rejects(db.query('select get_review_management()'),/Access denied/);
  await db.exec("update profiles set must_change_password=false where id='owner'");

  await db.query("select set_config('test.uid',$1,false)",[admin]);
  await db.query("select save_footer_content('© 2026 Test. All rights reserved.','© 2026 Test. Alle Rechte vorbehalten.')");
  const adminView=(await db.query('select get_review_management() result')).rows[0].result;
  assert.equal(adminView.footer_copyright_en,'© 2026 Test. All rights reserved.');

  await db.query("select set_config('test.uid','',false)");
  const publicReviews=(await db.query("select get_public_reviews('sweezypop',16) result")).rows[0].result;
  assert.equal(publicReviews.length,1);
  assert.equal(publicReviews[0].display_name,'Anna');
  assert.equal(publicReviews[0].feedback,'Great service');
  await db.query("select set_config('test.uid','',false)");
});

test('site branding save is atomic, verified and manager only',async () => {
  const settings={
    name:'Sweezy pop',logo_text:'Sweezy pop',logo_url:'https://assets.test/website.svg',
    app_icon_url:'https://assets.test/app.png',favicon_url:'https://assets.test/favicon.png',menu_url:'https://menu.test',
    primary_color:'#aa22cc',accent_color:'#22aa99',lavender_color:'#bb99ee',background_color:'#fff7fb',
    surface_color:'#ffffff',text_color:'#211b33',muted_text_color:'#756a80',button_text_color:'#ffffff',
    card_color:'#ffffff',border_color:'#eadff0',social_links:[],phone_country_code:'+49',phone_number:'12345',
  };
  await db.query("select set_config('test.uid',$1,false)",[owner]);
  const savedSettings=(await db.query('select save_site_settings($1::jsonb,$2) result',[JSON.stringify(settings),'grid'])).rows[0].result;
  assert.equal(savedSettings.logo_url,settings.logo_url);
  assert.equal(savedSettings.app_icon_url,settings.app_icon_url);
  assert.equal(savedSettings.favicon_url,settings.favicon_url);
  assert.deepEqual((await db.query('select logo_url,app_icon_url,favicon_url from restaurants where id=$1',['sweezypop'])).rows[0],{
    logo_url:settings.logo_url,app_icon_url:settings.app_icon_url,favicon_url:settings.favicon_url,
  });
  await db.query("select set_config('test.uid',$1,false)",[staff]);
  await assert.rejects(db.query('select save_site_settings($1::jsonb,$2)',[JSON.stringify(settings),'grid']),/Access denied/);
});

test('public menu bootstrap returns the complete menu in one safe payload',async () => {
  await db.query("select set_config('test.uid','',false)");
  const payload=(await db.query("select get_public_menu_bootstrap('sweezypop') result")).rows[0].result;
  assert.equal(payload.restaurant.id,'sweezypop');
  assert.equal(payload.categories.length,2);
  assert.equal(payload.items.length,3);
  assert.equal(payload.items.some(item=>item.name_en==='Cake'),true);
  assert.equal(Object.hasOwn(payload.items[0],'prep_ingredients_en'),false);
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
  const signalBefore=Number((await db.query("select revision from staff_order_signals where restaurant_id='sweezypop'")).rows[0].revision);
  const order=await place(randomUUID(),[{id:'drink',quantity:1}],'menu','staff-flow-client-0001');
  const signalAfter=Number((await db.query("select revision from staff_order_signals where restaurant_id='sweezypop'")).rows[0].revision);
  assert.ok(signalAfter>signalBefore);
  const board=(await db.query('select get_staff_order_board() result')).rows[0].result;
  assert.ok(board.some(row=>row.id===order.id));
  for(const [from,to] of [['new','preparing'],['preparing','ready'],['ready','done']]) {
    await db.query('select set_staff_order_status($1,$2,$3)',[order.id,from,to]);
  }
  assert.equal((await db.query('select status from orders where id=$1',[order.id])).rows[0].status,'done');
  const timings=(await db.query('select accepted_at,preparing_at from orders where id=$1',[order.id])).rows[0];
  assert.ok(timings.accepted_at);
  assert.ok(timings.preparing_at);
  const cancelled=await place(randomUUID(),[{id:'drink',quantity:1}],'menu','staff-cancel-client-0001');
  await db.query('select set_staff_order_status($1,$2,$3)',[cancelled.id,'new','cancelled']);
  assert.equal((await db.query('select status from orders where id=$1',[cancelled.id])).rows[0].status,'cancelled');
  assert.equal((await db.query('select count(*)::int n from order_events where order_id=$1 and previous_status=$2 and next_status=$3',[cancelled.id,'new','cancelled'])).rows[0].n,1);
  assert.ok(!(await db.query('select get_staff_order_board() result')).rows[0].result.some(row=>row.id===cancelled.id));
  const ended=(await db.query('select end_staff_shift() result')).rows[0].result;
  assert.equal(ended.orders_handled,1);
  await assert.rejects(db.query('select set_staff_order_status($1,$2,$3)',[saved.id,'new','preparing']),/Active staff shift required/);
});
test('owners can edit existing staff but cannot change roles or create profiles',async () => {
  await db.query("select set_config('test.uid',$1,false)",[owner]);
  await db.query("select update_staff_member('staff','Prep','true','drinks')");
  const changed=(await db.query("select name,station,role from profiles where id='staff'")).rows[0];
  assert.deepEqual(changed,{name:'Prep',station:'drinks',role:'staff'});
  await assert.rejects(db.query("select save_profile_changes('sweezypop','[]')"),/Access denied/);
  await db.query("select set_config('test.uid',$1,false)",[admin]);
});
test('cashier register uses trusted sales, immutable partial transfers and carries the closing balance',async () => {
  await db.query("select set_config('test.uid',$1,false)",[cashier]);
  await assert.rejects(db.query('select get_cashier_workspace()'),/Open register required/);
  const opened=(await db.query('select open_cashier_shift() result')).rows[0].result;
  assert.equal(Number(opened.opening_balance),0);
  const sale=await place(randomUUID(),[{id:'drink',quantity:2}],'pos');
  await db.query("select set_config('test.uid',$1,false)",[admin]);
  await db.query("select set_order_status($1,'new','preparing')",[sale.id]);
  await db.query("select set_order_status($1,'preparing','ready')",[sale.id]);
  await db.query("select set_config('test.uid',$1,false)",[cashier]);
  await db.query("select set_cashier_order_status($1,'ready','done')",[sale.id]);
  let workspace=(await db.query('select get_cashier_workspace() result')).rows[0].result;
  assert.equal(Number(workspace.shift.sales_total),6);
  assert.equal(Number(workspace.shift.expected_cash),6);
  const transfer=(await db.query('select create_cash_transfer(2.50) result')).rows[0].result;
  assert.equal(transfer.transfer.employee_name,'Mia Cashier');
  assert.ok(transfer.transfer.created_at);
  assert.equal(Number(transfer.shift.expected_cash),3.5);
  await db.exec('set role authenticated');
  try {
    await assert.rejects(db.query('update cash_transfers set amount=1'),/permission denied/);
    await assert.rejects(db.query('delete from cash_transfers'),/permission denied/);
  } finally { await db.exec('reset role'); }
  const closed=(await db.query('select close_cashier_shift() result')).rows[0].result;
  assert.equal(Number(closed.expected_cash),3.5);
  assert.equal(Number((await db.query('select get_cashier_opening_balance() balance')).rows[0].balance),3.5);
  const reopened=(await db.query('select open_cashier_shift() result')).rows[0].result;
  assert.equal(Number(reopened.opening_balance),3.5);
  workspace=(await db.query('select get_cashier_workspace() result')).rows[0].result;
  assert.equal(Number(workspace.shift.expected_cash),3.5);
  const cancelled=await place(randomUUID(),[{id:'drink',quantity:1}],'pos');
  await db.query("select set_cashier_order_status($1,'new','cancelled')",[cancelled.id]);
  workspace=(await db.query('select get_cashier_workspace() result')).rows[0].result;
  assert.equal(Number(workspace.shift.sales_total),0);
  assert.equal(Number(workspace.shift.expected_cash),3.5);
  await db.query('select create_cash_transfer(3.50)');
  await db.query('select close_cashier_shift()');
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

test('staff guides are manager-controlled, shift-gated and optimistic',async () => {
  await db.query("select set_config('test.uid',$1,false)",[admin]);
  const created=(await db.query(
    "select save_staff_guide(null,'drink','https://images.test/drink.webp','Drink','Getränk',$1,$2,$3,$4,null) result",
    [['Milk'],['Milch'],['Mix'],['Mischen']],
  )).rows[0].result;
  assert.equal(created.menu_item_id,'drink');
  assert.equal(created.image_url,'https://images.test/drink.webp');
  await assert.rejects(
    db.query("select save_staff_guide(null,'drink',null,'Duplicate','Doppelt',$1,$2,$3,$4,null)",[['x'],['x'],['x'],['x']]),
    /already has/,
  );
  assert.equal((await db.query('select jsonb_array_length(get_staff_guides()) n')).rows[0].n,1);

  const updated=(await db.query(
    "select save_staff_guide($1,'drink',null,'Cold drink','Kaltes Getränk',$2,$3,$4,$5,$6) result",
    [created.id,['Milk'],['Milch'],['Mix cold'],['Kalt mischen'],created.updated_at],
  )).rows[0].result;
  await assert.rejects(
    db.query("select save_staff_guide($1,'drink',null,'Stale','Veraltet',$2,$3,$4,$5,$6)",[created.id,['Milk'],['Milch'],['Mix'],['Mischen'],created.updated_at]),
    /Guide changed/,
  );

  await db.query("select set_config('test.uid',$1,false)",[staff]);
  await assert.rejects(db.query('select get_staff_guides()'),/Active shift required/);
  await db.query('select start_staff_shift()');
  assert.equal((await db.query('select jsonb_array_length(get_staff_guides()) n')).rows[0].n,1);
  await assert.rejects(
    db.query("select save_staff_guide(null,null,null,'Bad','Nicht erlaubt',$1,$2,$3,$4,null)",[['x'],['x'],['x'],['x']]),
    /Access denied/,
  );
  await db.query('select end_staff_shift()');

  await db.query("select set_config('test.uid',$1,false)",[admin]);
  await db.query('select delete_staff_guide($1,$2)',[updated.id,updated.updated_at]);
  assert.equal((await db.query('select jsonb_array_length(get_staff_guides()) n')).rows[0].n,0);
});

test('push subscriptions require the private tracking key and are isolated by order',async () => {
  await db.query("select set_config('test.uid','',false)");
  const pushKey=randomUUID();
  const order=await place(pushKey,[{id:'drink',quantity:1}],'menu','push-client-0001');
  const subscription={endpoint:'https://push.example.test/subscriptions/customer-1',keys:{p256dh:'A'.repeat(80),auth:'B'.repeat(24)}};
  await assert.rejects(
    db.query('select register_order_push($1,$2,$3::jsonb,$4)',[order.id,randomUUID(),JSON.stringify(subscription),'de']),
    /Order tracking not found/,
  );
  await db.query('select register_order_push($1,$2,$3::jsonb,$4)',[order.id,pushKey,JSON.stringify(subscription),'en']);
  const savedSubscription=(await db.query('select order_id,locale from order_push_subscriptions where order_id=$1',[order.id])).rows[0];
  assert.deepEqual(savedSubscription,{order_id:order.id,locale:'en'});
});

test('product options enforce required choices, trusted modifiers and immutable labels',async()=>{
  const groups=[{id:'size',name:{en:'Size',de:'Größe'},mode:'single',required:true,min:1,max:1,options:[
    {id:'small',name:{en:'Small',de:'Klein'},priceDelta:0,available:true},
    {id:'large',name:{en:'Large',de:'Groß'},priceDelta:2.5,available:true},
  ]},{id:'toppings',name:{en:'Toppings',de:'Extras'},mode:'multiple',required:false,min:0,max:2,options:[
    {id:'lotus',name:{en:'Lotus',de:'Lotus'},priceDelta:1,available:true},
    {id:'chocolate',name:{en:'Chocolate',de:'Schokolade'},priceDelta:.5,available:true},
  ]}];
  await db.query('update menu_items set option_groups=$1::jsonb where id=$2',[JSON.stringify(groups),'drink']);
  const selected=[{groupId:'size',optionIds:['large']},{groupId:'toppings',optionIds:['lotus']}];
  const order=await place(randomUUID(),[{id:'drink',quantity:2,selections:selected,price:.01}],'menu','options-client-0001');
  assert.equal(order.total,13);
  assert.match(order.lines[0].name_de,/Groß.*Lotus/);
  await assert.rejects(place(randomUUID(),[{id:'drink',quantity:1,selections:[]}],'menu','options-client-0002'),/Option selection limit/);
  await assert.rejects(place(randomUUID(),[{id:'drink',quantity:1,selections:[{groupId:'size',optionIds:['fake']}]}],'menu','options-client-0003'),/Option unavailable/);
  await assert.rejects(place(randomUUID(),[{id:'drink',quantity:1,selections:[{groupId:'size',optionIds:['small']},{groupId:'toppings',optionIds:['lotus','chocolate','fake']}]}],'menu','options-client-0004'),/Option selection limit/);
  await db.query("update menu_items set option_groups='[]'::jsonb where id='drink'");
});

test('product sizes use final server prices and reusable groups link by category',async()=>{
  const sizes=[
    {id:'regular',name:{en:'Regular',de:'Normal'},price:3,available:true},
    {id:'large',name:{en:'Large',de:'Groß'},price:5.5,available:true},
  ];
  const options=[{id:'cream',name:{en:'Cream',de:'Sahne'},priceDelta:1.25,available:true}];
  await db.query('update menu_items set sizes=$1::jsonb,price=3 where id=$2',[JSON.stringify(sizes),'drink']);
  await db.query("insert into product_option_groups(id,restaurant_id,name_en,name_de,mode,required,min_select,max_select,options,linked_category_ids) values ('extras','sweezypop','Extras','Extras','multiple',false,0,2,$1::jsonb,array['food'])",[JSON.stringify(options)]);
  const selections=[{groupId:'__size__',optionIds:['large']},{groupId:'extras',optionIds:['cream']}];
  const order=await place(randomUUID(),[{id:'drink',quantity:2,selections,price:.01}],'menu','shared-options-client-0001');
  assert.equal(order.total,13.5);
  assert.match(order.lines[0].name_de,/Groß.*Sahne/);
  await assert.rejects(place(randomUUID(),[{id:'drink',quantity:1,selections:[{groupId:'extras',optionIds:['cream']}]}],'menu','shared-options-client-0002'),/Option selection limit/);
  await assert.rejects(db.query("update menu_items set price=4 where id='drink'"),/size_base_price/);
  await assert.rejects(db.query("update product_option_groups set options='[{\"id\":\"cream\",\"name\":{\"en\":\"Cream\",\"de\":\"Sahne\"},\"priceDelta\":1.25,\"available\":false}]'::jsonb where id='extras'"),/active_option/);
  await db.exec("update product_option_groups set active=false where id='extras'; update menu_items set sizes='[]'::jsonb where id='drink'");
});
