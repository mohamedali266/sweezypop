begin;

alter table public.order_feedback
  add column if not exists visible boolean not null default false;

create index if not exists order_feedback_public_idx
  on public.order_feedback(restaurant_id, submitted_at desc)
  where visible = true;

create table if not exists public.restaurant_content_settings (
  restaurant_id text primary key references public.restaurants(id) on delete cascade,
  reviews_visible boolean not null default true,
  footer_copyright_en text not null default '© 2026 Sweezypop. All rights reserved.',
  footer_copyright_de text not null default '© 2026 Sweezypop. Alle Rechte vorbehalten.',
  updated_at timestamptz not null default now(),
  constraint footer_copyright_en_length check (char_length(footer_copyright_en) between 1 and 300),
  constraint footer_copyright_de_length check (char_length(footer_copyright_de) between 1 and 300)
);

insert into public.restaurant_content_settings(restaurant_id)
select id from public.restaurants
on conflict (restaurant_id) do nothing;

alter table public.restaurant_content_settings enable row level security;

drop policy if exists "Public can read content settings" on public.restaurant_content_settings;
create policy "Public can read content settings"
on public.restaurant_content_settings for select
using (true);

revoke insert, update, delete on public.restaurant_content_settings from anon, authenticated;
grant select on public.restaurant_content_settings to anon, authenticated;

create or replace function public.get_public_reviews(p_slug text, p_limit integer default 16)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(review_row order by review_row.submitted_at desc), '[]'::jsonb)
  from (
    select
      feedback.id,
      coalesce(nullif(split_part(btrim(customer_order.customer_name), ' ', 1), ''), 'Guest') as display_name,
      feedback.rating,
      feedback.feedback,
      feedback.submitted_at
    from public.order_feedback feedback
    join public.orders customer_order on customer_order.id = feedback.order_id
    join public.restaurants restaurant on restaurant.id = feedback.restaurant_id
    join public.restaurant_content_settings settings on settings.restaurant_id = restaurant.id
    where restaurant.public_slug = p_slug
      and settings.reviews_visible = true
      and feedback.visible = true
      and feedback.rating is not null
      and btrim(feedback.feedback) <> ''
    order by feedback.submitted_at desc
    limit least(greatest(coalesce(p_limit, 16), 1), 30)
  ) review_row
$$;

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
  if auth.role() <> 'authenticated'
    or public.current_profile_role() not in ('admin', 'owner')
    or target_restaurant is null then
    raise exception 'Access denied';
  end if;

  select * into settings_row
  from public.restaurant_content_settings
  where restaurant_id = target_restaurant;

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
declare
  target_restaurant text := public.current_profile_restaurant_id();
begin
  if auth.role() <> 'authenticated'
    or public.current_profile_role() not in ('admin', 'owner')
    or target_restaurant is null then
    raise exception 'Access denied';
  end if;

  update public.order_feedback
  set visible = coalesce(p_visible, false)
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
declare
  target_restaurant text := public.current_profile_restaurant_id();
begin
  if auth.role() <> 'authenticated'
    or public.current_profile_role() not in ('admin', 'owner')
    or target_restaurant is null then
    raise exception 'Access denied';
  end if;

  insert into public.restaurant_content_settings(restaurant_id, reviews_visible, updated_at)
  values(target_restaurant, coalesce(p_visible, false), now())
  on conflict(restaurant_id) do update
    set reviews_visible = excluded.reviews_visible, updated_at = now();
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
  if auth.role() <> 'authenticated'
    or public.current_profile_role() <> 'admin'
    or target_restaurant is null then
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

revoke all on function public.get_public_reviews(text, integer) from public;
revoke all on function public.get_review_management() from public;
revoke all on function public.set_review_visibility(uuid, boolean) from public;
revoke all on function public.set_reviews_section_visibility(boolean) from public;
revoke all on function public.save_footer_content(text, text) from public;

grant execute on function public.get_public_reviews(text, integer) to anon, authenticated;
grant execute on function public.get_review_management() to authenticated;
grant execute on function public.set_review_visibility(uuid, boolean) to authenticated;
grant execute on function public.set_reviews_section_visibility(boolean) to authenticated;
grant execute on function public.save_footer_content(text, text) to authenticated;

commit;
