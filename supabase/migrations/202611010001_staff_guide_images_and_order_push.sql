alter table public.staff_guides
  add column if not exists image_url text;

alter table public.staff_guides
  drop constraint if exists staff_guides_image_url_size;

alter table public.staff_guides
  add constraint staff_guides_image_url_size
  check (image_url is null or char_length(image_url) <= 2100000);

drop function if exists public.save_staff_guide(uuid, text, text, text, text[], text[], text[], text[], timestamptz);

create or replace function public.save_staff_guide(
  p_id uuid,
  p_menu_item_id text,
  p_image_url text,
  p_name_en text,
  p_name_de text,
  p_ingredients_en text[],
  p_ingredients_de text[],
  p_steps_en text[],
  p_steps_de text[],
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id text := current_profile_restaurant_id();
  v_row staff_guides;
  v_ingredients_en text[];
  v_ingredients_de text[];
  v_steps_en text[];
  v_steps_de text[];
  v_image_url text := nullif(btrim(coalesce(p_image_url, '')), '');
begin
  if not can_manage_restaurant(v_restaurant_id) then
    raise exception 'Access denied';
  end if;

  perform public.consume_rate_limit('staff-guides:write:' || auth.uid()::text, 30, 60);

  if v_image_url is not null
    and v_image_url !~* '^(data:image/(png|jpeg|jpg|webp|gif);base64,|https://)'
  then
    raise exception 'Guide image must be a supported image or HTTPS URL';
  end if;

  if p_menu_item_id is not null and exists (
    select 1 from staff_guides
    where restaurant_id = v_restaurant_id
      and menu_item_id = nullif(btrim(p_menu_item_id), '')
      and deleted_at is null
      and (p_id is null or id <> p_id)
  ) then
    raise exception 'This menu item already has a preparation guide';
  end if;

  select coalesce(array_agg(btrim(value)) filter (where btrim(value) <> ''), '{}') into v_ingredients_en from unnest(coalesce(p_ingredients_en, '{}')) value;
  select coalesce(array_agg(btrim(value)) filter (where btrim(value) <> ''), '{}') into v_ingredients_de from unnest(coalesce(p_ingredients_de, '{}')) value;
  select coalesce(array_agg(btrim(value)) filter (where btrim(value) <> ''), '{}') into v_steps_en from unnest(coalesce(p_steps_en, '{}')) value;
  select coalesce(array_agg(btrim(value)) filter (where btrim(value) <> ''), '{}') into v_steps_de from unnest(coalesce(p_steps_de, '{}')) value;

  if btrim(coalesce(p_name_en, '')) = '' or btrim(coalesce(p_name_de, '')) = ''
    or cardinality(v_ingredients_en) = 0 or cardinality(v_ingredients_de) = 0
    or cardinality(v_steps_en) = 0 or cardinality(v_steps_de) = 0 then
    raise exception 'Names, ingredients and steps are required in both languages';
  end if;

  if p_id is null then
    insert into staff_guides (
      restaurant_id, menu_item_id, image_url, name_en, name_de,
      ingredients_en, ingredients_de, steps_en, steps_de
    ) values (
      v_restaurant_id, nullif(btrim(p_menu_item_id), ''), v_image_url, btrim(p_name_en), btrim(p_name_de),
      v_ingredients_en, v_ingredients_de, v_steps_en, v_steps_de
    ) returning * into v_row;
  else
    update staff_guides
    set menu_item_id = nullif(btrim(p_menu_item_id), ''),
        image_url = v_image_url,
        name_en = btrim(p_name_en),
        name_de = btrim(p_name_de),
        ingredients_en = v_ingredients_en,
        ingredients_de = v_ingredients_de,
        steps_en = v_steps_en,
        steps_de = v_steps_de
    where id = p_id
      and restaurant_id = v_restaurant_id
      and deleted_at is null
      and p_expected_updated_at is not null
      and updated_at = p_expected_updated_at
    returning * into v_row;

    if v_row.id is null then
      raise exception 'Guide changed or no longer exists';
    end if;
  end if;

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.save_staff_guide(uuid, text, text, text, text, text[], text[], text[], text[], timestamptz) from public;
grant execute on function public.save_staff_guide(uuid, text, text, text, text, text[], text[], text[], text[], timestamptz) to authenticated;

create table if not exists public.order_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.orders(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  locale text not null default 'de' check (locale in ('de', 'en')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, endpoint),
  constraint order_push_endpoint_size check (char_length(endpoint) between 20 and 2000),
  constraint order_push_p256dh_size check (char_length(p256dh) between 20 and 500),
  constraint order_push_auth_size check (char_length(auth) between 8 and 200)
);

create index if not exists order_push_subscriptions_order_id_idx
  on public.order_push_subscriptions(order_id);

alter table public.order_push_subscriptions enable row level security;
revoke all on public.order_push_subscriptions from anon, authenticated;

create or replace function public.register_order_push(
  p_id text,
  p_tracking_key uuid,
  p_subscription jsonb,
  p_locale text default 'de'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_endpoint text := btrim(coalesce(p_subscription->>'endpoint', ''));
  v_p256dh text := btrim(coalesce(p_subscription#>>'{keys,p256dh}', ''));
  v_auth text := btrim(coalesce(p_subscription#>>'{keys,auth}', ''));
begin
  if p_id is null or p_tracking_key is null
    or v_endpoint !~ '^https://'
    or char_length(v_endpoint) not between 20 and 2000
    or char_length(v_p256dh) not between 20 and 500
    or char_length(v_auth) not between 8 and 200
  then
    raise exception 'Invalid push subscription';
  end if;

  if not exists (
    select 1 from public.orders
    where id = p_id
      and request_key = p_tracking_key
      and source = 'menu'
      and status in ('new', 'accepted', 'preparing', 'ready')
  ) then
    raise exception 'Order tracking not found';
  end if;

  perform public.consume_rate_limit('order-push:' || md5(p_tracking_key::text), 8, 60);

  insert into public.order_push_subscriptions(order_id, endpoint, p256dh, auth, locale)
  values (p_id, v_endpoint, v_p256dh, v_auth, case when p_locale = 'en' then 'en' else 'de' end)
  on conflict (order_id, endpoint) do update
  set p256dh = excluded.p256dh,
      auth = excluded.auth,
      locale = excluded.locale,
      updated_at = now();
end;
$$;

revoke all on function public.register_order_push(text, uuid, jsonb, text) from public;
grant execute on function public.register_order_push(text, uuid, jsonb, text) to anon, authenticated;
