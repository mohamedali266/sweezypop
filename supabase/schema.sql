create extension if not exists pgcrypto;

create table if not exists restaurants (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  public_slug text unique not null,
  logo_text text,
  logo_url text,
  menu_url text,
  primary_color text default '#ff7eb6',
  accent_color text default '#20c7b5',
  lavender_color text default '#b9a4ff',
  background_color text default '#fff7fb',
  surface_color text default '#ffffff',
  text_color text default '#211b33',
  muted_text_color text default '#756a80',
  button_text_color text default '#ffffff',
  card_color text default '#ffffff',
  border_color text default '#eadff0',
  menu_layout text default 'grid' check (menu_layout in ('grid', 'list')),
  created_at timestamptz default now()
);

create table if not exists profiles (
  id text primary key default gen_random_uuid()::text,
  auth_user_id uuid unique references auth.users(id) on delete cascade,
  restaurant_id text references restaurants(id) on delete cascade,
  name text not null,
  email text unique not null,
  role text not null check (role in ('admin', 'owner')),
  restaurant_name text,
  active boolean default true,
  must_change_password boolean default false,
  temporary_password_issued_at timestamptz,
  password_changed_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists categories (
  id text primary key,
  restaurant_id text not null references restaurants(id) on delete cascade,
  name_en text not null,
  name_de text not null,
  sort_order integer default 0,
  created_at timestamptz default now()
);

create table if not exists menu_items (
  id text primary key,
  restaurant_id text not null references restaurants(id) on delete cascade,
  category_id text references categories(id) on delete set null,
  name_en text not null,
  name_de text not null,
  description_en text default '',
  description_de text default '',
  price numeric(10, 2) not null check (price >= 0),
  badge_en text,
  badge_de text,
  image_style text default 'pink',
  image_url text,
  available boolean default true,
  sort_order integer default 0,
  created_at timestamptz default now()
);

create table if not exists opening_hours (
  id text primary key,
  restaurant_id text not null references restaurants(id) on delete cascade,
  day text not null,
  open_time text not null,
  close_time text not null,
  enabled boolean default true,
  sort_order integer default 0
);

create table if not exists orders (
  id text primary key,
  restaurant_id text not null references restaurants(id) on delete cascade,
  customer_name text not null,
  address text,
  phone text not null,
  notes text default '',
  status text not null default 'new' check (status in ('new', 'preparing', 'done')),
  total numeric(10, 2) not null check (total >= 0),
  created_at timestamptz default now()
);

create table if not exists order_lines (
  id text primary key,
  order_id text not null references orders(id) on delete cascade,
  menu_item_id text references menu_items(id) on delete set null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(10, 2) not null check (unit_price >= 0)
);

create index if not exists idx_categories_restaurant on categories(restaurant_id, sort_order);
create index if not exists idx_menu_items_restaurant on menu_items(restaurant_id, sort_order);
create index if not exists idx_orders_restaurant on orders(restaurant_id, created_at desc);
create index if not exists idx_profiles_auth_user on profiles(auth_user_id);

alter table restaurants enable row level security;
alter table profiles enable row level security;
alter table categories enable row level security;
alter table menu_items enable row level security;
alter table opening_hours enable row level security;
alter table orders enable row level security;
alter table order_lines enable row level security;

create or replace function current_profile_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role from profiles where auth_user_id = auth.uid() and active = true limit 1
$$;

create or replace function current_profile_restaurant_id()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select restaurant_id from profiles where auth_user_id = auth.uid() and active = true limit 1
$$;

create or replace function can_manage_restaurant(target_restaurant_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select auth.role() = 'authenticated'
    and current_profile_role() in ('admin', 'owner')
    and current_profile_restaurant_id() = target_restaurant_id
$$;

drop policy if exists "Public can read restaurants" on restaurants;
drop policy if exists "Managers can update restaurants" on restaurants;
drop policy if exists "Managers can read profiles" on profiles;
drop policy if exists "Users can read own profile" on profiles;
drop policy if exists "Admins can manage profiles" on profiles;
drop policy if exists "Public can read categories" on categories;
drop policy if exists "Managers can manage categories" on categories;
drop policy if exists "Public can read menu items" on menu_items;
drop policy if exists "Managers can manage menu items" on menu_items;
drop policy if exists "Public can read opening hours" on opening_hours;
drop policy if exists "Managers can manage opening hours" on opening_hours;
drop policy if exists "Public can create orders" on orders;
drop policy if exists "Managers can read orders" on orders;
drop policy if exists "Managers can update orders" on orders;
drop policy if exists "Public can create order lines" on order_lines;
drop policy if exists "Managers can read order lines" on order_lines;

create policy "Public can read restaurants"
on restaurants for select
using (true);

create policy "Managers can update restaurants"
on restaurants for update
using (can_manage_restaurant(id))
with check (can_manage_restaurant(id));

create policy "Managers can read profiles"
on profiles for select
using (can_manage_restaurant(restaurant_id));

create policy "Users can read own profile"
on profiles for select
using (auth_user_id = auth.uid() and active = true);

create policy "Admins can manage profiles"
on profiles for all
using (current_profile_role() = 'admin' and current_profile_restaurant_id() = restaurant_id)
with check (current_profile_role() = 'admin' and current_profile_restaurant_id() = restaurant_id);

create policy "Public can read categories"
on categories for select
using (true);

create policy "Managers can manage categories"
on categories for all
using (can_manage_restaurant(restaurant_id))
with check (can_manage_restaurant(restaurant_id));

create policy "Public can read menu items"
on menu_items for select
using (true);

create policy "Managers can manage menu items"
on menu_items for all
using (can_manage_restaurant(restaurant_id))
with check (can_manage_restaurant(restaurant_id));

create policy "Public can read opening hours"
on opening_hours for select
using (true);

create policy "Managers can manage opening hours"
on opening_hours for all
using (can_manage_restaurant(restaurant_id))
with check (can_manage_restaurant(restaurant_id));

create policy "Public can create orders"
on orders for insert
with check (true);

create policy "Managers can read orders"
on orders for select
using (can_manage_restaurant(restaurant_id));

create policy "Managers can update orders"
on orders for update
using (can_manage_restaurant(restaurant_id))
with check (can_manage_restaurant(restaurant_id));

create policy "Public can create order lines"
on order_lines for insert
with check (
  exists (
    select 1 from orders
    where orders.id = order_lines.order_id
      and orders.created_at > now() - interval '30 minutes'
  )
);

create policy "Managers can read order lines"
on order_lines for select
using (
  exists (
    select 1 from orders
    where orders.id = order_lines.order_id
      and can_manage_restaurant(orders.restaurant_id)
  )
);

insert into restaurants (
  id,
  name,
  public_slug,
  logo_text,
  menu_url
) values (
  'sweezypop',
  'Sweezypop',
  'sweezypop',
  'Sweezypop',
  'https://sweezypop.vercel.app'
) on conflict (id) do nothing;
