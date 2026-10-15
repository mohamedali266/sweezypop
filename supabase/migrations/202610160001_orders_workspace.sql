begin;

create index if not exists orders_restaurant_status_created_idx
  on public.orders(restaurant_id, status, created_at desc);
create index if not exists order_events_order_created_idx
  on public.order_events(order_id, created_at desc);

create table if not exists public.pos_drafts (
  id uuid primary key default gen_random_uuid(),
  restaurant_id text not null references public.restaurants(id) on delete cascade,
  created_by uuid not null,
  customer_name text not null default '',
  notes text not null default '',
  lines jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_drafts_name_length check (length(customer_name) <= 120),
  constraint pos_drafts_notes_length check (length(notes) <= 2000),
  constraint pos_drafts_lines_array check (jsonb_typeof(lines) = 'array')
);
create index if not exists pos_drafts_restaurant_updated_idx
  on public.pos_drafts(restaurant_id, updated_at desc);
alter table public.pos_drafts enable row level security;

drop policy if exists "Managers can manage POS drafts" on public.pos_drafts;
create policy "Managers can manage POS drafts" on public.pos_drafts for all
  using (public.can_manage_restaurant(restaurant_id))
  with check (public.can_manage_restaurant(restaurant_id) and created_by = auth.uid());

create or replace function public.get_order_page(
  p_scope text default 'live',
  p_query text default '',
  p_status text default '',
  p_source text default '',
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_page integer default 1,
  p_page_size integer default 25
) returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare
  rid text;
  safe_page integer := greatest(coalesce(p_page, 1), 1);
  safe_size integer := least(greatest(coalesce(p_page_size, 25), 1), 50);
  total_rows integer;
  result_rows jsonb;
begin
  select restaurant_id into rid from public.profiles
    where auth_user_id = auth.uid() and active and not coalesce(must_change_password,false)
      and role in ('admin','owner') limit 1;
  if rid is null then raise exception 'Access denied'; end if;
  if p_scope not in ('live','today','history','cancelled','all') then raise exception 'Invalid scope'; end if;
  if p_status <> '' and p_status not in ('new','preparing','done','cancelled') then raise exception 'Invalid status'; end if;
  if p_source <> '' and p_source not in ('menu','pos') then raise exception 'Invalid source'; end if;

  with filtered as (
    select o.* from public.orders o where o.restaurant_id = rid
      and case p_scope
        when 'live' then o.status in ('new','preparing')
        when 'today' then (o.created_at at time zone 'Europe/Berlin')::date = (now() at time zone 'Europe/Berlin')::date
        when 'history' then o.status = 'done'
        when 'cancelled' then o.status = 'cancelled'
        else true end
      and (p_status = '' or o.status = p_status)
      and (p_source = '' or o.source = p_source)
      and (p_from is null or o.created_at >= p_from)
      and (p_to is null or o.created_at < p_to)
      and (trim(coalesce(p_query,'')) = '' or o.order_number::text ilike '%' || trim(p_query) || '%'
        or o.customer_name ilike '%' || trim(p_query) || '%')
  ) select count(*)::integer into total_rows from filtered;

  with filtered as (
    select o.* from public.orders o where o.restaurant_id = rid
      and case p_scope
        when 'live' then o.status in ('new','preparing')
        when 'today' then (o.created_at at time zone 'Europe/Berlin')::date = (now() at time zone 'Europe/Berlin')::date
        when 'history' then o.status = 'done'
        when 'cancelled' then o.status = 'cancelled'
        else true end
      and (p_status = '' or o.status = p_status)
      and (p_source = '' or o.source = p_source)
      and (p_from is null or o.created_at >= p_from)
      and (p_to is null or o.created_at < p_to)
      and (trim(coalesce(p_query,'')) = '' or o.order_number::text ilike '%' || trim(p_query) || '%'
        or o.customer_name ilike '%' || trim(p_query) || '%')
    order by o.created_at desc, o.id desc
    limit safe_size offset (safe_page - 1) * safe_size
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', f.id, 'order_number', f.order_number, 'source', f.source,
    'customer_name', f.customer_name, 'notes', f.notes, 'total', f.total,
    'status', f.status, 'created_at', f.created_at,
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
      'id', l.menu_item_id, 'name_en', coalesce(l.name_en,'Historical item'),
      'name_de', coalesce(l.name_de,'Archivierter Artikel'), 'price', l.unit_price,
      'quantity', l.quantity) order by l.id) from public.order_lines l where l.order_id = f.id), '[]'::jsonb)
  ) order by f.created_at desc, f.id desc), '[]'::jsonb) into result_rows from filtered f;

  return jsonb_build_object('rows', result_rows, 'total', total_rows, 'page', safe_page,
    'page_size', safe_size, 'page_count', greatest(1, ceil(total_rows::numeric / safe_size)::integer));
