begin;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin','owner','staff'));
alter table public.profiles add column if not exists station text not null default 'all';

alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('new','accepted','preparing','ready','done','cancelled'));
alter table public.orders add column if not exists accepted_at timestamptz;
alter table public.orders add column if not exists preparing_at timestamptz;
alter table public.orders add column if not exists ready_at timestamptz;
alter table public.orders add column if not exists completed_at timestamptz;
alter table public.orders add column if not exists assigned_staff_id text references public.profiles(id) on delete set null;

alter table public.menu_items add column if not exists prep_station text not null default 'kitchen';
alter table public.menu_items add column if not exists prep_minutes integer not null default 0 check (prep_minutes between 0 and 240);
alter table public.menu_items add column if not exists prep_ingredients_en text[] not null default '{}';
alter table public.menu_items add column if not exists prep_ingredients_de text[] not null default '{}';
alter table public.menu_items add column if not exists prep_tools_en text[] not null default '{}';
alter table public.menu_items add column if not exists prep_tools_de text[] not null default '{}';
alter table public.menu_items add column if not exists prep_steps_en text[] not null default '{}';
alter table public.menu_items add column if not exists prep_steps_de text[] not null default '{}';
alter table public.menu_items add column if not exists prep_warning_en text not null default '';
alter table public.menu_items add column if not exists prep_warning_de text not null default '';

