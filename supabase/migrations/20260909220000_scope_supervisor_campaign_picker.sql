-- El selector de campañas del supervisor solo muestra lo suyo.
--
-- `get_report_scope_campaigns` listaba, para cualquier supervisor, todas las
-- campañas activas con registros. Los datos seguían acotados por RLS, pero los
-- nombres no: un supervisor de una cuenta veía en su desplegable los nombres de
-- los demás clientes de la operación. Con cuentas de demostración en manos de
-- terceros eso deja de ser un detalle.
--
-- Ahora el supervisor ve las campañas donde su equipo tiene registros o
-- ejecutivos asignados. Admin y ejecutivo mantienen exactamente el alcance que
-- ya tenían.
create or replace function public.get_report_scope_campaigns()
returns table(id uuid, name text)
language sql
stable
set search_path to 'public'
as $function$
  select c.id, c.name
  from public.campaigns c
  where c.is_active
    and (
      (select public.current_role_name()) = 'admin'
      or (
        (select public.current_role_name()) = 'supervisor'
        and (
          exists (
            select 1
            from public.leads l
            where l.campaign_id = c.id
              and l.team_id = any(public.supervised_team_ids())
          )
          or exists (
            select 1
            from public.campaign_agents ca
            join public.profiles p on p.id = ca.profile_id
            where ca.campaign_id = c.id
              and p.team_id = any(public.supervised_team_ids())
          )
        )
      )
      or (
        (select public.current_role_name()) = 'agente'
        and exists (
          select 1 from public.campaign_agents ca
          where ca.campaign_id = c.id and ca.profile_id = (select auth.uid())
        )
      )
    )
  order by c.name;
$function$;