end $$;
revoke all on function public.get_order_page(text,text,text,text,timestamptz,timestamptz,integer,integer) from public;
grant execute on function public.get_order_page(text,text,text,text,timestamptz,timestamptz,integer,integer) to authenticated;

create or replace function public.get_order_workspace_stats() returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare rid text; begin
  select restaurant_id into rid from public.profiles where auth_user_id=auth.uid() and active
    and not coalesce(must_change_password,false) and role in ('admin','owner') limit 1;
  if rid is null then raise exception 'Access denied'; end if;
  return (select jsonb_build_object(
    'new_count', count(*) filter (where status='new'),
    'preparing_count', count(*) filter (where status='preparing'),
    'today_count', count(*) filter (where status <> 'cancelled' and (created_at at time zone 'Europe/Berlin')::date=(now() at time zone 'Europe/Berlin')::date),
    'today_revenue', coalesce(sum(total) filter (where status <> 'cancelled' and (created_at at time zone 'Europe/Berlin')::date=(now() at time zone 'Europe/Berlin')::date),0)
  ) from public.orders where restaurant_id=rid);
end $$;
revoke all on function public.get_order_workspace_stats() from public;
grant execute on function public.get_order_workspace_stats() to authenticated;

create or replace function public.get_order_timeline(p_id text) returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare rid text; result jsonb; begin
  select restaurant_id into rid from public.orders where id=p_id;
  if rid is null or not public.can_manage_restaurant(rid) then raise exception 'Access denied'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('previous_status',e.previous_status,
    'next_status',e.next_status,'created_at',e.created_at) order by e.created_at desc),'[]'::jsonb)
    into result from public.order_events e where e.order_id=p_id;
  return result;
end $$;
revoke all on function public.get_order_timeline(text) from public;
grant execute on function public.get_order_timeline(text) to authenticated;

create or replace function public.list_pos_drafts() returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare rid text; result jsonb; begin
  select restaurant_id into rid from public.profiles where auth_user_id=auth.uid() and active
    and not coalesce(must_change_password,false) and role in ('admin','owner') limit 1;
  if rid is null then raise exception 'Access denied'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'customer_name',customer_name,'notes',notes,
    'lines',lines,'created_at',created_at,'updated_at',updated_at) order by updated_at desc),'[]'::jsonb)
    into result from public.pos_drafts where restaurant_id=rid;
  return result;
end $$;

create or replace function public.save_pos_draft(p_id uuid, p_name text, p_notes text, p_lines jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare rid text; draft_id uuid := coalesce(p_id,gen_random_uuid()); begin
  select restaurant_id into rid from public.profiles where auth_user_id=auth.uid() and active
    and not coalesce(must_change_password,false) and role in ('admin','owner') limit 1;
  if rid is null then raise exception 'Access denied'; end if;
  if length(coalesce(p_name,''))>120 or length(coalesce(p_notes,''))>2000 or jsonb_typeof(p_lines) is distinct from 'array'
    or jsonb_array_length(p_lines) not between 1 and 100 then raise exception 'Invalid draft'; end if;
  if exists(select 1 from jsonb_array_elements(p_lines) x where x->>'id' is null or (x->>'quantity') !~ '^[0-9]+$'
    or (x->>'quantity')::int not between 1 and 99) then raise exception 'Invalid draft lines'; end if;
  insert into public.pos_drafts(id,restaurant_id,created_by,customer_name,notes,lines)
    values(draft_id,rid,auth.uid(),coalesce(p_name,''),coalesce(p_notes,''),p_lines)
  on conflict(id) do update set customer_name=excluded.customer_name,notes=excluded.notes,lines=excluded.lines,
    updated_at=now() where pos_drafts.restaurant_id=rid;
  if not found then raise exception 'Draft not found'; end if;
  return draft_id;
end $$;

create or replace function public.delete_pos_draft(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare rid text; begin
  select restaurant_id into rid from public.profiles where auth_user_id=auth.uid() and active
    and not coalesce(must_change_password,false) and role in ('admin','owner') limit 1;
  if rid is null then raise exception 'Access denied'; end if;
  delete from public.pos_drafts where id=p_id and restaurant_id=rid;
end $$;

revoke all on function public.list_pos_drafts() from public;
revoke all on function public.save_pos_draft(uuid,text,text,jsonb) from public;
revoke all on function public.delete_pos_draft(uuid) from public;
grant execute on function public.list_pos_drafts() to authenticated;
grant execute on function public.save_pos_draft(uuid,text,text,jsonb) to authenticated;
grant execute on function public.delete_pos_draft(uuid) to authenticated;

commit;
