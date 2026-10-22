create or replace function public.set_staff_order_status(p_id text,p_expected text,p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.profiles; o public.orders; shift_id uuid; changed_at timestamptz := now();
begin
  select * into p from public.current_active_profile();
  if p.id is null or p.role<>'staff' or not public.has_open_staff_shift(p.restaurant_id) then
    raise exception 'Active staff shift required'; end if;
  select id into shift_id from public.staff_shifts where auth_user_id=auth.uid() and status='open' for update;
  select * into o from public.orders where id=p_id and restaurant_id=p.restaurant_id for update;
  if not found then raise exception 'Order not found'; end if;
  if o.status is distinct from p_expected then raise exception 'Order changed. Refresh and retry.'; end if;
  if not ((o.status='new' and p_status='preparing') or (o.status='accepted' and p_status='preparing')
    or (o.status='preparing' and p_status='ready') or (o.status='ready' and p_status='done')) then
    raise exception 'Invalid status transition'; end if;
  update public.orders set status=p_status,assigned_staff_id=coalesce(assigned_staff_id,p.id),
    accepted_at=case when o.status='new' and p_status='preparing' then coalesce(accepted_at,changed_at) else accepted_at end,
    preparing_at=case when p_status='preparing' then coalesce(preparing_at,changed_at) else preparing_at end,
    ready_at=case when p_status='ready' then coalesce(ready_at,changed_at) else ready_at end,
    completed_at=case when p_status='done' then coalesce(completed_at,changed_at) else completed_at end where id=p_id;
  insert into public.order_events(order_id,actor,previous_status,next_status) values(p_id,auth.uid(),o.status,p_status);
  if p_status='done' then update public.staff_shifts set orders_handled=orders_handled+1 where id=shift_id; end if;
  return jsonb_build_object('id',p_id,'status',p_status);
end $$;

revoke all on function public.set_staff_order_status(text,text,text) from public;
grant execute on function public.set_staff_order_status(text,text,text) to authenticated;
