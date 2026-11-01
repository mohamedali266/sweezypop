begin;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin','owner','staff','cashier'));

create table if not exists public.cashier_shifts (
  id uuid primary key default gen_random_uuid(),
  restaurant_id text not null references public.restaurants(id) on delete cascade,
  cashier_profile_id text not null references public.profiles(id) on delete restrict,
  auth_user_id uuid not null,
  cashier_name text not null,
  status text not null default 'open' check (status in ('open','closed','force_closed')),
  opening_balance numeric(12,2) not null default 0 check (opening_balance >= 0),
  sales_total numeric(12,2) not null default 0 check (sales_total >= 0),
  transfers_total numeric(12,2) not null default 0 check (transfers_total >= 0),
  closing_balance numeric(12,2) check (closing_balance is null or closing_balance >= 0),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by uuid,
  constraint cashier_shift_end_consistency check (
    (status = 'open' and ended_at is null and closing_balance is null)
    or (status <> 'open' and ended_at is not null and closing_balance is not null)
  )
);

create unique index if not exists cashier_one_open_register_per_restaurant
  on public.cashier_shifts(restaurant_id) where status='open';
create index if not exists cashier_shifts_profile_started
  on public.cashier_shifts(cashier_profile_id,started_at desc);

create table if not exists public.cash_transfers (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.cashier_shifts(id) on delete restrict,
  restaurant_id text not null references public.restaurants(id) on delete restrict,
  cashier_profile_id text not null references public.profiles(id) on delete restrict,
  employee_name text not null,
  amount numeric(12,2) not null check (amount > 0),
  created_at timestamptz not null default now()
);
create index if not exists cash_transfers_shift_created on public.cash_transfers(shift_id,created_at desc);

alter table public.cashier_shifts enable row level security;
alter table public.cash_transfers enable row level security;
revoke all on public.cashier_shifts,public.cash_transfers from anon,authenticated;

create or replace function public.has_open_cashier_shift(target_restaurant_id text)
returns boolean language sql security definer set search_path=public stable as $$
  select exists(
    select 1 from public.cashier_shifts
    where restaurant_id=target_restaurant_id and auth_user_id=auth.uid() and status='open'
  )
$$;
revoke all on function public.has_open_cashier_shift(text) from public,anon,authenticated;

create or replace function public.cashier_shift_snapshot(p_shift_id uuid)
returns jsonb language plpgsql security definer set search_path=public stable as $$
declare s public.cashier_shifts; sales numeric(12,2); transferred numeric(12,2); expected numeric(12,2);
begin
  select * into s from public.cashier_shifts where id=p_shift_id;
  if not found then raise exception 'Cashier shift not found'; end if;
  select coalesce(sum(o.total),0) into sales from public.orders o
    where o.restaurant_id=s.restaurant_id and o.status='done' and o.completed_at>=s.started_at
      and o.completed_at<=coalesce(s.ended_at,now());
  select coalesce(sum(t.amount),0) into transferred from public.cash_transfers t where t.shift_id=s.id;
  expected := greatest(s.opening_balance+sales-transferred,0);
  return jsonb_build_object(
    'id',s.id,'status',s.status,'cashier_profile_id',s.cashier_profile_id,'cashier_name',s.cashier_name,
    'started_at',s.started_at,'ended_at',s.ended_at,'opening_balance',s.opening_balance,
    'sales_total',case when s.status='open' then sales else s.sales_total end,
    'transfers_total',case when s.status='open' then transferred else s.transfers_total end,
    'expected_cash',case when s.status='open' then expected else s.closing_balance end
  );
end $$;
revoke all on function public.cashier_shift_snapshot(uuid) from public,anon,authenticated;

