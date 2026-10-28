begin;

create or replace function public.get_review_management()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  target_restaurant text := public.current_profile_restaurant_id();
  settings_row public.restaurant_content_settings;
  reviews jsonb;
begin
  if target_restaurant is null or public.can_manage_restaurant(target_restaurant) is not true then
    raise exception 'Access denied';
  end if;

  select * into settings_row from public.restaurant_content_settings where restaurant_id = target_restaurant;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', feedback.id,
    'customer_name', customer_order.customer_name,
    'order_number', customer_order.order_number,
    'rating', feedback.rating,
    'feedback', feedback.feedback,
    'visible', feedback.visible,
    'submitted_at', feedback.submitted_at
  ) order by feedback.submitted_at desc), '[]'::jsonb)
  into reviews
  from public.order_feedback feedback
  join public.orders customer_order on customer_order.id = feedback.order_id
  where feedback.restaurant_id = target_restaurant
    and (feedback.rating is not null or btrim(feedback.feedback) <> '');

  return jsonb_build_object(
    'reviews_visible', coalesce(settings_row.reviews_visible, true),
    'footer_copyright_en', coalesce(settings_row.footer_copyright_en, '© 2026 Sweezypop. All rights reserved.'),
    'footer_copyright_de', coalesce(settings_row.footer_copyright_de, '© 2026 Sweezypop. Alle Rechte vorbehalten.'),
    'reviews', reviews
  );
end;
$$;

create or replace function public.set_review_visibility(p_feedback_id uuid, p_visible boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare target_restaurant text := public.current_profile_restaurant_id();
begin
  if target_restaurant is null or public.can_manage_restaurant(target_restaurant) is not true then
    raise exception 'Access denied';
  end if;
  update public.order_feedback set visible = coalesce(p_visible, false)
  where id = p_feedback_id and restaurant_id = target_restaurant;
  if not found then raise exception 'Feedback not found'; end if;
end;
$$;

create or replace function public.set_reviews_section_visibility(p_visible boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare target_restaurant text := public.current_profile_restaurant_id();
begin
  if target_restaurant is null or public.can_manage_restaurant(target_restaurant) is not true then
    raise exception 'Access denied';
  end if;
  insert into public.restaurant_content_settings(restaurant_id, reviews_visible, updated_at)
  values(target_restaurant, coalesce(p_visible, false), now())
  on conflict(restaurant_id) do update set reviews_visible = excluded.reviews_visible, updated_at = now();
end;
$$;

create or replace function public.save_footer_content(p_copyright_en text, p_copyright_de text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_restaurant text := public.current_profile_restaurant_id();
  clean_en text := btrim(coalesce(p_copyright_en, ''));
  clean_de text := btrim(coalesce(p_copyright_de, ''));
begin
  if target_restaurant is null
    or public.can_manage_restaurant(target_restaurant) is not true
    or public.current_profile_role() <> 'admin' then
    raise exception 'Access denied';
  end if;
  if char_length(clean_en) not between 1 and 300 or char_length(clean_de) not between 1 and 300 then
    raise exception 'Invalid footer content';
  end if;
  insert into public.restaurant_content_settings(restaurant_id, footer_copyright_en, footer_copyright_de, updated_at)
  values(target_restaurant, clean_en, clean_de, now())
  on conflict(restaurant_id) do update
    set footer_copyright_en = excluded.footer_copyright_en,
        footer_copyright_de = excluded.footer_copyright_de,
        updated_at = now();
end;
$$;

commit;
