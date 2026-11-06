begin;

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
          price, badge_en, badge_de, image_style, image_url, available,
          included_item_ids, sizes, option_group_ids, sort_order
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

revoke all on function public.get_public_menu_bootstrap(text) from public;
grant execute on function public.get_public_menu_bootstrap(text) to anon, authenticated;

commit;