create or replace function public.close_cashier_shift_on_profile_change()
returns trigger language plpgsql security definer set search_path=public as $$
declare s public.cashier_shifts; snapshot jsonb;
begin
  if old.role='cashier' and old.active and (not new.active or new.role<>'cashier') then
    for s in select * from public.cashier_shifts where cashier_profile_id=old.id and status='open' for update loop
      snapshot:=public.cashier_shift_snapshot(s.id);
      update public.cashier_shifts set status='force_closed',ended_at=now(),ended_by=auth.uid(),
        sales_total=(snapshot->>'sales_total')::numeric,transfers_total=(snapshot->>'transfers_total')::numeric,
        closing_balance=(snapshot->>'expected_cash')::numeric where id=s.id;
    end loop;
  end if;
  return new;
end $$;
revoke all on function public.close_cashier_shift_on_profile_change() from public;
drop trigger if exists close_cashier_shift_when_profile_changes on public.profiles;
create trigger close_cashier_shift_when_profile_changes after update of active,role on public.profiles
for each row execute function public.close_cashier_shift_on_profile_change();

create or replace function public.open_cashier_shift()
returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.profiles; s public.cashier_shifts; previous_balance numeric(12,2):=0;
begin
  select * into p from public.current_active_profile();
  if p.id is null or p.role<>'cashier' then raise exception 'Active cashier profile required'; end if;
  perform public.consume_rate_limit('cashier:open:'||auth.uid()::text,10,60);
  perform pg_advisory_xact_lock(hashtextextended('cashier-register:'||p.restaurant_id,0));
  select * into s from public.cashier_shifts where restaurant_id=p.restaurant_id and status='open' for update;
  if found then
    if s.auth_user_id<>auth.uid() then raise exception 'Register is already open by another cashier'; end if;
    return public.cashier_shift_snapshot(s.id);
  end if;
  select coalesce(closing_balance,0) into previous_balance from public.cashier_shifts
    where restaurant_id=p.restaurant_id and status in ('closed','force_closed') order by ended_at desc limit 1;
  previous_balance:=coalesce(previous_balance,0);
  insert into public.cashier_shifts(restaurant_id,cashier_profile_id,auth_user_id,cashier_name,opening_balance)
    values(p.restaurant_id,p.id,auth.uid(),p.name,previous_balance) returning * into s;
  return public.cashier_shift_snapshot(s.id);
end $$;

create or replace function public.get_current_cashier_shift()
returns jsonb language plpgsql security definer set search_path=public stable as $$
declare p public.profiles; s public.cashier_shifts;
begin
  select * into p from public.current_active_profile();
  if p.id is null or p.role<>'cashier' then raise exception 'Active cashier profile required'; end if;
  select * into s from public.cashier_shifts where auth_user_id=auth.uid() and status='open' order by started_at desc limit 1;
  if not found then return null; end if;
  return public.cashier_shift_snapshot(s.id);
end $$;

create or replace function public.get_cashier_opening_balance()
returns numeric language plpgsql security definer set search_path=public stable as $$
declare p public.profiles; previous_balance numeric(12,2):=0;
begin
  select * into p from public.current_active_profile();
  if p.id is null or p.role<>'cashier' then raise exception 'Active cashier profile required'; end if;
  select coalesce(closing_balance,0) into previous_balance from public.cashier_shifts
    where restaurant_id=p.restaurant_id and status in ('closed','force_closed') order by ended_at desc limit 1;
  return coalesce(previous_balance,0);
end $$;

create or replace function public.get_cashier_workspace()
returns jsonb language plpgsql security definer set search_path=public stable as $$
declare p public.profiles; s public.cashier_shifts; board jsonb; transfers jsonb;
  completed_count integer; revenue numeric(12,2); cancelled_count integer; active_count integer;
