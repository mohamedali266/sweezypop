begin;

-- Remove links left behind by catalog rows deleted before automatic cleanup existed.
update public.product_option_groups group_row
set linked_category_ids = coalesce((
      select array_agg(link_id order by ord)
      from unnest(group_row.linked_category_ids) with ordinality links(link_id,ord)
      where exists (
        select 1 from public.categories category
        where category.id=link_id and category.restaurant_id=group_row.restaurant_id
      )
    ),'{}'),
    linked_item_ids = coalesce((
      select array_agg(link_id order by ord)
      from unnest(group_row.linked_item_ids) with ordinality links(link_id,ord)
      where exists (
        select 1 from public.menu_items item
        where item.id=link_id and item.restaurant_id=group_row.restaurant_id
      )
    ),'{}')
where exists (
  select 1 from unnest(group_row.linked_category_ids) link_id
  where not exists (
    select 1 from public.categories category
    where category.id=link_id and category.restaurant_id=group_row.restaurant_id
  )
) or exists (
  select 1 from unnest(group_row.linked_item_ids) link_id
  where not exists (
    select 1 from public.menu_items item
    where item.id=link_id and item.restaurant_id=group_row.restaurant_id
  )
);

create or replace function public.remove_deleted_option_group_link()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if tg_table_name='categories' then
    update public.product_option_groups
    set linked_category_ids=array_remove(linked_category_ids,old.id)
    where restaurant_id=old.restaurant_id and old.id=any(linked_category_ids);
  elsif tg_table_name='menu_items' then
    update public.product_option_groups
    set linked_item_ids=array_remove(linked_item_ids,old.id)
    where restaurant_id=old.restaurant_id and old.id=any(linked_item_ids);
  end if;
  return old;
end $$;

drop trigger if exists remove_deleted_category_option_group_link on public.categories;
create trigger remove_deleted_category_option_group_link
after delete on public.categories
for each row execute function public.remove_deleted_option_group_link();

drop trigger if exists remove_deleted_item_option_group_link on public.menu_items;
create trigger remove_deleted_item_option_group_link
after delete on public.menu_items
for each row execute function public.remove_deleted_option_group_link();

commit;
