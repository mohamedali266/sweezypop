begin;

create index if not exists idx_opening_hours_restaurant_sort
  on public.opening_hours(restaurant_id, sort_order);
create index if not exists idx_product_option_groups_restaurant_active_sort
  on public.product_option_groups(restaurant_id, active, sort_order);

create or replace function public.reject_new_embedded_menu_images()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(new.image_url, '') like 'data:%'
    and (tg_op = 'INSERT' or old.image_url is distinct from new.image_url) then
    raise exception 'Embedded images are not allowed. Upload the image file instead.';
  end if;
  return new;
end;
$$;

drop trigger if exists reject_new_embedded_menu_images on public.menu_items;
create trigger reject_new_embedded_menu_images
before insert or update of image_url on public.menu_items
for each row execute function public.reject_new_embedded_menu_images();

create or replace function public.get_public_menu_image(p_slug text, p_item_id text)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select item.image_url
  from public.menu_items item
  join public.restaurants restaurant on restaurant.id = item.restaurant_id
  where restaurant.public_slug = p_slug
    and item.id = p_item_id
    and item.image_url ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$'
    and length(item.image_url) <= 7000000
  limit 1
$$;

revoke all on function public.get_public_menu_image(text, text) from public;
grant execute on function public.get_public_menu_image(text, text) to anon, authenticated;

create or replace function public.get_public_menu_bootstrap(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  target_restaurant public.restaurants;
  result jsonb;
begin
  select * into target_restaurant
  from public.restaurants
  where public_slug = p_slug;

  if target_restaurant.id is null then
    raise exception 'Menu not found';
  end if;

  select jsonb_build_object(
    'restaurant', jsonb_build_object(
      'id', target_restaurant.id,
      'name', target_restaurant.name,
      'logo_text', target_restaurant.logo_text,
      'logo_url', target_restaurant.logo_url,
      'app_icon_url', target_restaurant.app_icon_url,
      'favicon_url', target_restaurant.favicon_url,
      'menu_url', target_restaurant.menu_url,
      'primary_color', target_restaurant.primary_color,
      'accent_color', target_restaurant.accent_color,
      'lavender_color', target_restaurant.lavender_color,
      'background_color', target_restaurant.background_color,
      'surface_color', target_restaurant.surface_color,
      'text_color', target_restaurant.text_color,
      'muted_text_color', target_restaurant.muted_text_color,
      'button_text_color', target_restaurant.button_text_color,
      'card_color', target_restaurant.card_color,
      'border_color', target_restaurant.border_color,
      'menu_layout', target_restaurant.menu_layout,
      'social_links', target_restaurant.social_links,
      'phone_country_code', target_restaurant.phone_country_code,
      'phone_number', target_restaurant.phone_number
    ),
    'categories', coalesce((
      select jsonb_agg(to_jsonb(category_row) order by category_row.sort_order)
      from (
        select id, name_en, name_de, sort_order
        from public.categories
        where restaurant_id = target_restaurant.id
      ) category_row
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(to_jsonb(item_row) order by item_row.sort_order)
      from (
        select id, category_id, name_en, name_de, description_en, description_de,
          price, badge_en, badge_de, image_style,
          case
            when image_url like 'data:image/%;base64,%'
              then 'legacy-image:' || id || ':' || md5(image_url)
            else image_url
          end as image_url,
          available, included_item_ids, sizes, option_group_ids, sort_order
        from public.menu_items
        where restaurant_id = target_restaurant.id
      ) item_row
    ), '[]'::jsonb),
    'option_groups', coalesce((
      select jsonb_agg(to_jsonb(group_row) order by group_row.sort_order)
      from (
        select id, name_en, name_de, mode, required, min_select, max_select,
          options, linked_category_ids, linked_item_ids, active, sort_order
        from public.product_option_groups
        where restaurant_id = target_restaurant.id and active
      ) group_row
    ), '[]'::jsonb),
    'hours', coalesce((
      select jsonb_agg(to_jsonb(hour_row) order by hour_row.sort_order)
      from (
        select day, open_time, close_time, enabled, sort_order
        from public.opening_hours
        where restaurant_id = target_restaurant.id
      ) hour_row
    ), '[]'::jsonb),
    'content', coalesce((
      select jsonb_build_object(
        'reviews_visible', reviews_visible,
        'footer_copyright_en', footer_copyright_en,
        'footer_copyright_de', footer_copyright_de
      )
      from public.restaurant_content_settings
      where restaurant_id = target_restaurant.id
    ), '{}'::jsonb)
  ) into result;

  return result;
end;
$$;

drop policy if exists "Public can read restaurants" on public.restaurants;
drop policy if exists "Public can read categories" on public.categories;
drop policy if exists "Public can read menu items" on public.menu_items;
drop policy if exists "Public can read opening hours" on public.opening_hours;
drop policy if exists "Public can read content settings" on public.restaurant_content_settings;
drop policy if exists "Public reads active product option groups" on public.product_option_groups;

drop policy if exists "Managers can read restaurants" on public.restaurants;
create policy "Managers can read restaurants"
on public.restaurants for select to authenticated
using (public.can_manage_restaurant(id));

revoke select on public.restaurants, public.categories, public.menu_items,
  public.opening_hours, public.restaurant_content_settings,
  public.product_option_groups from anon;
revoke insert, update, delete on public.orders, public.order_lines from anon, authenticated;

commit;
