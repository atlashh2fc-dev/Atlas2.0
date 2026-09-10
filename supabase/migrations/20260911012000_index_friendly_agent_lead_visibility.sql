-- Devuelve el uso de índices a la ruta de leads de un agente.
--
-- La rama `agente` de las políticas de leads terminaba en
-- `has_active_dial_attempt(id)`: una función aplicada a la columna de cada
-- fila. Eso impide el BitmapOr sobre `leads_assigned_to_idx` y
-- `leads_managed_by_idx` y degrada la consulta a un recorrido completo. No
-- afecta a una pantalla sino a todas las consultas a leads de un agente,
-- porque esto es la política RLS. Era la causa principal de la lentitud
-- general reportada.
--
-- El arreglo no cambia la regla, cambia dónde se evalúa. La función pregunta,
-- por cada lead, si el agente actual tiene un intento de discado activo sobre
-- él. Como el agente y la ventana de 15 minutos son fijos dentro de la
-- consulta, ese conjunto se resuelve una sola vez.
--
-- Medido sobre la base real:
--
--   como estaba, has_active_dial_attempt(id)      Seq Scan   998,00 ms  89.952 bloques
--   id in (select unnest((select fn())))          Seq Scan    35,50 ms   6.117 bloques
--   id = any((select fn())::uuid[])               BitmapOr     3,90 ms     389 bloques
--
-- El cast a `uuid[]` no es cosmético y costó una iteración descubrirlo: sin
-- él, Postgres interpreta el paréntesis como subconsulta de ANY, el planner no
-- sabe estimar su cardinalidad y vuelve a elegir el recorrido completo. Con el
-- cast es una expresión escalar de tipo arreglo, se resuelve como InitPlan y
-- entra al BitmapOr junto a los otros dos índices.
--
-- Verificado antes de aplicar comparando, para cada agente real, el conjunto
-- de leads visible con una y otra forma: idéntico en los 18. Como los estados
-- 'ringing', 'answered' y 'bridged' son transitorios y no había ninguna fila
-- viva, se repitió con estados que sí tienen datos para que la tercera rama
-- aportara de verdad: idéntico en los 10 agentes con historial de discado, con
-- hasta 2.464 leads entrando por esa rama. También se confirmó que
-- `dial_attempts.lead_id` no admite nulos, que es la única condición bajo la
-- cual `= any` y `in (select unnest ...)` podrían diferir.
--
-- La rama del supervisor se deja como está: se midió y ya resuelve con lectura
-- sólo de índice en 2,75 ms. Ahí el cambio no aporta.
--
-- Se conserva `has_active_dial_attempt` por si algo más la usa.

create or replace function public.active_dial_attempt_lead_ids()
returns uuid[]
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(array_agg(da.lead_id), '{}'::uuid[])
  from public.dial_attempts da
  where da.agent_id = (select auth.uid())
    and da.status in ('ringing', 'answered', 'bridged')
    and da.updated_at >= now() - interval '15 minutes';
$function$;

revoke execute on function public.active_dial_attempt_lead_ids() from public, anon;
grant execute on function public.active_dial_attempt_lead_ids() to authenticated, service_role;

comment on function public.active_dial_attempt_lead_ids() is
  'Leads con intento de discado activo del agente actual. Reemplaza a has_active_dial_attempt dentro de las politicas de leads: resuelve el conjunto una vez por consulta en vez de una por fila, que era lo que impedia usar los indices.';

alter policy leads_select on public.leads
using (
  case (select public.current_role_name())
    when 'admin'::public.app_role then true
    when 'agente'::public.app_role then (
      assigned_to = (select auth.uid())
      or managed_by = (select auth.uid())
      or id = any((select public.active_dial_attempt_lead_ids())::uuid[])
    )
    when 'supervisor'::public.app_role then (
      team_id in (select unnest((select public.supervised_team_ids())))
    )
    else false
  end
);

alter policy leads_update on public.leads
using (
  case (select public.current_role_name())
    when 'admin'::public.app_role then true
    when 'agente'::public.app_role then (
      assigned_to = (select auth.uid())
      or managed_by = (select auth.uid())
      or id = any((select public.active_dial_attempt_lead_ids())::uuid[])
    )
    when 'supervisor'::public.app_role then (
      team_id in (select unnest((select public.supervised_team_ids())))
    )
    else false
  end
)
with check (
  case (select public.current_role_name())
    when 'admin'::public.app_role then true
    when 'agente'::public.app_role then (
      assigned_to = (select auth.uid())
      or managed_by = (select auth.uid())
      or id = any((select public.active_dial_attempt_lead_ids())::uuid[])
    )
    when 'supervisor'::public.app_role then (
      team_id in (select unnest((select public.supervised_team_ids())))
    )
    else false
  end
);
