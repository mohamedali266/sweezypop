begin;

create table if not exists public.order_feedback (
  id uuid primary key default gen_random_uuid(),
  order_id text not null unique references public.orders(id) on delete cascade,
  restaurant_id text not null references public.restaurants(id) on delete cascade,
  rating smallint check (rating between 1 and 5),
  feedback text not null default '',
  submitted_at timestamptz not null default now(),
  constraint order_feedback_length check (char_length(feedback) <= 1000)
);

create index if not exists order_feedback_restaurant_submitted_idx
  on public.order_feedback(restaurant_id, submitted_at desc);

alter table public.order_feedback enable row level security;

drop policy if exists "Managers can read order feedback" on public.order_feedback;
create policy "Managers can read order feedback"
on public.order_feedback for select
using (public.can_manage_restaurant(restaurant_id));

revoke all on public.order_feedback from anon, authenticated;
grant select on public.order_feedback to authenticated;

create or replace function public.complete_public_order(
  p_id text,
  p_tracking_key uuid,
  p_rating integer default null,
  p_feedback text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tracked public.orders;
  clean_feedback text := btrim(coalesce(p_feedback, ''));
begin
  if p_id is null or p_tracking_key is null
    or (p_rating is not null and p_rating not between 1 and 5)
    or char_length(clean_feedback) > 1000 then
    raise exception 'Invalid feedback';
  end if;

  select * into tracked
  from public.orders
  where id = p_id and request_key = p_tracking_key and source = 'menu'
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  perform public.consume_rate_limit('order-completion:' || md5(p_tracking_key::text), 4, 60);

  if tracked.status not in ('ready', 'done') then
    raise exception 'Order is not ready';
  end if;

  if tracked.status = 'ready' then
    update public.orders
    set status = 'done', completed_at = coalesce(completed_at, now())
    where id = tracked.id;
    insert into public.order_events(order_id, actor, previous_status, next_status)
    values(tracked.id, '00000000-0000-0000-0000-000000000000'::uuid, 'ready', 'done');
  end if;

  if p_rating is not null or clean_feedback <> '' then
    insert into public.order_feedback(order_id, restaurant_id, rating, feedback)
    values(tracked.id, tracked.restaurant_id, p_rating, clean_feedback)
    on conflict(order_id) do update
      set rating = excluded.rating,
          feedback = excluded.feedback,
          submitted_at = now();
  end if;

  return jsonb_build_object('id', tracked.id, 'status', 'done', 'received', true);
end;
$$;

revoke all on function public.complete_public_order(text, uuid, integer, text) from public;
grant execute on function public.complete_public_order(text, uuid, integer, text) to anon, authenticated;

commit;
