begin;

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

commit;