create table if not exists public.staff_shifts (
  id uuid primary key default gen_random_uuid(),
  restaurant_id text not null references public.restaurants(id) on delete cascade,
  staff_profile_id text not null references public.profiles(id) on delete cascade,
  auth_user_id uuid not null,
  status text not null default 'open' check (status in ('open','closed','force_closed')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by uuid,
  end_reason text not null default '',
  orders_handled integer not null default 0 check (orders_handled >= 0),
  constraint staff_shift_end_consistency check (
    (status = 'open' and ended_at is null) or (status <> 'open' and ended_at is not null)
  )
);
create unique index if not exists staff_shifts_one_open_per_user
  on public.staff_shifts(auth_user_id) where status = 'open';
create index if not exists staff_shifts_restaurant_started
  on public.staff_shifts(restaurant_id, started_at desc);
alter table public.staff_shifts enable row level security;

create table if not exists public.order_rate_buckets (
  bucket_key text not null,
  bucket_started_at timestamptz not null,
  request_count integer not null default 0,
  primary key (bucket_key, bucket_started_at)
);
revoke all on public.order_rate_buckets from public, anon, authenticated;

create or replace function public.current_active_profile()
returns public.profiles language sql security definer set search_path = public stable as $$
  select p from public.profiles p where p.auth_user_id = auth.uid() and p.active
    and not coalesce(p.must_change_password,false) limit 1
$$;

create or replace function public.has_open_staff_shift(target_restaurant_id text)
returns boolean language sql security definer set search_path = public stable as $$
  select exists(
    select 1 from public.staff_shifts s join public.profiles p on p.id=s.staff_profile_id
    where s.auth_user_id=auth.uid() and s.restaurant_id=target_restaurant_id and s.status='open'
      and p.role='staff' and p.active and not coalesce(p.must_change_password,false)
  )
$$;

create or replace function public.consume_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns void language plpgsql security definer set search_path = public as $$
declare bucket timestamptz; consumed integer;
begin
  if p_key is null or p_limit not between 1 and 10000 or p_window_seconds not between 1 and 3600 then
    raise exception 'Invalid rate limit';
  end if;
  bucket := to_timestamp(floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds);
  insert into public.order_rate_buckets(bucket_key,bucket_started_at,request_count)
    values(p_key,bucket,1)
  on conflict(bucket_key,bucket_started_at) do update
    set request_count=public.order_rate_buckets.request_count+1
    where public.order_rate_buckets.request_count < p_limit
  returning request_count into consumed;
  if consumed is null then
    raise exception 'Rate limit exceeded. Please wait and retry.' using errcode='P0001';
  end if;
  if random() < 0.02 then
    delete from public.order_rate_buckets where bucket_started_at < now() - interval '1 day';
  end if;
end $$;
revoke all on function public.consume_rate_limit(text,integer,integer) from public, anon, authenticated;

drop function if exists public.place_order(text,uuid,text,text,jsonb,text);
create or replace function public.place_order(
  p_slug text,
  p_request_key uuid,
  p_name text,
  p_notes text,
  p_lines jsonb,
  p_source text default 'menu',
  p_client_token text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare rid text; oid text; existing public.orders; result public.orders; line jsonb;
  item public.menu_items; qty integer; amount numeric(10,2) := 0; payload jsonb; caller_key text;
begin
  select id into rid from public.restaurants where public_slug = p_slug;
  if rid is null or p_request_key is null then raise exception 'Invalid restaurant or request'; end if;
  if p_source not in ('menu','pos') or p_source is null then raise exception 'Invalid source'; end if;
  if p_source = 'pos' and not public.can_manage_restaurant(rid) then raise exception 'Access denied'; end if;
  if p_name is null or length(trim(p_name)) not between 1 and 120 or length(coalesce(p_notes,'')) > 2000 then
    raise exception 'Invalid name or notes'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 30 then
    raise exception 'Invalid basket size'; end if;
  payload := jsonb_build_object('name',trim(p_name),'notes',coalesce(p_notes,''),'lines',p_lines,'source',p_source);

  perform pg_advisory_xact_lock(hashtextextended(rid || p_request_key::text, 0));
  select * into existing from public.orders where restaurant_id = rid and request_key = p_request_key;
  if found then
    if existing.request_payload is distinct from payload then raise exception 'Request key already used with another basket'; end if;
    return jsonb_build_object('id',existing.id,'order_number',existing.order_number,'total',existing.total,'created_at',existing.created_at,
      'lines',(select jsonb_agg(jsonb_build_object('id',menu_item_id,'name_en',name_en,'name_de',name_de,'price',unit_price,'quantity',quantity)) from public.order_lines where order_id=existing.id));
  end if;

  if p_source='menu' then
    if p_client_token is not null and (length(p_client_token) not between 16 and 128 or p_client_token !~ '^[A-Za-z0-9_-]+$') then
      raise exception 'Invalid client token';
    end if;
    caller_key := coalesce(p_client_token, md5(lower(trim(p_name))));
    perform public.consume_rate_limit('orders:'||rid||':menu:global',60,60);
    perform public.consume_rate_limit('orders:'||rid||':menu:client:'||caller_key,6,60);
  else
    perform public.consume_rate_limit('orders:'||rid||':pos:'||auth.uid()::text,180,60);
  end if;

  if (select count(*) from jsonb_array_elements(p_lines)) <> (select count(distinct x->>'id') from jsonb_array_elements(p_lines) x) then
    raise exception 'Duplicate basket lines'; end if;
  perform id from public.menu_items where restaurant_id = rid order by id for share;
  oid := gen_random_uuid()::text;
  insert into public.orders(id,restaurant_id,customer_name,phone,notes,status,total,request_key,request_payload,source)
    values(oid,rid,trim(p_name),'',coalesce(p_notes,''),'new',0,p_request_key,payload,p_source);
  for line in select * from jsonb_array_elements(p_lines) loop
    if (line->>'quantity') !~ '^[0-9]+$' or line->>'quantity' is null then raise exception 'Invalid quantity'; end if;
    qty := (line->>'quantity')::integer;
    if qty not between 1 and 20 then raise exception 'Invalid quantity'; end if;
    select * into item from public.menu_items where id = line->>'id' and restaurant_id = rid;
    if not found or not item.available or item.category_id is null then raise exception 'Item unavailable'; end if;
    if (item.category_id = 'offers' or cardinality(item.included_item_ids) > 0) and (cardinality(item.included_item_ids) = 0 or exists (
      select 1 from unnest(item.included_item_ids) part(id) where not exists
      (select 1 from public.menu_items m where m.id=part.id and m.restaurant_id=rid and m.available and m.category_id <> 'offers')
    )) then raise exception 'Offer unavailable'; end if;
    amount := amount + item.price * qty;
    insert into public.order_lines(id,order_id,menu_item_id,quantity,unit_price,name_en,name_de)
      values(gen_random_uuid()::text,oid,item.id,qty,item.price,item.name_en,item.name_de);
  end loop;
  update public.orders set total=amount where id=oid returning * into result;
  return jsonb_build_object('id',result.id,'order_number',result.order_number,'total',result.total,'created_at',result.created_at,
    'lines',(select jsonb_agg(jsonb_build_object('id',menu_item_id,'name_en',name_en,'name_de',name_de,'price',unit_price,'quantity',quantity)) from public.order_lines where order_id=result.id));
end $$;
revoke all on function public.place_order(text,uuid,text,text,jsonb,text,text) from public;
grant execute on function public.place_order(text,uuid,text,text,jsonb,text,text) to anon, authenticated;

create or replace function public.start_staff_shift()
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.profiles; s public.staff_shifts;
begin
  select * into p from public.profiles where auth_user_id=auth.uid() and active
    and not coalesce(must_change_password,false) and role='staff' limit 1;
  if not found then raise exception 'Active staff profile required'; end if;
  select * into s from public.staff_shifts where auth_user_id=auth.uid() and status='open' for update;
  if not found then
    insert into public.staff_shifts(restaurant_id,staff_profile_id,auth_user_id)
      values(p.restaurant_id,p.id,auth.uid()) returning * into s;
  end if;
  return jsonb_build_object('id',s.id,'status',s.status,'started_at',s.started_at,'ended_at',s.ended_at,
    'orders_handled',s.orders_handled,'staff_profile_id',s.staff_profile_id);
end $$;

create or replace function public.get_current_staff_shift()
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare s public.staff_shifts;
begin
  select * into s from public.staff_shifts where auth_user_id=auth.uid() and status='open' order by started_at desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object('id',s.id,'status',s.status,'started_at',s.started_at,'ended_at',s.ended_at,
    'orders_handled',s.orders_handled,'staff_profile_id',s.staff_profile_id);
end $$;

create or replace function public.end_staff_shift()
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.staff_shifts;
begin
  select * into s from public.staff_shifts where auth_user_id=auth.uid() and status='open' for update;
  if not found then raise exception 'No active shift'; end if;
  update public.staff_shifts set status='closed',ended_at=now(),ended_by=auth.uid()
    where id=s.id returning * into s;
  return jsonb_build_object('id',s.id,'status',s.status,'started_at',s.started_at,'ended_at',s.ended_at,
    'orders_handled',s.orders_handled,'staff_profile_id',s.staff_profile_id);
end $$;

create or replace function public.get_staff_order_board()
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare p public.profiles; result jsonb;
begin
  select * into p from public.current_active_profile();
  if p.id is null or (p.role='staff' and not public.has_open_staff_shift(p.restaurant_id))
    or p.role not in ('staff','admin','owner') then raise exception 'Active shift required'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',o.id,'order_number',o.order_number,'source',o.source,'customer_name',o.customer_name,
    'notes',o.notes,'total',o.total,'status',o.status,'created_at',o.created_at,
    'accepted_at',o.accepted_at,'preparing_at',o.preparing_at,'ready_at',o.ready_at,
    'lines',coalesce((select jsonb_agg(jsonb_build_object(
      'id',l.menu_item_id,'name_en',coalesce(l.name_en,'Historical item'),'name_de',coalesce(l.name_de,'Archivierter Artikel'),
      'price',l.unit_price,'quantity',l.quantity,
      'preparation',case when m.id is null then null else jsonb_build_object(
        'station',m.prep_station,'estimated_minutes',m.prep_minutes,
        'ingredients_en',m.prep_ingredients_en,'ingredients_de',m.prep_ingredients_de,
        'tools_en',m.prep_tools_en,'tools_de',m.prep_tools_de,
        'steps_en',m.prep_steps_en,'steps_de',m.prep_steps_de,
        'warning_en',m.prep_warning_en,'warning_de',m.prep_warning_de) end
      ) order by l.id) from public.order_lines l left join public.menu_items m on m.id=l.menu_item_id where l.order_id=o.id),'[]'::jsonb)
    ) order by o.created_at), '[]'::jsonb) into result
  from public.orders o where o.restaurant_id=p.restaurant_id
    and o.status in ('new','accepted','preparing','ready')
    and o.created_at >= now() - interval '24 hours';
  return result;