begin
  select * into p from public.current_active_profile();
  if p.id is null or p.role<>'cashier' then raise exception 'Active cashier profile required'; end if;
  select * into s from public.cashier_shifts where auth_user_id=auth.uid() and status='open' order by started_at desc limit 1;
  if not found then raise exception 'Open register required'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',o.id,'order_number',o.order_number,'source',o.source,'customer_name',o.customer_name,'notes',o.notes,
    'total',o.total,'status',o.status,'created_at',o.created_at,
    'lines',coalesce((select jsonb_agg(jsonb_build_object('id',l.menu_item_id,'name_en',coalesce(l.name_en,'Historical item'),
      'name_de',coalesce(l.name_de,'Archivierter Artikel'),'price',l.unit_price,'quantity',l.quantity) order by l.id)
      from public.order_lines l where l.order_id=o.id),'[]'::jsonb)
  ) order by case o.status when 'ready' then 0 when 'preparing' then 1 else 2 end,o.created_at),'[]'::jsonb)
  into board from public.orders o where o.restaurant_id=p.restaurant_id and o.status in ('new','accepted','preparing','ready');
  select count(*)::integer,coalesce(sum(total),0) into completed_count,revenue from public.orders
    where restaurant_id=p.restaurant_id and status='done'
      and (completed_at at time zone 'Europe/Berlin')::date=(now() at time zone 'Europe/Berlin')::date;
  select count(*)::integer into cancelled_count from public.orders where restaurant_id=p.restaurant_id and status='cancelled'
    and (created_at at time zone 'Europe/Berlin')::date=(now() at time zone 'Europe/Berlin')::date;
  select count(*)::integer into active_count from public.orders where restaurant_id=p.restaurant_id and status in ('new','accepted','preparing','ready');
  select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'shift_id',t.shift_id,'employee_name',t.employee_name,
    'amount',t.amount,'created_at',t.created_at) order by t.created_at desc),'[]'::jsonb)
    into transfers from public.cash_transfers t where t.shift_id=s.id;
  return jsonb_build_object('shift',public.cashier_shift_snapshot(s.id),'orders',board,'transfers',transfers,
    'completed_today',completed_count,'revenue_today',revenue,'cancelled_today',cancelled_count,'active_orders',active_count);
end $$;

