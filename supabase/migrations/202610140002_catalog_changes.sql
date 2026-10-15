begin;
create or replace function public.save_catalog_changes(p_restaurant text, p_changes jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare change jsonb; tab text; rid text; old jsonb; nextrow jsonb; currentrow jsonb; columns_sql text; values_sql text; allowed text[];
begin
  if not public.can_manage_restaurant(p_restaurant) then raise exception 'Access denied'; end if;
  if jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes)>2000 then raise exception 'Invalid changes'; end if;
  perform pg_advisory_xact_lock(hashtextextended('catalog:' || p_restaurant,0));
  -- Inserts/updates precede deletes; categories precede items for imports.
  for change in select value from jsonb_array_elements(p_changes)
    order by (value->'after' = 'null'::jsonb),
      case when value->'after' = 'null'::jsonb then case value->>'table' when 'categories' then 1 else 0 end
      else case value->>'table' when 'categories' then 0 else 1 end end
  loop
    tab := change->>'table'; rid := change->>'id'; old := nullif(change->'before','null'::jsonb); nextrow := nullif(change->'after','null'::jsonb);
    case tab
      when 'categories' then allowed := array['id','restaurant_id','name_en','name_de','sort_order'];
      when 'menu_items' then allowed := array['id','restaurant_id','category_id','name_en','name_de','description_en','description_de','price','badge_en','badge_de','image_style','image_url','available','sort_order','included_item_ids'];
      when 'opening_hours' then allowed := array['id','restaurant_id','day','open_time','close_time','enabled','sort_order'];
      else raise exception 'Invalid entity';
    end case;
    if rid is null or (old is null and nextrow is null) then raise exception 'Invalid change'; end if;
    execute format('select to_jsonb(t) from public.%I t where id=$1 for update',tab) into currentrow using rid;
    if currentrow is not null and currentrow->>'restaurant_id' is distinct from p_restaurant then raise exception 'Access denied'; end if;
    if old is null and currentrow is not null then raise exception 'Entity already exists'; end if;
    if old is not null and (currentrow is null or not currentrow @> old) then raise exception 'Data changed on another device. Reload before saving.'; end if;
    if nextrow is null then
      if tab='categories' then
        delete from public.menu_items where restaurant_id=p_restaurant and category_id=rid;
      end if;
      execute format('delete from public.%I where id=$1 and restaurant_id=$2',tab) using rid,p_restaurant;
    else
      if nextrow->>'id' is distinct from rid or nextrow->>'restaurant_id' is distinct from p_restaurant or
        exists(select 1 from jsonb_object_keys(nextrow) k where not k=any(allowed)) then raise exception 'Invalid fields'; end if;
      if tab='menu_items' and not exists(select 1 from public.categories where id=nextrow->>'category_id' and restaurant_id=p_restaurant) then raise exception 'Invalid category'; end if;
      if tab='opening_hours' and ((nextrow->>'open_time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or
        (nextrow->>'close_time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then raise exception 'Invalid opening hours'; end if;
      select string_agg(format('%I',k),','),string_agg(format('r.%I',k),',') into columns_sql,values_sql from jsonb_object_keys(nextrow) k;
      if currentrow is null then
        execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I,$1) r',tab,columns_sql,values_sql,tab) using nextrow;
      else
        execute format('update public.%I set (%s)=(select %s from jsonb_populate_record(null::public.%I,$1) r) where id=$2',tab,columns_sql,values_sql,tab) using nextrow,rid;
      end if;
    end if;
  end loop;
end $$;
revoke all on function public.save_catalog_changes(text,jsonb) from public;
grant execute on function public.save_catalog_changes(text,jsonb) to authenticated;
revoke insert,update,delete on public.categories, public.menu_items, public.opening_hours from anon, authenticated;
commit;
