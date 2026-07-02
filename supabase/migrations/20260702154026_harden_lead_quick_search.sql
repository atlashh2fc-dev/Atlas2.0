-- Make quick lead lookup robust for formatted RUTs, pasted text and RUTs
-- entered without verification digit, while keeping the lookup indexed.

create index if not exists leads_rut_norm_lookup_idx
on public.leads ((upper(regexp_replace(rut, '[^0-9kK]', '', 'g'))))
where rut is not null and btrim(rut) <> '';

create index if not exists leads_rut_body_lookup_idx
on public.leads ((
  left(
    upper(regexp_replace(rut, '[^0-9kK]', '', 'g')),
    greatest(length(upper(regexp_replace(rut, '[^0-9kK]', '', 'g'))) - 1, 0)
  )
))
where rut is not null and btrim(rut) <> '';

create index if not exists leads_phone_last9_lookup_idx
on public.leads ((right(regexp_replace(phone, '[^0-9]', '', 'g'), 9)))
where phone is not null and btrim(phone) <> '';

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
as $function$
  with raw_terms as (
    select p_term as term
    union all
    select token as term
    from regexp_split_to_table(coalesce(p_term, ''), '[,;\s]+') as token
  ),
  cleaned as (
    select distinct
      btrim(term) as term,
      upper(regexp_replace(term, '[^0-9kK]', '', 'g')) as rut_norm,
      regexp_replace(term, '[^0-9]', '', 'g') as digits
    from raw_terms
    where btrim(term) <> ''
  ),
  rut_match as (
    select
      l.id,
      l.full_name,
      l.rut,
      l.phone,
      l.status,
      l.assigned_to,
      'rut'::text as match_type,
      1 as priority
    from public.leads l
    join cleaned c on true
    cross join lateral (
      select
        upper(regexp_replace(l.rut, '[^0-9kK]', '', 'g')) as rut_norm,
        left(
          upper(regexp_replace(l.rut, '[^0-9kK]', '', 'g')),
          greatest(length(upper(regexp_replace(l.rut, '[^0-9kK]', '', 'g'))) - 1, 0)
        ) as rut_body
    ) n
    where length(c.rut_norm) between 6 and 9
      and (
        n.rut_norm = c.rut_norm
        or (
          c.rut_norm = c.digits
          and length(c.digits) between 6 and 8
          and n.rut_body = c.digits
        )
      )
  ),
  phone_match as (
    select
      l.id,
      l.full_name,
      l.rut,
      l.phone,
      l.status,
      l.assigned_to,
      'phone'::text as match_type,
      2 as priority
    from public.leads l
    join cleaned c on true
    where length(c.digits) between 8 and 12
      and right(regexp_replace(l.phone, '[^0-9]', '', 'g'), 9) = right(c.digits, 9)
  ),
  name_match as (
    select
      l.id,
      l.full_name,
      l.rut,
      l.phone,
      l.status,
      l.assigned_to,
      'name'::text as match_type,
      3 as priority
    from public.leads l
    where length(btrim(p_term)) >= 3
      and length(regexp_replace(p_term, '[^0-9]', '', 'g')) < 8
      and l.full_name ilike '%' || btrim(p_term) || '%'
    limit 8
  ),
  ranked as (
    select
      m.*,
      row_number() over (partition by m.id order by m.priority, m.full_name) as rn
    from (
      select * from rut_match
      union all
      select * from phone_match
      union all
      select * from name_match
    ) m
  )
  select id, full_name, rut, phone, status, assigned_to, match_type
  from ranked
  where rn = 1
  order by priority, full_name
  limit 20;
$function$;

revoke all on function public.search_leads_quick(text) from public, anon;
grant execute on function public.search_leads_quick(text) to authenticated;

drop policy if exists leads_select on public.leads;
create policy leads_select
on public.leads
for select
to authenticated
using (
  public.current_role_name() = 'admin'
  or (
    public.current_role_name() = 'agente'
    and (
      assigned_to = (select auth.uid())
      or managed_by = (select auth.uid())
    )
  )
  or (
    public.current_role_name() = 'supervisor'
    and team_id = public.current_team_id()
  )
);

drop policy if exists leads_update on public.leads;
create policy leads_update
on public.leads
for update
to authenticated
using (
  public.current_role_name() = 'admin'
  or (
    public.current_role_name() = 'agente'
    and (
      assigned_to = (select auth.uid())
      or managed_by = (select auth.uid())
    )
  )
  or (
    public.current_role_name() = 'supervisor'
    and team_id = public.current_team_id()
  )
)
with check (
  public.current_role_name() = 'admin'
  or (
    public.current_role_name() = 'agente'
    and (
      assigned_to = (select auth.uid())
      or managed_by = (select auth.uid())
    )
  )
  or (
    public.current_role_name() = 'supervisor'
    and team_id = public.current_team_id()
  )
);