end $$;

create or replace function public.set_staff_order_status(p_id text,p_expected text,p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.profiles; o public.orders; shift_id uuid;
begin
  select * into p from public.current_active_profile();
  if p.id is null or p.role<>'staff' or not public.has_open_staff_shift(p.restaurant_id) then
    raise exception 'Active staff shift required'; end if;
  select id into shift_id from public.staff_shifts where auth_user_id=auth.uid() and status='open' for update;
  select * into o from public.orders where id=p_id and restaurant_id=p.restaurant_id for update;
  if not found then raise exception 'Order not found'; end if;
  if o.status is distinct from p_expected then raise exception 'Order changed. Refresh and retry.'; end if;
  if not ((o.status='new' and p_status='accepted') or (o.status='accepted' and p_status='preparing')
    or (o.status='preparing' and p_status='ready') or (o.status='ready' and p_status='done')) then
    raise exception 'Invalid status transition'; end if;
  update public.orders set status=p_status,assigned_staff_id=coalesce(assigned_staff_id,p.id),
    accepted_at=case when p_status='accepted' then now() else accepted_at end,
    preparing_at=case when p_status='preparing' then now() else preparing_at end,
    ready_at=case when p_status='ready' then now() else ready_at end,
    completed_at=case when p_status='done' then now() else completed_at end where id=p_id;
  insert into public.order_events(order_id,actor,previous_status,next_status) values(p_id,auth.uid(),o.status,p_status);
  if p_status='done' then update public.staff_shifts set orders_handled=orders_handled+1 where id=shift_id; end if;
  return jsonb_build_object('id',p_id,'status',p_status);
end $$;

create or replace function public.set_order_status(p_id text,p_expected text,p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare o public.orders; begin
  select * into o from public.orders where id=p_id for update;
  if not found or not public.can_manage_restaurant(o.restaurant_id) then raise exception 'Access denied'; end if;
  if o.status is distinct from p_expected then raise exception 'Order changed. Refresh and retry.'; end if;
  if not ((o.status='new' and p_status in ('accepted','preparing','cancelled')) or
    (o.status='accepted' and p_status in ('preparing','cancelled')) or
    (o.status='preparing' and p_status in ('ready','done','cancelled')) or
    (o.status='ready' and p_status in ('done','cancelled'))) then raise exception 'Invalid status transition'; end if;
  update public.orders set status=p_status,
    accepted_at=case when p_status='accepted' then now() else accepted_at end,
    preparing_at=case when p_status='preparing' then now() else preparing_at end,
    ready_at=case when p_status='ready' then now() else ready_at end,
    completed_at=case when p_status='done' then now() else completed_at end where id=p_id;
  insert into public.order_events(order_id,actor,previous_status,next_status) values(p_id,auth.uid(),o.status,p_status);
end $$;

create or replace function public.get_staff_directory()
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare p public.profiles; result jsonb;
begin
  select * into p from public.current_active_profile();
  if p.id is null or p.role not in ('admin','owner') then raise exception 'Access denied'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',sp.id,'auth_user_id',sp.auth_user_id,'name',sp.name,'email',sp.email,'active',sp.active,
    'station',sp.station,'restaurant_name',sp.restaurant_name,'current_shift',
    (select jsonb_build_object('id',s.id,'status',s.status,'started_at',s.started_at,'ended_at',s.ended_at,
      'orders_handled',s.orders_handled,'staff_profile_id',s.staff_profile_id)
      from public.staff_shifts s where s.staff_profile_id=sp.id and s.status='open' limit 1),
    'recent_shifts',coalesce((select jsonb_agg(x.row_data order by x.started_at desc) from (
      select s.started_at,jsonb_build_object('id',s.id,'status',s.status,'started_at',s.started_at,
        'ended_at',s.ended_at,'orders_handled',s.orders_handled,'staff_profile_id',s.staff_profile_id) row_data
      from public.staff_shifts s where s.staff_profile_id=sp.id order by s.started_at desc limit 10
    ) x),'[]'::jsonb)
  ) order by sp.name), '[]'::jsonb) into result
  from public.profiles sp where sp.restaurant_id=p.restaurant_id and sp.role='staff';
  return result;
