begin;

create or replace function public.get_public_order_tracking(p_id text, p_tracking_key uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tracked public.orders;
begin
  if p_id is null or p_tracking_key is null then
    raise exception 'Invalid tracking credentials';
  end if;

  select * into tracked
  from public.orders
  where id = p_id and request_key = p_tracking_key and source = 'menu';

  if not found then
    raise exception 'Order not found';
  end if;

  perform public.consume_rate_limit('order-tracking:' || md5(p_tracking_key::text), 12, 60);

  return jsonb_build_object(
    'id', tracked.id,
    'order_number', tracked.order_number,
    'customer_name', tracked.customer_name,
    'notes', tracked.notes,
    'total', tracked.total,
    'status', tracked.status,
    'created_at', tracked.created_at,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', line.menu_item_id,
        'name_en', coalesce(line.name_en, 'Historical item'),
        'name_de', coalesce(line.name_de, 'Archivierter Artikel'),
        'price', line.unit_price,
        'quantity', line.quantity
      ) order by line.id)
      from public.order_lines line
      where line.order_id = tracked.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_public_order_tracking(text, uuid) from public;
grant execute on function public.get_public_order_tracking(text, uuid) to anon, authenticated;

commit;
