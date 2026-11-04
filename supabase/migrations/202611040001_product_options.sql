begin;

alter table public.menu_items add column if not exists option_groups jsonb not null default '[]'::jsonb;
alter table public.order_lines add column if not exists selected_options jsonb not null default '[]'::jsonb;

create or replace function public.valid_option_groups(value jsonb) returns boolean language plpgsql immutable as $$
declare g jsonb; o jsonb; ids text[] := '{}'; option_ids text[]; minimum integer; maximum integer; available_count integer;
begin
  if jsonb_typeof(value) is distinct from 'array' or jsonb_array_length(value)>8 then return false; end if;
  for g in select * from jsonb_array_elements(value) loop
    if jsonb_typeof(g)<>'object' or coalesce(g->>'id','') !~ '^[A-Za-z0-9_-]{1,80}$' or g->>'id'=any(ids)
      or length(trim(coalesce(g#>>'{name,en}',''))) not between 1 and 80 or length(trim(coalesce(g#>>'{name,de}',''))) not between 1 and 80
      or g->>'mode' not in ('single','multiple') or jsonb_typeof(g->'required')<>'boolean'
      or coalesce(g->>'min','') !~ '^[0-9]+$' or coalesce(g->>'max','') !~ '^[0-9]+$'
      or jsonb_typeof(g->'options') is distinct from 'array' or jsonb_array_length(g->'options') not between 1 and 20 then return false; end if;
    minimum := (g->>'min')::integer; maximum := (g->>'max')::integer;
    if minimum>maximum or maximum not between 1 and 20 or (g->>'mode'='single' and maximum<>1)
      or ((g->>'required')::boolean and minimum<1) then return false; end if;
    ids:=array_append(ids,g->>'id'); option_ids:='{}'; available_count:=0;
    for o in select * from jsonb_array_elements(g->'options') loop
      if jsonb_typeof(o)<>'object' or coalesce(o->>'id','') !~ '^[A-Za-z0-9_-]{1,80}$' or o->>'id'=any(option_ids)
        or length(trim(coalesce(o#>>'{name,en}',''))) not between 1 and 100 or length(trim(coalesce(o#>>'{name,de}',''))) not between 1 and 100
        or jsonb_typeof(o->'available')<>'boolean' or coalesce(o->>'priceDelta','') !~ '^[0-9]+([.][0-9]{1,2})?$'
        or (o->>'priceDelta')::numeric>10000 then return false; end if;
      option_ids:=array_append(option_ids,o->>'id');
      if (o->>'available')::boolean then available_count:=available_count+1; end if;
    end loop;
    if available_count<minimum then return false; end if;
  end loop;
  return true;
end $$;

create or replace function public.resolve_item_configuration(item public.menu_items, selections jsonb)
returns jsonb language plpgsql immutable as $$
declare g jsonb; o jsonb; s jsonb; option_id text; chosen text[]; count_chosen integer; minimum integer; maximum integer;
  extra numeric(10,2):=0; labels_en text[]:='{}'; labels_de text[]:='{}'; snapshot jsonb:='[]'::jsonb;
begin
  selections:=coalesce(selections,'[]'::jsonb);
  if jsonb_typeof(selections)<>'array' or jsonb_array_length(selections)>8 or not public.valid_option_groups(item.option_groups) then raise exception 'Invalid selections'; end if;
  if exists(select 1 from jsonb_array_elements(selections)x group by x->>'groupId' having count(*)>1) then raise exception 'Duplicate option group'; end if;
  if exists(select 1 from jsonb_array_elements(selections)x where not exists(select 1 from jsonb_array_elements(item.option_groups)g2 where g2->>'id'=x->>'groupId')) then raise exception 'Unknown option group'; end if;
  for g in select * from jsonb_array_elements(item.option_groups) loop
    select value into s from jsonb_array_elements(selections) where value->>'groupId'=g->>'id' limit 1;
    if s is not null and jsonb_typeof(s->'optionIds')<>'array' then raise exception 'Invalid option selection'; end if;
    select coalesce(array_agg(distinct value),'{}') into chosen from jsonb_array_elements_text(coalesce(s->'optionIds','[]'::jsonb));
    count_chosen:=cardinality(chosen); minimum:=(g->>'min')::integer; maximum:=(g->>'max')::integer;
    if (g->>'required')::boolean then minimum:=greatest(1,minimum); end if;
    if count_chosen<minimum or count_chosen>maximum then raise exception 'Option selection limit'; end if;
    if g->>'mode'='single' and count_chosen>1 then raise exception 'Single choice required'; end if;
    foreach option_id in array chosen loop
      select value into o from jsonb_array_elements(g->'options') where value->>'id'=option_id limit 1;
      if o is null or not (o->>'available')::boolean then raise exception 'Option unavailable'; end if;
      extra:=extra+(o->>'priceDelta')::numeric; labels_en:=array_append(labels_en,o#>>'{name,en}'); labels_de:=array_append(labels_de,o#>>'{name,de}');
      snapshot:=snapshot||jsonb_build_array(jsonb_build_object('group_id',g->>'id','group_en',g#>>'{name,en}','group_de',g#>>'{name,de}','option_id',option_id,'option_en',o#>>'{name,en}','option_de',o#>>'{name,de}','price_delta',(o->>'priceDelta')::numeric));
    end loop;
    s:=null;
  end loop;
  return jsonb_build_object('price',item.price+extra,'name_en',item.name_en||case when cardinality(labels_en)>0 then ' · '||array_to_string(labels_en,' · ') else '' end,
    'name_de',item.name_de||case when cardinality(labels_de)>0 then ' · '||array_to_string(labels_de,' · ') else '' end,'snapshot',snapshot);
end $$;

create or replace function public.save_catalog_changes(p_restaurant text, p_changes jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare change jsonb; tab text; rid text; old jsonb; nextrow jsonb; currentrow jsonb; columns_sql text; values_sql text; allowed text[];
begin
  if not public.can_manage_restaurant(p_restaurant) then raise exception 'Access denied'; end if;
  if jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes)>2000 then raise exception 'Invalid changes'; end if;
  perform pg_advisory_xact_lock(hashtextextended('catalog:'||p_restaurant,0));
  for change in select value from jsonb_array_elements(p_changes)
    order by (value->'after'='null'::jsonb),case when value->'after'='null'::jsonb then case value->>'table' when 'categories' then 1 else 0 end else case value->>'table' when 'categories' then 0 else 1 end end
  loop
    tab:=change->>'table';rid:=change->>'id';old:=nullif(change->'before','null'::jsonb);nextrow:=nullif(change->'after','null'::jsonb);
    case tab
      when 'categories' then allowed:=array['id','restaurant_id','name_en','name_de','sort_order'];
      when 'menu_items' then allowed:=array['id','restaurant_id','category_id','name_en','name_de','description_en','description_de','price','badge_en','badge_de','image_style','image_url','available','sort_order','included_item_ids','option_groups','prep_station','prep_minutes','prep_ingredients_en','prep_ingredients_de','prep_tools_en','prep_tools_de','prep_steps_en','prep_steps_de','prep_warning_en','prep_warning_de'];
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
        if not exists(select 1 from public.categories where id=nextrow->>'category_id' and restaurant_id=p_restaurant) then raise exception 'Invalid category'; end if;
        if not public.valid_option_groups(coalesce(nextrow->'option_groups','[]'::jsonb)) then raise exception 'Invalid product options'; end if;
      end if;
      if tab='opening_hours' and ((nextrow->>'open_time')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or (nextrow->>'close_time')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$') then raise exception 'Invalid opening hours'; end if;
      select string_agg(format('%I',k),','),string_agg(format('r.%I',k),',') into columns_sql,values_sql from jsonb_object_keys(nextrow)k;
      if currentrow is null then execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I,$1) r',tab,columns_sql,values_sql,tab) using nextrow;
      else execute format('update public.%I set (%s)=(select %s from jsonb_populate_record(null::public.%I,$1) r) where id=$2',tab,columns_sql,values_sql,tab) using nextrow,rid; end if;
    end if;
  end loop;
end $$;

drop function if exists public.place_order(text,uuid,text,text,jsonb,text,text);
create function public.place_order(p_slug text,p_request_key uuid,p_name text,p_notes text,p_lines jsonb,p_source text default 'menu',p_client_token text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare rid text; oid text; existing public.orders; result public.orders; line jsonb; item public.menu_items; qty integer; amount numeric(10,2):=0; payload jsonb; caller_key text; configured jsonb;
begin
  select id into rid from public.restaurants where public_slug=p_slug;
  if rid is null or p_request_key is null or p_source not in ('menu','pos') then raise exception 'Invalid restaurant or request'; end if;
  if p_source='pos' and not public.can_operate_pos(rid) then raise exception 'Access denied'; end if;
  if p_name is null or length(trim(p_name)) not between 1 and 120 or length(coalesce(p_notes,''))>2000 then raise exception 'Invalid name or notes'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 30 then raise exception 'Invalid basket size'; end if;
  if (select count(*) from jsonb_array_elements(p_lines))<>(select count(distinct jsonb_build_object('id',x->>'id','selections',coalesce(x->'selections','[]'::jsonb))) from jsonb_array_elements(p_lines)x) then raise exception 'Duplicate basket lines'; end if;
  payload:=jsonb_build_object('name',trim(p_name),'notes',coalesce(p_notes,''),'lines',p_lines,'source',p_source);
  perform pg_advisory_xact_lock(hashtextextended(rid||p_request_key::text,0));
  select * into existing from public.orders where restaurant_id=rid and request_key=p_request_key;
  if found then
    if existing.request_payload is distinct from payload then raise exception 'Request key already used with another basket'; end if;
    return jsonb_build_object('id',existing.id,'order_number',existing.order_number,'total',existing.total,'created_at',existing.created_at,'lines',(select jsonb_agg(jsonb_build_object('id',menu_item_id,'name_en',name_en,'name_de',name_de,'price',unit_price,'quantity',quantity)) from public.order_lines where order_id=existing.id));
  end if;
  if p_source='menu' then
    if p_client_token is not null and (length(p_client_token) not between 16 and 128 or p_client_token!~'^[A-Za-z0-9_-]+$') then raise exception 'Invalid client token'; end if;
    caller_key:=coalesce(p_client_token,md5(lower(trim(p_name)))); perform public.consume_rate_limit('orders:'||rid||':menu:global',60,60); perform public.consume_rate_limit('orders:'||rid||':menu:client:'||caller_key,6,60);
  else perform public.consume_rate_limit('orders:'||rid||':pos:'||auth.uid()::text,180,60); end if;
  perform id from public.menu_items where restaurant_id=rid order by id for share;
  oid:=gen_random_uuid()::text;
  insert into public.orders(id,restaurant_id,customer_name,phone,notes,status,total,request_key,request_payload,source) values(oid,rid,trim(p_name),'',coalesce(p_notes,''),'new',0,p_request_key,payload,p_source);
  for line in select * from jsonb_array_elements(p_lines) loop
    if coalesce(line->>'quantity','')!~'^[0-9]+$' then raise exception 'Invalid quantity'; end if; qty:=(line->>'quantity')::integer; if qty not between 1 and 20 then raise exception 'Invalid quantity'; end if;
    select * into item from public.menu_items where id=line->>'id' and restaurant_id=rid;
    if not found or not item.available or item.category_id is null then raise exception 'Item unavailable'; end if;
    if (item.category_id='offers' or cardinality(item.included_item_ids)>0) and (cardinality(item.included_item_ids)=0 or exists(select 1 from unnest(item.included_item_ids) part(id) where not exists(select 1 from public.menu_items m where m.id=part.id and m.restaurant_id=rid and m.available and m.category_id<>'offers'))) then raise exception 'Offer unavailable'; end if;
    configured:=public.resolve_item_configuration(item,coalesce(line->'selections','[]'::jsonb)); amount:=amount+(configured->>'price')::numeric*qty;
    insert into public.order_lines(id,order_id,menu_item_id,quantity,unit_price,name_en,name_de,selected_options) values(gen_random_uuid()::text,oid,item.id,qty,(configured->>'price')::numeric,configured->>'name_en',configured->>'name_de',configured->'snapshot');
  end loop;
  update public.orders set total=amount where id=oid returning * into result;
  return jsonb_build_object('id',result.id,'order_number',result.order_number,'total',result.total,'created_at',result.created_at,'lines',(select jsonb_agg(jsonb_build_object('id',menu_item_id,'name_en',name_en,'name_de',name_de,'price',unit_price,'quantity',quantity)) from public.order_lines where order_id=result.id));
end $$;

grant execute on function public.place_order(text,uuid,text,text,jsonb,text,text) to anon,authenticated;
commit;
