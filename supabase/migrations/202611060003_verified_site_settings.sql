begin;

create or replace function public.save_site_settings(
  p_settings jsonb,
  p_layout text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_restaurant text := public.current_profile_restaurant_id();
  saved public.restaurants;
  logo_url_value text := nullif(btrim(coalesce(p_settings->>'logo_url', '')), '');
  app_icon_url_value text := nullif(btrim(coalesce(p_settings->>'app_icon_url', '')), '');
  favicon_url_value text := nullif(btrim(coalesce(p_settings->>'favicon_url', '')), '');
  social_links_value jsonb := coalesce(p_settings->'social_links', '[]'::jsonb);
begin
  if target_restaurant is null or public.can_manage_restaurant(target_restaurant) is not true then
    raise exception 'Access denied';
  end if;

  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    raise exception 'Invalid settings';
  end if;
  if p_layout not in ('grid', 'list') then
    raise exception 'Invalid menu layout';
  end if;
  if jsonb_typeof(social_links_value) <> 'array' or jsonb_array_length(social_links_value) > 20 then
    raise exception 'Invalid social links';
  end if;
  if length(btrim(coalesce(p_settings->>'name', ''))) not between 1 and 120
     or length(coalesce(p_settings->>'logo_text', '')) > 120
     or length(coalesce(p_settings->>'phone_country_code', '')) > 8
     or length(coalesce(p_settings->>'phone_number', '')) > 32 then
    raise exception 'Invalid settings value';
  end if;
  if (logo_url_value is not null and (length(logo_url_value) > 2048 or logo_url_value !~ '^https://'))
     or (app_icon_url_value is not null and (length(app_icon_url_value) > 2048 or app_icon_url_value !~ '^https://'))
     or (favicon_url_value is not null and (length(favicon_url_value) > 2048 or favicon_url_value !~ '^https://')) then
    raise exception 'Invalid brand asset URL';
  end if;

  update public.restaurants
  set
    name = btrim(p_settings->>'name'),
    logo_text = nullif(btrim(coalesce(p_settings->>'logo_text', '')), ''),
    logo_url = logo_url_value,
    app_icon_url = app_icon_url_value,
    favicon_url = favicon_url_value,
    menu_url = nullif(btrim(coalesce(p_settings->>'menu_url', '')), ''),
    primary_color = coalesce(nullif(p_settings->>'primary_color', ''), primary_color),
    accent_color = coalesce(nullif(p_settings->>'accent_color', ''), accent_color),
    lavender_color = coalesce(nullif(p_settings->>'lavender_color', ''), lavender_color),
    background_color = coalesce(nullif(p_settings->>'background_color', ''), background_color),
    surface_color = coalesce(nullif(p_settings->>'surface_color', ''), surface_color),
    text_color = coalesce(nullif(p_settings->>'text_color', ''), text_color),
    muted_text_color = coalesce(nullif(p_settings->>'muted_text_color', ''), muted_text_color),
    button_text_color = coalesce(nullif(p_settings->>'button_text_color', ''), button_text_color),
    card_color = coalesce(nullif(p_settings->>'card_color', ''), card_color),
    border_color = coalesce(nullif(p_settings->>'border_color', ''), border_color),
    menu_layout = p_layout,
    social_links = social_links_value,
    phone_country_code = nullif(btrim(coalesce(p_settings->>'phone_country_code', '')), ''),
    phone_number = nullif(btrim(coalesce(p_settings->>'phone_number', '')), '')
  where id = target_restaurant
  returning * into saved;

  if saved.id is null then
    raise exception 'Restaurant settings were not saved';
  end if;

  return jsonb_build_object(
    'restaurant_id', saved.id,
    'logo_url', saved.logo_url,
    'app_icon_url', saved.app_icon_url,
    'favicon_url', saved.favicon_url,
    'menu_layout', saved.menu_layout
  );
end;
$$;

revoke all on function public.save_site_settings(jsonb, text) from public, anon;
grant execute on function public.save_site_settings(jsonb, text) to authenticated;

commit;
