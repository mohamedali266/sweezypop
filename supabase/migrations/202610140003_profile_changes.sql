begin;
create or replace function public.save_profile_changes(p_restaurant text,p_changes jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare c jsonb; p public.profiles; n jsonb; begin
  if not public.can_manage_restaurant(p_restaurant) or public.current_profile_role()<>'admin' then raise exception 'Access denied'; end if;
  perform pg_advisory_xact_lock(hashtextextended('profiles:'||p_restaurant,0));
  if jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes)>100 then raise exception 'Invalid changes'; end if;
  for c in select * from jsonb_array_elements(p_changes) loop
    select * into p from public.profiles where id=c->>'id' and restaurant_id=p_restaurant for update;
    if not found then raise exception 'Profile not found'; end if;
    if not to_jsonb(p) @> (c->'before') then raise exception 'Profile changed. Reload and retry.'; end if;
    n := nullif(c->'after','null'::jsonb);
    if p.auth_user_id=auth.uid() and (n is null or n->>'role'<>'admin' or n->>'active'<>'true') then raise exception 'Cannot remove your own administrator access'; end if;
    if n is null then
      delete from public.profiles where id=p.id;
    else
      if exists(select 1 from jsonb_object_keys(n) k where k not in ('name','role','active','restaurant_name')) or
        length(trim(n->>'name')) not between 1 and 120 or n->>'role' not in ('admin','owner') or jsonb_typeof(n->'active')<>'boolean' then
        raise exception 'Invalid profile fields'; end if;
      update public.profiles set name=n->>'name',role=n->>'role',active=(n->>'active')::boolean,restaurant_name=n->>'restaurant_name' where id=p.id;
    end if;
  end loop;
end $$;
revoke all on function public.save_profile_changes(text,jsonb) from public;
grant execute on function public.save_profile_changes(text,jsonb) to authenticated;
revoke insert,update,delete on public.profiles from anon,authenticated;
commit;
