begin;

create table if not exists public.staff_order_signals (
  restaurant_id text primary key references public.restaurants(id) on delete cascade,
  revision bigint not null default 1,
  changed_at timestamptz not null default now()
);

alter table public.staff_order_signals enable row level security;

drop policy if exists "Staff can receive restaurant order signals" on public.staff_order_signals;
create policy "Staff can receive restaurant order signals"
  on public.staff_order_signals for select
  using (
    public.can_manage_restaurant(restaurant_id)
    or exists (
      select 1
      from public.profiles p
      where p.auth_user_id = auth.uid()
        and p.active
        and not coalesce(p.must_change_password, false)
        and p.role = 'staff'
        and p.restaurant_id = staff_order_signals.restaurant_id
        and public.has_open_staff_shift(staff_order_signals.restaurant_id)
    )
  );

revoke all on public.staff_order_signals from anon, authenticated;
grant select on public.staff_order_signals to authenticated;

create or replace function public.signal_staff_order_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_restaurant_id text;
begin
  target_restaurant_id := case when tg_op = 'DELETE' then old.restaurant_id else new.restaurant_id end;
  insert into public.staff_order_signals (restaurant_id, revision, changed_at)
  values (target_restaurant_id, 1, now())
  on conflict (restaurant_id) do update
    set revision = staff_order_signals.revision + 1,
        changed_at = excluded.changed_at;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.signal_staff_order_change() from public;

drop trigger if exists orders_signal_staff_realtime on public.orders;
create trigger orders_signal_staff_realtime
after insert or update or delete on public.orders
for each row execute function public.signal_staff_order_change();

insert into public.staff_order_signals (restaurant_id, revision, changed_at)
select id, 1, now() from public.restaurants
on conflict (restaurant_id) do nothing;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.staff_order_signals;
    exception when duplicate_object then null;
    end;
  end if;
end;
$$;

commit;
