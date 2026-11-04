begin;

create or replace function public.product_size_base_price(value jsonb) returns numeric language sql immutable as $$
  select min((size->>'price')::numeric)
  from jsonb_array_elements(value) size
  where (size->>'available')::boolean
$$;

alter table public.menu_items drop constraint if exists menu_items_size_base_price_check;
alter table public.menu_items add constraint menu_items_size_base_price_check check (
  jsonb_array_length(sizes)=0 or price=public.product_size_base_price(sizes)
);

commit;