create or replace function public.create_cash_transfer(p_amount numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.profiles; s public.cashier_shifts; snapshot jsonb; expected numeric(12,2); transfer public.cash_transfers;
begin
  select * into p from public.current_active_profile();
  if p.id is null or p.role<>'cashier' then raise exception 'Active cashier profile required'; end if;
  perform public.consume_rate_limit('cashier:transfer:'||auth.uid()::text,20,60);
  select * into s from public.cashier_shifts where auth_user_id=auth.uid() and status='open' for update;
  if not found then raise exception 'Open register required'; end if;
  if p_amount is null or p_amount<=0 or p_amount<>round(p_amount,2) then raise exception 'Invalid transfer amount'; end if;
  snapshot:=public.cashier_shift_snapshot(s.id); expected:=(snapshot->>'expected_cash')::numeric;
  if p_amount>expected then raise exception 'Transfer exceeds expected cash'; end if;
  insert into public.cash_transfers(shift_id,restaurant_id,cashier_profile_id,employee_name,amount)
    values(s.id,p.restaurant_id,p.id,p.name,p_amount) returning * into transfer;
  return jsonb_build_object('transfer',jsonb_build_object('id',transfer.id,'shift_id',transfer.shift_id,
    'employee_name',transfer.employee_name,'amount',transfer.amount,'created_at',transfer.created_at),
    'shift',public.cashier_shift_snapshot(s.id));
end $$;

create or replace function public.close_cashier_shift()
returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.profiles; s public.cashier_shifts; snapshot jsonb; expected numeric(12,2); sales numeric(12,2); transferred numeric(12,2);
begin
  select * into p from public.current_active_profile();
  if p.id is null or p.role<>'cashier' then raise exception 'Active cashier profile required'; end if;
  perform public.consume_rate_limit('cashier:close:'||auth.uid()::text,10,60);
  select * into s from public.cashier_shifts where auth_user_id=auth.uid() and status='open' for update;
  if not found then raise exception 'Open register required'; end if;
  snapshot:=public.cashier_shift_snapshot(s.id);
  expected:=(snapshot->>'expected_cash')::numeric; sales:=(snapshot->>'sales_total')::numeric;
  transferred:=(snapshot->>'transfers_total')::numeric;
  if expected>0 and transferred=0 then raise exception 'Cash transfer required before closing'; end if;
  update public.cashier_shifts set status='closed',ended_at=now(),ended_by=auth.uid(),sales_total=sales,
    transfers_total=transferred,closing_balance=expected where id=s.id returning * into s;
  return public.cashier_shift_snapshot(s.id);
end $$;

create or replace function public.set_cashier_order_status(p_id text,p_expected text,p_status text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.profiles; o public.orders; changed_at timestamptz:=now();
begin
  select * into p from public.current_active_profile();
  if p.id is null or p.role<>'cashier' or not public.has_open_cashier_shift(p.restaurant_id) then
    raise exception 'Open register required'; end if;
  perform public.consume_rate_limit('cashier:order-status:'||auth.uid()::text,120,60);
  select * into o from public.orders where id=p_id and restaurant_id=p.restaurant_id for update;
  if not found then raise exception 'Order not found'; end if;
  if o.status is distinct from p_expected then raise exception 'Order changed. Refresh and retry.'; end if;
  if not ((o.status='ready' and p_status='done') or (o.status='new' and p_status='cancelled')) then
    raise exception 'Invalid status transition'; end if;
  update public.orders set status=p_status,
    completed_at=case when p_status='done' then coalesce(completed_at,changed_at) else completed_at end where id=p_id;
  insert into public.order_events(order_id,actor,previous_status,next_status) values(p_id,auth.uid(),o.status,p_status);
  return jsonb_build_object('id',p_id,'status',p_status);
end $$;

create or replace function public.can_operate_pos(target_restaurant_id text)
returns boolean language sql security definer set search_path=public stable as $$
  select public.can_manage_restaurant(target_restaurant_id) or exists(
    select 1 from public.profiles p where p.auth_user_id=auth.uid() and p.active
      and not coalesce(p.must_change_password,false) and p.role='cashier' and p.restaurant_id=target_restaurant_id
      and public.has_open_cashier_shift(target_restaurant_id)
  )
$$;
revoke all on function public.can_operate_pos(text) from public,anon,authenticated;

drop function if exists public.place_order(text,uuid,text,text,jsonb,text,text);
create or replace function public.place_order(
  p_slug text,p_request_key uuid,p_name text,p_notes text,p_lines jsonb,p_source text default 'menu',p_client_token text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare rid text; oid text; existing public.orders; result public.orders; line jsonb;
  item public.menu_items; qty integer; amount numeric(10,2):=0; payload jsonb; caller_key text;
begin
  select id into rid from public.restaurants where public_slug=p_slug;
  if rid is null or p_request_key is null then raise exception 'Invalid restaurant or request'; end if;
  if p_source not in ('menu','pos') or p_source is null then raise exception 'Invalid source'; end if;
  if p_source='pos' and not public.can_operate_pos(rid) then raise exception 'Access denied'; end if;
  if p_name is null or length(trim(p_name)) not between 1 and 120 or length(coalesce(p_notes,''))>2000 then raise exception 'Invalid name or notes'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 30 then raise exception 'Invalid basket size'; end if;
  payload:=jsonb_build_object('name',trim(p_name),'notes',coalesce(p_notes,''),'lines',p_lines,'source',p_source);
  perform pg_advisory_xact_lock(hashtextextended(rid||p_request_key::text,0));
  select * into existing from public.orders where restaurant_id=rid and request_key=p_request_key;
  if found then
    if existing.request_payload is distinct from payload then raise exception 'Request key already used with another basket'; end if;
    return jsonb_build_object('id',existing.id,'order_number',existing.order_number,'total',existing.total,'created_at',existing.created_at,
      'lines',(select jsonb_agg(jsonb_build_object('id',menu_item_id,'name_en',name_en,'name_de',name_de,'price',unit_price,'quantity',quantity)) from public.order_lines where order_id=existing.id));
  end if;
  if p_source='menu' then
    if p_client_token is not null and (length(p_client_token) not between 16 and 128 or p_client_token!~'^[A-Za-z0-9_-]+$') then raise exception 'Invalid client token'; end if;
    caller_key:=coalesce(p_client_token,md5(lower(trim(p_name))));
    perform public.consume_rate_limit('orders:'||rid||':menu:global',60,60);
    perform public.consume_rate_limit('orders:'||rid||':menu:client:'||caller_key,6,60);
  else
    perform public.consume_rate_limit('orders:'||rid||':pos:'||auth.uid()::text,180,60);
  end if;
  if (select count(*) from jsonb_array_elements(p_lines))<>(select count(distinct x->>'id') from jsonb_array_elements(p_lines)x) then raise exception 'Duplicate basket lines'; end if;
  perform id from public.menu_items where restaurant_id=rid order by id for share;
  oid:=gen_random_uuid()::text;
  insert into public.orders(id,restaurant_id,customer_name,phone,notes,status,total,request_key,request_payload,source)
    values(oid,rid,trim(p_name),'',coalesce(p_notes,''),'new',0,p_request_key,payload,p_source);
  for line in select * from jsonb_array_elements(p_lines) loop
    if (line->>'quantity')!~'^[0-9]+$' or line->>'quantity' is null then raise exception 'Invalid quantity'; end if;
    qty:=(line->>'quantity')::integer;
    if qty not between 1 and 20 then raise exception 'Invalid quantity'; end if;
    select * into item from public.menu_items where id=line->>'id' and restaurant_id=rid;
    if not found or not item.available or item.category_id is null then raise exception 'Item unavailable'; end if;
    if (item.category_id='offers' or cardinality(item.included_item_ids)>0) and (cardinality(item.included_item_ids)=0 or exists(
      select 1 from unnest(item.included_item_ids) part(id) where not exists(select 1 from public.menu_items m where m.id=part.id and m.restaurant_id=rid and m.available and m.category_id<>'offers')
    )) then raise exception 'Offer unavailable'; end if;
    amount:=amount+item.price*qty;
    insert into public.order_lines(id,order_id,menu_item_id,quantity,unit_price,name_en,name_de)
      values(gen_random_uuid()::text,oid,item.id,qty,item.price,item.name_en,item.name_de);
  end loop;
  update public.orders set total=amount where id=oid returning * into result;
  return jsonb_build_object('id',result.id,'order_number',result.order_number,'total',result.total,'created_at',result.created_at,
    'lines',(select jsonb_agg(jsonb_build_object('id',menu_item_id,'name_en',name_en,'name_de',name_de,'price',unit_price,'quantity',quantity)) from public.order_lines where order_id=result.id));
end $$;

create or replace function public.current_pos_restaurant()
returns text language plpgsql security definer set search_path=public stable as $$
declare p public.profiles;
begin
  select * into p from public.current_active_profile();
  if p.id is null or not (p.role in ('admin','owner') or (p.role='cashier' and public.has_open_cashier_shift(p.restaurant_id))) then
    raise exception 'Access denied';
  end if;
  return p.restaurant_id;
end $$;

create or replace function public.get_staff_directory()
returns jsonb language plpgsql security definer set search_path=public stable as $$
declare p public.profiles; result jsonb;
begin
  select * into p from public.current_active_profile();
  if p.id is null or p.role not in ('admin','owner') then raise exception 'Access denied'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',sp.id,'auth_user_id',sp.auth_user_id,'name',sp.name,'email',sp.email,'active',sp.active,'role',sp.role,
    'station',sp.station,'restaurant_name',sp.restaurant_name,
    'current_shift',case when sp.role='staff' then
      (select jsonb_build_object('id',s.id,'status',s.status,'started_at',s.started_at,'ended_at',s.ended_at,
        'orders_handled',s.orders_handled,'staff_profile_id',s.staff_profile_id)
        from public.staff_shifts s where s.staff_profile_id=sp.id and s.status='open' limit 1)
      else (select jsonb_build_object('id',s.id,'status',s.status,'started_at',s.started_at,'ended_at',s.ended_at,
        'orders_handled',0,'staff_profile_id',s.cashier_profile_id)
        from public.cashier_shifts s where s.cashier_profile_id=sp.id and s.status='open' limit 1) end,
    'recent_shifts',case when sp.role='staff' then coalesce((select jsonb_agg(x.row_data order by x.started_at desc) from (
      select s.started_at,jsonb_build_object('id',s.id,'status',s.status,'started_at',s.started_at,'ended_at',s.ended_at,
        'orders_handled',s.orders_handled,'staff_profile_id',s.staff_profile_id) row_data
      from public.staff_shifts s where s.staff_profile_id=sp.id order by s.started_at desc limit 10) x),'[]'::jsonb)
      else coalesce((select jsonb_agg(x.row_data order by x.started_at desc) from (
      select s.started_at,jsonb_build_object('id',s.id,'status',s.status,'started_at',s.started_at,'ended_at',s.ended_at,
        'orders_handled',0,'staff_profile_id',s.cashier_profile_id) row_data
      from public.cashier_shifts s where s.cashier_profile_id=sp.id order by s.started_at desc limit 10) x),'[]'::jsonb) end
  ) order by sp.name),'[]'::jsonb) into result from public.profiles sp
  where sp.restaurant_id=p.restaurant_id and sp.role in ('staff','cashier');
  return result;
