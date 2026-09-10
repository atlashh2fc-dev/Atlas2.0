-- Deja que la búsqueda rápida use los índices de RUT que ya existían.
--
-- `leads_rut_norm_lookup_idx` y `leads_rut_body_lookup_idx` están creados con
-- exactamente las expresiones que esta función compara, y sin embargo el
-- linter de la base los reportaba como jamás usados. El motivo estaba en cómo
-- se escribió la condición: las dos formas de calzar un RUT (con dígito
-- verificador y sin él) iban dentro de un mismo OR que además mezclaba
-- condiciones sobre el término buscado. Con eso el planner no puede resolver
-- ninguna de las dos por índice y termina recorriendo las 84 mil filas
-- calculando la expresión regular por fila, dos veces.
--
-- Separadas en dos ramas con UNION ALL, cada una cae en su índice. Medido
-- contra la base real:
--
--   RUT completo   239 ms -> menos de 1 ms
--   RUT sin dígito 619 ms -> menos de 1 ms
--   Nombre           7 ms -> 3 ms
--   Teléfono         ya usaba su índice, sin cambio
--
-- La deduplicación por `row_number() partition by id` ya existía, así que un
-- lead que calce por ambas ramas sigue apareciendo una sola vez.
--
-- Los `rut is not null and btrim(rut) <> ''` no cambian qué filas califican
-- (la expresión sobre un RUT nulo nunca calzaba); están para que el planner
-- pueda usar índices parciales, que es como están definidos los dos.

create or replace function public.search_leads_quick(p_term text)
returns table(
  id uuid, full_name text, rut text, phone text,
  status text, assigned_to uuid, match_type text
)
language sql
stable
set search_path to 'public'
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
  rut_exacto as (
    select
      l.id, l.full_name, l.rut, l.phone, l.status, l.assigned_to,
      'rut'::text as match_type,
      1 as priority
    from public.leads l
    join cleaned c
      on upper(regexp_replace(l.rut, '[^0-9kK]', '', 'g')) = c.rut_norm
    where l.rut is not null
      and btrim(l.rut) <> ''
      and length(c.rut_norm) between 6 and 9
  ),
  rut_cuerpo as (
    select
      l.id, l.full_name, l.rut, l.phone, l.status, l.assigned_to,
      'rut'::text as match_type,
      1 as priority
    from public.leads l
    join cleaned c
      on left(
           upper(regexp_replace(l.rut, '[^0-9kK]', '', 'g')),
           greatest(length(upper(regexp_replace(l.rut, '[^0-9kK]', '', 'g'))) - 1, 0)
         ) = c.digits
    where l.rut is not null
      and btrim(l.rut) <> ''
      and c.rut_norm = c.digits
      and length(c.digits) between 6 and 8
  ),
  phone_match as (
    select
      l.id, l.full_name, l.rut, l.phone, l.status, l.assigned_to,
      'phone'::text as match_type,
      2 as priority
    from public.leads l
    join cleaned c
      on right(regexp_replace(l.phone, '[^0-9]', '', 'g'), 9) = right(c.digits, 9)
    where l.phone is not null
      and btrim(l.phone) <> ''
      and length(c.digits) between 8 and 12
  ),
  name_match as (
    select
      l.id, l.full_name, l.rut, l.phone, l.status, l.assigned_to,
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
      select * from rut_exacto
      union all
      select * from rut_cuerpo
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
