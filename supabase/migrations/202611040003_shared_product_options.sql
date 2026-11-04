begin;

alter table public.menu_items add column if not exists sizes jsonb not null default '[]'::jsonb;
alter table public.menu_items add column if not exists option_group_ids text[] not null default '{}';

create table if not exists public.product_option_groups (
  id text primary key,
  restaurant_id text not null references public.restaurants(id) on delete cascade,
  name_en text not null,
  name_de text not null,
  mode text not null check (mode in ('single','multiple')),
  required boolean not null default false,
  min_select integer not null default 0 check (min_select between 0 and 20),
  max_select integer not null default 1 check (max_select between 1 and 20 and max_select >= min_select),
  options jsonb not null default '[]'::jsonb,
  linked_category_ids text[] not null default '{}',
  linked_item_ids text[] not null default '{}',
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.product_option_groups enable row level security;
drop policy if exists "Public reads active product option groups" on public.product_option_groups;
create policy "Public reads active product option groups" on public.product_option_groups for select to anon using (active);
drop policy if exists "Managers read product option groups" on public.product_option_groups;
create policy "Managers read product option groups" on public.product_option_groups for select to authenticated using (public.can_manage_restaurant(restaurant_id));

create or replace function public.valid_product_sizes(value jsonb) returns boolean language plpgsql immutable as $$
declare size jsonb; ids text[] := '{}'; available_count integer := 0;
begin
  if jsonb_typeof(value) is distinct from 'array' or jsonb_array_length(value)>12 then return false; end if;
  for size in select * from jsonb_array_elements(value) loop
    if jsonb_typeof(size)<>'object' or coalesce(size->>'id','') !~ '^[A-Za-z0-9_-]{1,80}$' or size->>'id'=any(ids)
      or length(trim(coalesce(size#>>'{name,en}',''))) not between 1 and 80
      or length(trim(coalesce(size#>>'{name,de}',''))) not between 1 and 80
      or coalesce(size->>'price','') !~ '^[0-9]+([.][0-9]{1,2})?$' or (size->>'price')::numeric not between 0.01 and 10000
      or jsonb_typeof(size->'available')<>'boolean' then return false; end if;
    ids:=array_append(ids,size->>'id');
    if (size->>'available')::boolean then available_count:=available_count+1; end if;
  end loop;
  return jsonb_array_length(value)=0 or available_count>0;
end $$;

create or replace function public.effective_option_groups(item public.menu_items)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare groups jsonb:=coalesce(item.option_groups,'[]'::jsonb); size_options jsonb;
begin
  if not public.valid_product_sizes(coalesce(item.sizes,'[]'::jsonb)) then raise exception 'Invalid sizes'; end if;
  if jsonb_array_length(coalesce(item.sizes,'[]'::jsonb))>0 then
    select coalesce(jsonb_agg(jsonb_build_object('id',s->>'id','name',s->'name','priceDelta',greatest(0,(s->>'price')::numeric-item.price),'available',(s->>'available')::boolean) order by ord),'[]'::jsonb)
      into size_options from jsonb_array_elements(item.sizes) with ordinality valueset(s,ord);
    groups:=jsonb_build_array(jsonb_build_object('id','__size__','name',jsonb_build_object('en','Size','de','Größe'),'mode','single','required',true,'min',1,'max',1,'options',size_options))||groups;
  end if;
  groups:=groups||coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',jsonb_build_object('en',g.name_en,'de',g.name_de),'mode',g.mode,'required',g.required,'min',g.min_select,'max',g.max_select,'options',g.options) order by g.sort_order,g.id)
    from public.product_option_groups g where g.restaurant_id=item.restaurant_id and g.active and (item.category_id=any(g.linked_category_ids) or item.id=any(g.linked_item_ids))),'[]'::jsonb);
  if not public.valid_option_groups(groups) then raise exception 'Invalid product options'; end if;
  return groups;
end $$;

create or replace function public.resolve_item_configuration(item public.menu_items, selections jsonb)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare groups jsonb; g jsonb; o jsonb; s jsonb; option_id text; chosen text[]; count_chosen integer; minimum integer; maximum integer;
  extra numeric(10,2):=0; labels_en text[]:='{}'; labels_de text[]:='{}'; snapshot jsonb:='[]'::jsonb;
begin
  groups:=public.effective_option_groups(item); selections:=coalesce(selections,'[]'::jsonb);
  if jsonb_typeof(selections)<>'array' or jsonb_array_length(selections)>20 then raise exception 'Invalid selections'; end if;
  if exists(select 1 from jsonb_array_elements(selections)x group by x->>'groupId' having count(*)>1) then raise exception 'Duplicate option group'; end if;
  if exists(select 1 from jsonb_array_elements(selections)x where not exists(select 1 from jsonb_array_elements(groups)g2 where g2->>'id'=x->>'groupId')) then raise exception 'Unknown option group'; end if;
  for g in select * from jsonb_array_elements(groups) loop
    select value into s from jsonb_array_elements(selections) where value->>'groupId'=g->>'id' limit 1;
    if s is not null and jsonb_typeof(s->'optionIds')<>'array' then raise exception 'Invalid option selection'; end if;
    select coalesce(array_agg(distinct value),'{}') into chosen from jsonb_array_elements_text(coalesce(s->'optionIds','[]'::jsonb));
    count_chosen:=cardinality(chosen); minimum:=(g->>'min')::integer; maximum:=(g->>'max')::integer;
    if (g->>'required')::boolean then minimum:=greatest(1,minimum); end if;
    if count_chosen<minimum or count_chosen>maximum or (g->>'mode'='single' and count_chosen>1) then raise exception 'Option selection limit'; end if;
    foreach option_id in array chosen loop
      select value into o from jsonb_array_elements(g->'options') where value->>'id'=option_id limit 1;
      if o is null or not (o->>'available')::boolean then raise exception 'Option unavailable'; end if;
      extra:=extra+(o->>'priceDelta')::numeric; labels_en:=array_append(labels_en,o#>>'{name,en}'); labels_de:=array_append(labels_de,o#>>'{name,de}');
      snapshot:=snapshot||jsonb_build_array(jsonb_build_object('group_id',g->>'id','group_en',g#>>'{name,en}','group_de',g#>>'{name,de}','option_id',option_id,'option_en',o#>>'{name,en}','option_de',o#>>'{name,de}','price_delta',(o->>'priceDelta')::numeric));
    end loop;
    s:=null;
  end loop;
  return jsonb_build_object('price',item.price+extra,'name_en',item.name_en||case when cardinality(labels_en)>0 then ' · '||array_to_string(labels_en,' · ') else '' end,'name_de',item.name_de||case when cardinality(labels_de)>0 then ' · '||array_to_string(labels_de,' · ') else '' end,'snapshot',snapshot);
end $$;

create or replace function public.save_catalog_changes(p_restaurant text, p_changes jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare change jsonb; tab text; rid text; old jsonb; nextrow jsonb; currentrow jsonb; columns_sql text; values_sql text; allowed text[]; link_id text;
begin
  if not public.can_manage_restaurant(p_restaurant) then raise exception 'Access denied'; end if;
  if jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes)>2000 then raise exception 'Invalid changes'; end if;
  perform pg_advisory_xact_lock(hashtextextended('catalog:'||p_restaurant,0));
  for change in select value from jsonb_array_elements(p_changes) order by (value->'after'='null'::jsonb),case when value->'after'='null'::jsonb then case value->>'table' when 'categories' then 1 else 0 end else case value->>'table' when 'categories' then 0 else 1 end end loop
    tab:=change->>'table';rid:=change->>'id';old:=nullif(change->'before','null'::jsonb);nextrow:=nullif(change->'after','null'::jsonb);
    case tab
      when 'categories' then allowed:=array['id','restaurant_id','name_en','name_de','sort_order'];
      when 'menu_items' then allowed:=array['id','restaurant_id','category_id','name_en','name_de','description_en','description_de','price','badge_en','badge_de','image_style','image_url','available','sort_order','included_item_ids','sizes','option_group_ids','prep_station','prep_minutes','prep_ingredients_en','prep_ingredients_de','prep_tools_en','prep_tools_de','prep_steps_en','prep_steps_de','prep_warning_en','prep_warning_de'];
      when 'product_option_groups' then allowed:=array['id','restaurant_id','name_en','name_de','mode','required','min_select','max_select','options','linked_category_ids','linked_item_ids','active','sort_order'];
      when 'opening_hours' then allowed:=array['id','restaurant_id','day','open_time','close_time','enabled','sort_order'];
      else raise exception 'Invalid entity';
    end case;
    if rid is null or (old is null and nextrow is null) then raise exception 'Invalid change'; end if;
    execute format('select to_jsonb(t) from public.%I t where id=$1 for update',tab) into currentrow using rid;
    if currentrow is not null and currentrow->>'restaurant_id' is distinct from p_restaurant then raise exception 'Access denied'; end if;
    if old is null and currentrow is not null then raise exception 'Entity already exists'; end if;
    if old is not null and (currentrow is null or not currentrow @> old) then raise exception 'Data changed on another device. Reload before saving.'; end if;
    if nextrow is null then
      if tab='categories' then delete from public.menu_items where restaurant_id=p_restaurant and category_id=rid; end if;
      execute format('delete from public.%I where id=$1 and restaurant_id=$2',tab) using rid,p_restaurant;
    else
      if nextrow->>'id' is distinct from rid or nextrow->>'restaurant_id' is distinct from p_restaurant or exists(select 1 from jsonb_object_keys(nextrow)k where not k=any(allowed)) then raise exception 'Invalid fields'; end if;
      if tab='menu_items' then
        if not exists(select 1 from public.categories where id=nextrow->>'category_id' and restaurant_id=p_restaurant) or not public.valid_product_sizes(coalesce(nextrow->'sizes','[]'::jsonb)) then raise exception 'Invalid menu item'; end if;
      elsif tab='product_option_groups' then
        if not public.valid_option_groups(jsonb_build_array(jsonb_build_object('id',rid,'name',jsonb_build_object('en',nextrow->>'name_en','de',nextrow->>'name_de'),'mode',nextrow->>'mode','required',(nextrow->>'required')::boolean,'min',(nextrow->>'min_select')::integer,'max',(nextrow->>'max_select')::integer,'options',nextrow->'options'))) then raise exception 'Invalid option group'; end if;
        for link_id in select unnest(coalesce(array(select jsonb_array_elements_text(coalesce(nextrow->'linked_category_ids','[]'::jsonb))),'{}')) loop if not exists(select 1 from public.categories where id=link_id and restaurant_id=p_restaurant) then raise exception 'Invalid category link'; end if; end loop;
        for link_id in select unnest(coalesce(array(select jsonb_array_elements_text(coalesce(nextrow->'linked_item_ids','[]'::jsonb))),'{}')) loop if not exists(select 1 from public.menu_items where id=link_id and restaurant_id=p_restaurant) then raise exception 'Invalid item link'; end if; end loop;
      end if;
      if tab='opening_hours' and ((nextrow->>'open_time')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or (nextrow->>'close_time')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$') then raise exception 'Invalid opening hours'; end if;
      select string_agg(format('%I',k),','),string_agg(format('r.%I',k),',') into columns_sql,values_sql from jsonb_object_keys(nextrow)k;
      if currentrow is null then execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I,$1) r',tab,columns_sql,values_sql,tab) using nextrow;
      else execute format('update public.%I set (%s)=(select %s from jsonb_populate_record(null::public.%I,$1) r) where id=$2',tab,columns_sql,values_sql,tab) using nextrow,rid; end if;
    end if;
  end loop;
end $$;

commit;