end $$;

create or replace function public.update_staff_member(p_profile_id text,p_name text,p_active boolean,p_station text)
returns void language plpgsql security definer set search_path = public as $$
declare manager public.profiles; target public.profiles;
begin
  select * into manager from public.current_active_profile();
  if manager.id is null or manager.role not in ('admin','owner') then raise exception 'Access denied'; end if;
  select * into target from public.profiles where id=p_profile_id and restaurant_id=manager.restaurant_id for update;
  if not found or target.role<>'staff' then raise exception 'Staff profile not found'; end if;
  if length(trim(coalesce(p_name,''))) not between 1 and 120 or length(trim(coalesce(p_station,''))) not between 1 and 60 then
    raise exception 'Invalid staff data'; end if;
  update public.profiles set name=trim(p_name),active=p_active,station=trim(p_station) where id=target.id;
  if not p_active then
    update public.staff_shifts set status='force_closed',ended_at=now(),ended_by=auth.uid(),end_reason='Account deactivated'
      where staff_profile_id=target.id and status='open';
  end if;
end $$;

create or replace function public.save_profile_changes(p_restaurant text,p_changes jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare c jsonb; p public.profiles; n jsonb;
begin
  if not public.can_manage_restaurant(p_restaurant) or public.current_profile_role()<>'admin' then raise exception 'Access denied'; end if;
  perform pg_advisory_xact_lock(hashtextextended('profiles:'||p_restaurant,0));
  if jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes)>100 then raise exception 'Invalid changes'; end if;
  for c in select * from jsonb_array_elements(p_changes) loop
    select * into p from public.profiles where id=c->>'id' and restaurant_id=p_restaurant for update;
    if not found then raise exception 'Profile not found'; end if;
    if not to_jsonb(p) @> (c->'before') then raise exception 'Profile changed. Reload and retry.'; end if;
    n := nullif(c->'after','null'::jsonb);
    if p.auth_user_id=auth.uid() and (n is null or n->>'role'<>'admin' or n->>'active'<>'true') then
      raise exception 'Cannot remove your own administrator access'; end if;
    if n is null then
      delete from public.profiles where id=p.id;
    else
      if exists(select 1 from jsonb_object_keys(n) k where k not in ('name','role','active','restaurant_name','station')) or
        length(trim(n->>'name')) not between 1 and 120 or n->>'role' not in ('admin','owner','staff') or
        jsonb_typeof(n->'active')<>'boolean' or length(trim(coalesce(n->>'station','all'))) not between 1 and 60 then
        raise exception 'Invalid profile fields'; end if;
      update public.profiles set name=n->>'name',role=n->>'role',active=(n->>'active')::boolean,
        restaurant_name=n->>'restaurant_name',station=coalesce(nullif(trim(n->>'station'),''),'all') where id=p.id;
    end if;
  end loop;
