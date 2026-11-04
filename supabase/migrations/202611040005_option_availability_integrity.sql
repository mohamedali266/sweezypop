begin;

create or replace function public.has_available_product_option(value jsonb) returns boolean language sql immutable as $$
  select exists (
    select 1 from jsonb_array_elements(value) option
    where coalesce((option->>'available')::boolean,false)
  )
$$;

update public.product_option_groups
set options=(
  select jsonb_agg(option || jsonb_build_object('available',true) order by ord)
  from jsonb_array_elements(options) with ordinality valueset(option,ord)
), updated_at=now()
where active and jsonb_array_length(options)>0 and not public.has_available_product_option(options);

alter table public.product_option_groups drop constraint if exists product_option_groups_active_option_check;
alter table public.product_option_groups add constraint product_option_groups_active_option_check check (
  not active or public.has_available_product_option(options)
);

commit;
