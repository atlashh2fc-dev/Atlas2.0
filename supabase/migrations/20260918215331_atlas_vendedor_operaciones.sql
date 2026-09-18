-- Lo que el agente puede leer y lo que puede escribir. Nada más.
--
-- `respuestas_sin_atender` le entrega solo las respuestas recientes que todavía
-- nadie trabajó, de su empresa. `guardar_borrador_de_venta` es su única forma de
-- dejar algo escrito. Las dos son de service_role: ninguna sesión de navegador
-- las alcanza.
--
-- La versión vigente de `guardar_borrador_de_venta` está en 20260918221657.

create or replace function public.respuestas_sin_atender(
  p_organization_slug text,
  p_limite integer default 10
)
returns table (
  mail_message_id uuid,
  lead_id uuid,
  opportunity_id uuid,
  de_email text,
  nombre text,
  empresa text,
  asunto text,
  cuerpo text,
  recibido_at timestamptz
)
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  with org as (select public.organization_id_by_slug(p_organization_slug) as id)
  select m.id, m.lead_id,
    (select o.id from public.sales_opportunities o
      join public.sales_contacts ct on ct.id = o.contact_id
      where o.organization_id = (select id from org)
        and lower(ct.email) = lower(m.from_email)
      order by o.created_at desc limit 1),
    m.from_email,
    l.full_name,
    coalesce((select c2.name from public.sales_companies c2
      join public.sales_contacts ct2 on ct2.company_id = c2.id
      where c2.organization_id = (select id from org)
        and lower(ct2.email) = lower(m.from_email) limit 1), l.full_name),
    m.subject,
    m.body_text,
    m.occurred_at
  from public.lead_mail_messages m
  join public.campaigns c on c.id = m.campaign_id
  left join public.leads l on l.id = m.lead_id
  where c.organization_id = (select id from org)
    and m.direction = 'inbound'
    and m.body_text is not null
    and btrim(m.body_text) <> ''
    and not exists (
      select 1 from public.sales_agent_drafts d where d.mail_message_id = m.id
    )
    -- Una respuesta de hace semanas ya no se contesta: se vería raro.
    and m.occurred_at > now() - interval '7 days'
  order by m.occurred_at desc
  limit greatest(1, least(coalesce(p_limite, 10), 50));
$$;

revoke all on function public.respuestas_sin_atender(text, integer) from public;
revoke execute on function public.respuestas_sin_atender(text, integer) from anon, authenticated;
grant execute on function public.respuestas_sin_atender(text, integer) to service_role;