end $$;

create or replace function public.save_catalog_changes(p_restaurant text, p_changes jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare change jsonb; tab text; rid text; old jsonb; nextrow jsonb; currentrow jsonb; columns_sql text; values_sql text; allowed text[];
begin
  if not public.can_manage_restaurant(p_restaurant) then raise exception 'Access denied'; end if;
  if jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes)>2000 then raise exception 'Invalid changes'; end if;
  perform pg_advisory_xact_lock(hashtextextended('catalog:' || p_restaurant,0));
  for change in select value from jsonb_array_elements(p_changes)
    order by (value->'after' = 'null'::jsonb),
      case when value->'after' = 'null'::jsonb then case value->>'table' when 'categories' then 1 else 0 end
      else case value->>'table' when 'categories' then 0 else 1 end end
  loop
    tab := change->>'table'; rid := change->>'id'; old := nullif(change->'before','null'::jsonb); nextrow := nullif(change->'after','null'::jsonb);
    case tab
      when 'categories' then allowed := array['id','restaurant_id','name_en','name_de','sort_order'];
      when 'menu_items' then allowed := array['id','restaurant_id','category_id','name_en','name_de','description_en','description_de','price','badge_en','badge_de','image_style','image_url','available','sort_order','included_item_ids','prep_station','prep_minutes','prep_ingredients_en','prep_ingredients_de','prep_tools_en','prep_tools_de','prep_steps_en','prep_steps_de','prep_warning_en','prep_warning_de'];
      when 'opening_hours' then allowed := array['id','restaurant_id','day','open_time','close_time','enabled','sort_order'];
      else raise exception 'Invalid entity';
    end case;
    if rid is null or (old is null and nextrow is null) then raise exception 'Invalid change'; end if;
    execute format('select to_jsonb(t) from public.%I t where id=$1 for update',tab) into currentrow using rid;
    if currentrow is not null and currentrow->>'restaurant_id' is distinct from p_restaurant then raise exception 'Access denied'; end if;
    if old is null and currentrow is not null then raise exception 'Entity already exists'; end if;
    if old is not null and (currentrow is null or not currentrow @> old) then raise exception 'Data changed on another device. Reload before saving.'; end if;
    if nextrow is null then
      if tab='categories' then delete from public.menu_items where restaurant_id=p_restaurant and category_id=rid; end if;
      execute format('delete from public.%I where id=$1 and restaurant_id=$2',tab) using rid,p_restaurant;
    else
      if nextrow->>'id' is distinct from rid or nextrow->>'restaurant_id' is distinct from p_restaurant or
        exists(select 1 from jsonb_object_keys(nextrow) k where not k=any(allowed)) then raise exception 'Invalid fields'; end if;
      if tab='menu_items' and not exists(select 1 from public.categories where id=nextrow->>'category_id' and restaurant_id=p_restaurant) then raise exception 'Invalid category'; end if;
      if tab='opening_hours' and ((nextrow->>'open_time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or
        (nextrow->>'close_time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then raise exception 'Invalid opening hours'; end if;
      select string_agg(format('%I',k),','),string_agg(format('r.%I',k),',') into columns_sql,values_sql from jsonb_object_keys(nextrow) k;
      if currentrow is null then
        execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I,$1) r',tab,columns_sql,values_sql,tab) using nextrow;
      else
        execute format('update public.%I set (%s)=(select %s from jsonb_populate_record(null::public.%I,$1) r) where id=$2',tab,columns_sql,values_sql,tab) using nextrow,rid;
      end if;
    end if;
  end loop;
end $$;

create or replace function public.get_order_page(
  p_scope text default 'live', p_query text default '', p_status text default '', p_source text default '',
  p_from timestamptz default null, p_to timestamptz default null, p_page integer default 1, p_page_size integer default 25
) returns jsonb language plpgsql security definer set search_path = public stable as $$
declare rid text; safe_page integer := greatest(coalesce(p_page,1),1);
  safe_size integer := least(greatest(coalesce(p_page_size,25),1),50); total_rows integer; result_rows jsonb;
begin
  select restaurant_id into rid from public.profiles where auth_user_id=auth.uid() and active
    and not coalesce(must_change_password,false) and role in ('admin','owner') limit 1;
  if rid is null then raise exception 'Access denied'; end if;
  if p_scope not in ('live','today','history','cancelled','all') then raise exception 'Invalid scope'; end if;
  if p_status<>'' and p_status not in ('new','accepted','preparing','ready','done','cancelled') then raise exception 'Invalid status'; end if;
  if p_source<>'' and p_source not in ('menu','pos') then raise exception 'Invalid source'; end if;
  with filtered as (
    select o.* from public.orders o where o.restaurant_id=rid
      and case p_scope when 'live' then o.status in ('new','accepted','preparing','ready')
        when 'today' then (o.created_at at time zone 'Europe/Berlin')::date=(now() at time zone 'Europe/Berlin')::date
        when 'history' then o.status='done' when 'cancelled' then o.status='cancelled' else true end
      and (p_status='' or o.status=p_status) and (p_source='' or o.source=p_source)
      and (p_from is null or o.created_at>=p_from) and (p_to is null or o.created_at<p_to)
      and (trim(coalesce(p_query,''))='' or o.order_number::text ilike '%'||trim(p_query)||'%' or o.customer_name ilike '%'||trim(p_query)||'%')
  ) select count(*)::integer into total_rows from filtered;
  with filtered as (
    select o.* from public.orders o where o.restaurant_id=rid
      and case p_scope when 'live' then o.status in ('new','accepted','preparing','ready')
        when 'today' then (o.created_at at time zone 'Europe/Berlin')::date=(now() at time zone 'Europe/Berlin')::date
        when 'history' then o.status='done' when 'cancelled' then o.status='cancelled' else true end
      and (p_status='' or o.status=p_status) and (p_source='' or o.source=p_source)
      and (p_from is null or o.created_at>=p_from) and (p_to is null or o.created_at<p_to)
      and (trim(coalesce(p_query,''))='' or o.order_number::text ilike '%'||trim(p_query)||'%' or o.customer_name ilike '%'||trim(p_query)||'%')
    order by o.created_at desc,o.id desc limit safe_size offset (safe_page-1)*safe_size
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',f.id,'order_number',f.order_number,'source',f.source,'customer_name',f.customer_name,'notes',f.notes,
    'total',f.total,'status',f.status,'created_at',f.created_at,
    'lines',coalesce((select jsonb_agg(jsonb_build_object('id',l.menu_item_id,
      'name_en',coalesce(l.name_en,'Historical item'),'name_de',coalesce(l.name_de,'Archivierter Artikel'),
      'price',l.unit_price,'quantity',l.quantity) order by l.id) from public.order_lines l where l.order_id=f.id),'[]'::jsonb)
  ) order by f.created_at desc,f.id desc),'[]'::jsonb) into result_rows from filtered f;
  return jsonb_build_object('rows',result_rows,'total',total_rows,'page',safe_page,'page_size',safe_size,
    'page_count',greatest(1,ceil(total_rows::numeric/safe_size)::integer));
