create table if not exists staff_guides (
  id uuid primary key default gen_random_uuid(),
  restaurant_id text not null references restaurants(id) on delete cascade,
  menu_item_id text references menu_items(id) on delete set null,
  name_en text not null,
  name_de text not null,
  ingredients_en text[] not null default '{}',
  ingredients_de text[] not null default '{}',
  steps_en text[] not null default '{}',
  steps_de text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint staff_guides_name_en_length check (char_length(btrim(name_en)) between 1 and 160),
  constraint staff_guides_name_de_length check (char_length(btrim(name_de)) between 1 and 160),
  constraint staff_guides_ingredients_en_count check (cardinality(ingredients_en) between 1 and 100),
  constraint staff_guides_ingredients_de_count check (cardinality(ingredients_de) between 1 and 100),
  constraint staff_guides_steps_en_count check (cardinality(steps_en) between 1 and 100),
  constraint staff_guides_steps_de_count check (cardinality(steps_de) between 1 and 100),
  constraint staff_guides_ingredients_en_size check (char_length(array_to_string(ingredients_en, '')) <= 10000),
  constraint staff_guides_ingredients_de_size check (char_length(array_to_string(ingredients_de, '')) <= 10000),
  constraint staff_guides_steps_en_size check (char_length(array_to_string(steps_en, '')) <= 20000),
  constraint staff_guides_steps_de_size check (char_length(array_to_string(steps_de, '')) <= 20000)
);

create unique index if not exists staff_guides_linked_item_unique
  on staff_guides (restaurant_id, menu_item_id)
  where menu_item_id is not null and deleted_at is null;

create index if not exists staff_guides_restaurant_updated
  on staff_guides (restaurant_id, updated_at desc);

create or replace function validate_staff_guide_menu_item()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.menu_item_id is not null and not exists (
    select 1
    from menu_items
    where id = new.menu_item_id
      and restaurant_id = new.restaurant_id
  ) then
    raise exception 'Menu item does not belong to this restaurant';
  end if;

  new.name_en := btrim(new.name_en);
  new.name_de := btrim(new.name_de);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists staff_guides_validate_item on staff_guides;
create trigger staff_guides_validate_item
before insert or update on staff_guides
for each row execute function validate_staff_guide_menu_item();

alter table staff_guides enable row level security;

drop policy if exists "Restaurant users can read staff guides" on staff_guides;

create policy "Restaurant users can read staff guides"
on staff_guides for select
using (
  deleted_at is null
  and
  auth.role() = 'authenticated'
  and current_profile_restaurant_id() = restaurant_id
  and (
    current_profile_role() in ('admin', 'owner')
    or (
      current_profile_role() = 'staff'
      and exists (
        select 1 from staff_shifts
        where restaurant_id = staff_guides.restaurant_id
          and auth_user_id = auth.uid()
          and status = 'open'
      )
    )
  )
  and not exists (
    select 1
    from profiles
    where auth_user_id = auth.uid()
      and must_change_password = true
  )
);

create or replace function get_staff_guides()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id text;
  v_role text;
begin
  select restaurant_id, role
  into v_restaurant_id, v_role
  from profiles
  where auth_user_id = auth.uid()
    and active = true
    and must_change_password = false
  limit 1;

  if v_restaurant_id is null or v_role not in ('admin', 'owner', 'staff') then
    raise exception 'Access denied';
  end if;

  perform public.consume_rate_limit('staff-guides:read:' || auth.uid()::text, 120, 60);

  if v_role = 'staff' and not exists (
    select 1 from staff_shifts
    where restaurant_id = v_restaurant_id
      and auth_user_id = auth.uid()
      and status = 'open'
  ) then
    raise exception 'Active shift required';
  end if;

  return coalesce((
    select jsonb_agg(to_jsonb(guide) order by guide.name_de, guide.name_en)
    from staff_guides guide
    where guide.restaurant_id = v_restaurant_id
      and guide.deleted_at is null
  ), '[]'::jsonb);
end;
$$;

create or replace function save_staff_guide(
  p_id uuid,
  p_menu_item_id text,
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
begin
  if not can_manage_restaurant(v_restaurant_id) then
    raise exception 'Access denied';
  end if;

  perform public.consume_rate_limit('staff-guides:write:' || auth.uid()::text, 30, 60);

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
      restaurant_id, menu_item_id, name_en, name_de,
      ingredients_en, ingredients_de, steps_en, steps_de
    ) values (
      v_restaurant_id, nullif(btrim(p_menu_item_id), ''), btrim(p_name_en), btrim(p_name_de),
      v_ingredients_en, v_ingredients_de, v_steps_en, v_steps_de
    ) returning * into v_row;
  else
    update staff_guides
    set menu_item_id = nullif(btrim(p_menu_item_id), ''),
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

create or replace function delete_staff_guide(p_id uuid, p_expected_updated_at timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id text := current_profile_restaurant_id();
begin
  if not can_manage_restaurant(v_restaurant_id) then
    raise exception 'Access denied';
  end if;

  perform public.consume_rate_limit('staff-guides:write:' || auth.uid()::text, 30, 60);

  update staff_guides
  set deleted_at = now()
  where id = p_id
    and restaurant_id = v_restaurant_id
    and deleted_at is null
    and p_expected_updated_at is not null
    and updated_at = p_expected_updated_at;

  if not found then
    raise exception 'Guide changed or no longer exists';
  end if;
end;
$$;

revoke all on staff_guides from anon, authenticated;
grant select on staff_guides to authenticated;
revoke all on function get_staff_guides() from public;
revoke all on function save_staff_guide(uuid, text, text, text, text[], text[], text[], text[], timestamptz) from public;
revoke all on function delete_staff_guide(uuid, timestamptz) from public;
grant execute on function get_staff_guides() to authenticated;
grant execute on function save_staff_guide(uuid, text, text, text, text[], text[], text[], text[], timestamptz) to authenticated;
grant execute on function delete_staff_guide(uuid, timestamptz) to authenticated;

