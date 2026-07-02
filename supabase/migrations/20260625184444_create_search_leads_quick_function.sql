create or replace function public.search_leads_quick(p_term text)
returns table (
  id uuid,
  full_name text,
  rut text,
  phone text,
  status text,
  assigned_to uuid,
  match_type text
)
language sql
stable
security invoker
set search_path = public
as $$
  with cleaned as (
    select
      regexp_replace(upper(p_term), '[^0-9A-Z]', '', 'g') as alnum,
      regexp_replace(p_term, '[^0-9]', '', 'g') as digits
  ),
  rut_match as (
    select l.id, l.full_name, l.rut, l.phone, l.status, l.assigned_to, 'rut'::text as match_type
    from leads l, cleaned c
    where length(c.alnum) between 7 and 9
      and regexp_replace(upper(l.rut), '[^0-9K]', '', 'g') = c.alnum
  ),
  phone_match as (
    select l.id, l.full_name, l.rut, l.phone, l.status, l.assigned_to, 'phone'::text as match_type
    from leads l, cleaned c
    where length(c.digits) between 8 and 12
      and right(regexp_replace(l.phone, '[^0-9]', '', 'g'), 9) = right(c.digits, 9)
  ),
  name_match as (
    select l.id, l.full_name, l.rut, l.phone, l.status, l.assigned_to, 'name'::text as match_type
    from leads l, cleaned c
    where length(p_term) >= 3
      and length(c.digits) < 8
      and l.full_name ilike '%' || p_term || '%'
    limit 8
  )
  select * from rut_match
  union
  select * from phone_match
  union
  select * from name_match
  limit 10;
$$;;