end $$;

create or replace function public.update_staff_member(p_profile_id text,p_name text,p_active boolean,p_station text)
returns void language plpgsql security definer set search_path=public as $$
declare manager public.profiles; target public.profiles;
begin
  select * into manager from public.current_active_profile();
  if manager.id is null or manager.role not in ('admin','owner') then raise exception 'Access denied'; end if;
  select * into target from public.profiles where id=p_profile_id and restaurant_id=manager.restaurant_id for update;
  if not found or target.role not in ('staff','cashier') then raise exception 'Team profile not found'; end if;
  if length(trim(coalesce(p_name,''))) not between 1 and 120 or length(trim(coalesce(p_station,''))) not between 1 and 60 then raise exception 'Invalid team data'; end if;
  update public.profiles set name=trim(p_name),active=p_active,station=trim(p_station) where id=target.id;
  if not p_active and target.role='staff' then
    update public.staff_shifts set status='force_closed',ended_at=now(),ended_by=auth.uid(),end_reason='Account deactivated'
      where staff_profile_id=target.id and status='open';
  end if;
end $$;
revoke all on function public.current_pos_restaurant() from public,anon,authenticated;

create or replace function public.list_pos_drafts() returns jsonb
language plpgsql security definer set search_path=public stable as $$
declare rid text:=public.current_pos_restaurant(); result jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'customer_name',customer_name,'notes',notes,
    'lines',lines,'created_at',created_at,'updated_at',updated_at) order by updated_at desc),'[]'::jsonb)
    into result from public.pos_drafts where restaurant_id=rid;
  return result;
