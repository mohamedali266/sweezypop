begin;

create or replace function public.resolve_item_configuration_for_order(item public.menu_items, selections jsonb, optional_additions boolean)
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
    if optional_additions and g->>'id'<>'__size__' then minimum:=0; end if;
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

revoke all on function public.resolve_item_configuration_for_order(public.menu_items,jsonb,boolean) from public, anon, authenticated;

create or replace function public.place_order(p_slug text,p_request_key uuid,p_name text,p_notes text,p_lines jsonb,p_source text default 'menu',p_client_token text default null)
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
    configured:=public.resolve_item_configuration_for_order(item,coalesce(line->'selections','[]'::jsonb),p_source='pos'); amount:=amount+(configured->>'price')::numeric*qty;
    insert into public.order_lines(id,order_id,menu_item_id,quantity,unit_price,name_en,name_de,selected_options) values(gen_random_uuid()::text,oid,item.id,qty,(configured->>'price')::numeric,configured->>'name_en',configured->>'name_de',configured->'snapshot');
  end loop;
  update public.orders set total=amount where id=oid returning * into result;
  return jsonb_build_object('id',result.id,'order_number',result.order_number,'total',result.total,'created_at',result.created_at,'lines',(select jsonb_agg(jsonb_build_object('id',menu_item_id,'name_en',name_en,'name_de',name_de,'price',unit_price,'quantity',quantity)) from public.order_lines where order_id=result.id));
end $$;

commit;
