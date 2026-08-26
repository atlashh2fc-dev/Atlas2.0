-- El alcance operacional del supervisor debe incluir campañas que alimentan
-- una cola omnicanal aunque sus leads todavía estén sin equipo o responsable.
-- La tabla de fuentes ya limita SELECT a admin/supervisor mediante RLS.
create or replace function public.get_report_scope_campaigns()
returns table(id uuid, name text)
language sql
stable
security invoker
set search_path = public
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
          )
          or exists (
            select 1
            from public.contact_center_queue_sources source
            where source.campaign_id = c.id
              and source.is_active
          )
        )
      )
      or (
        (select public.current_role_name()) = 'agente'
        and exists (
          select 1
          from public.campaign_agents ca
          where ca.campaign_id = c.id
            and ca.profile_id = (select auth.uid())
        )
      )
    )
  order by c.name;
$function$;

revoke all on function public.get_report_scope_campaigns() from public, anon;
grant execute on function public.get_report_scope_campaigns() to authenticated;