end $$;

create or replace function public.get_order_workspace_stats() returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare rid text;
begin
  select restaurant_id into rid from public.profiles where auth_user_id=auth.uid() and active
    and not coalesce(must_change_password,false) and role in ('admin','owner') limit 1;
  if rid is null then raise exception 'Access denied'; end if;
  return (select jsonb_build_object(
    'new_count',count(*) filter(where status in ('new','accepted')),
    'preparing_count',count(*) filter(where status in ('preparing','ready')),
    'today_count',count(*) filter(where status<>'cancelled' and (created_at at time zone 'Europe/Berlin')::date=(now() at time zone 'Europe/Berlin')::date),
    'today_revenue',coalesce(sum(total) filter(where status<>'cancelled' and (created_at at time zone 'Europe/Berlin')::date=(now() at time zone 'Europe/Berlin')::date),0)
  ) from public.orders where restaurant_id=rid);
end $$;

drop policy if exists "Staff can read active orders" on public.orders;
create policy "Staff can read active orders" on public.orders for select using (
  exists(select 1 from public.profiles p where p.auth_user_id=auth.uid() and p.active
    and not coalesce(p.must_change_password,false) and p.role='staff' and p.restaurant_id=orders.restaurant_id
    and public.has_open_staff_shift(orders.restaurant_id))
);
drop policy if exists "Staff can read order lines" on public.order_lines;
create policy "Staff can read order lines" on public.order_lines for select using (
  exists(select 1 from public.orders o join public.profiles p on p.restaurant_id=o.restaurant_id
    where o.id=order_lines.order_id and p.auth_user_id=auth.uid() and p.active
      and not coalesce(p.must_change_password,false) and p.role='staff'
      and public.has_open_staff_shift(o.restaurant_id))
);
drop policy if exists "Staff can read own shifts" on public.staff_shifts;
create policy "Staff can read own shifts" on public.staff_shifts for select using (auth_user_id=auth.uid());
drop policy if exists "Managers can read staff shifts" on public.staff_shifts;
create policy "Managers can read staff shifts" on public.staff_shifts for select using (public.can_manage_restaurant(restaurant_id));

revoke all on public.staff_shifts from anon, authenticated;
grant select on public.staff_shifts to authenticated;
revoke all on function public.start_staff_shift() from public;
revoke all on function public.get_current_staff_shift() from public;
revoke all on function public.end_staff_shift() from public;
revoke all on function public.get_staff_order_board() from public;
revoke all on function public.set_staff_order_status(text,text,text) from public;
revoke all on function public.get_staff_directory() from public;
revoke all on function public.update_staff_member(text,text,boolean,text) from public;
grant execute on function public.start_staff_shift() to authenticated;
grant execute on function public.get_current_staff_shift() to authenticated;
grant execute on function public.end_staff_shift() to authenticated;
grant execute on function public.get_staff_order_board() to authenticated;
grant execute on function public.set_staff_order_status(text,text,text) to authenticated;
grant execute on function public.get_staff_directory() to authenticated;
grant execute on function public.update_staff_member(text,text,boolean,text) to authenticated;

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.orders;
    exception when duplicate_object then null;
    end;
  end if;
end $$;

commit;