end $$;

create or replace function public.save_pos_draft(p_id uuid,p_name text,p_notes text,p_lines jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
declare rid text:=public.current_pos_restaurant(); draft_id uuid:=coalesce(p_id,gen_random_uuid());
begin
  perform public.consume_rate_limit('cashier:draft:'||auth.uid()::text,120,60);
  if length(coalesce(p_name,''))>120 or length(coalesce(p_notes,''))>2000 or jsonb_typeof(p_lines) is distinct from 'array'
    or jsonb_array_length(p_lines) not between 1 and 30 then raise exception 'Invalid draft'; end if;
  if exists(select 1 from jsonb_array_elements(p_lines)x where x->>'id' is null or (x->>'quantity')!~'^[0-9]+$'
    or (x->>'quantity')::int not between 1 and 20) then raise exception 'Invalid draft lines'; end if;
  if exists(select 1 from jsonb_array_elements(p_lines)x where not exists(
    select 1 from public.menu_items m where m.id=x->>'id' and m.restaurant_id=rid and m.available)) then raise exception 'Unavailable draft item'; end if;
  insert into public.pos_drafts(id,restaurant_id,created_by,customer_name,notes,lines)
    values(draft_id,rid,auth.uid(),coalesce(p_name,''),coalesce(p_notes,''),p_lines)
  on conflict(id) do update set customer_name=excluded.customer_name,notes=excluded.notes,lines=excluded.lines,updated_at=now()
    where pos_drafts.restaurant_id=rid;
  if not found then raise exception 'Draft not found'; end if;
  return draft_id;
end $$;

create or replace function public.delete_pos_draft(p_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare rid text:=public.current_pos_restaurant();
begin
  delete from public.pos_drafts where id=p_id and restaurant_id=rid;
end $$;

create or replace function public.save_profile_changes(p_restaurant text,p_changes jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare c jsonb; p public.profiles; n jsonb;
begin
  if not public.can_manage_restaurant(p_restaurant) or public.current_profile_role()<>'admin' then raise exception 'Access denied'; end if;
  perform pg_advisory_xact_lock(hashtextextended('profiles:'||p_restaurant,0));
  if jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes)>100 then raise exception 'Invalid changes'; end if;
  for c in select * from jsonb_array_elements(p_changes) loop
    select * into p from public.profiles where id=c->>'id' and restaurant_id=p_restaurant for update;
    if not found then raise exception 'Profile not found'; end if;
    if not to_jsonb(p) @> (c->'before') then raise exception 'Profile changed. Reload and retry.'; end if;
    n:=nullif(c->'after','null'::jsonb);
    if p.auth_user_id=auth.uid() and (n is null or n->>'role'<>'admin' or n->>'active'<>'true') then raise exception 'Cannot remove your own administrator access'; end if;
    if n is null then delete from public.profiles where id=p.id;
    else
      if exists(select 1 from jsonb_object_keys(n) k where k not in ('name','role','active','restaurant_name','station'))
        or length(trim(n->>'name')) not between 1 and 120 or n->>'role' not in ('admin','owner','staff','cashier')
        or jsonb_typeof(n->'active')<>'boolean' or length(trim(coalesce(n->>'station','all'))) not between 1 and 60 then raise exception 'Invalid profile fields'; end if;
      update public.profiles set name=n->>'name',role=n->>'role',active=(n->>'active')::boolean,
        restaurant_name=n->>'restaurant_name',station=coalesce(nullif(trim(n->>'station'),''),'all') where id=p.id;
    end if;
  end loop;
end $$;

drop policy if exists "Cashiers can receive restaurant order signals" on public.staff_order_signals;
create policy "Cashiers can receive restaurant order signals" on public.staff_order_signals for select using (
  exists(select 1 from public.profiles p where p.auth_user_id=auth.uid() and p.active
    and not coalesce(p.must_change_password,false) and p.role='cashier'
    and p.restaurant_id=staff_order_signals.restaurant_id and public.has_open_cashier_shift(staff_order_signals.restaurant_id))
);

revoke all on function public.open_cashier_shift() from public;
revoke all on function public.get_current_cashier_shift() from public;
revoke all on function public.get_cashier_opening_balance() from public;
revoke all on function public.get_cashier_workspace() from public;
revoke all on function public.create_cash_transfer(numeric) from public;
revoke all on function public.close_cashier_shift() from public;
revoke all on function public.set_cashier_order_status(text,text,text) from public;
revoke all on function public.place_order(text,uuid,text,text,jsonb,text,text) from public;
revoke all on function public.save_profile_changes(text,jsonb) from public;
grant execute on function public.open_cashier_shift() to authenticated;
grant execute on function public.get_current_cashier_shift() to authenticated;
grant execute on function public.get_cashier_opening_balance() to authenticated;
grant execute on function public.get_cashier_workspace() to authenticated;
grant execute on function public.create_cash_transfer(numeric) to authenticated;
grant execute on function public.close_cashier_shift() to authenticated;
grant execute on function public.set_cashier_order_status(text,text,text) to authenticated;
grant execute on function public.place_order(text,uuid,text,text,jsonb,text,text) to anon,authenticated;
grant execute on function public.save_profile_changes(text,jsonb) to authenticated;

commit;
