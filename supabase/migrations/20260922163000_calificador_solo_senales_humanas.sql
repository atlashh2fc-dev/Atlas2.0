-- El calificador solo cree en señales de personas.
--
-- Los filtros de seguridad de los correos corporativos abren el correo y visitan
-- cada enlace segundos después de la entrega. El calificador tomaba esas visitas
-- como interés: DLS-Binar entró a Contactado por un "clic" a los 20 segundos, y
-- Rexnord por uno a los 44 segundos, dos minutos antes de darse de baja. Ambos
-- aparecían como "lo más caliente que hay".
--
-- Ahora una apertura o un clic cuenta solo si llegó 60 segundos o más después
-- del envío de ese mismo correo, y nunca se sube al embudo a quien se dio de
-- baja o marcó el correo como spam.

create or replace function public.calificar_interes_de_correo(p_organization_slug text, p_limite integer default 50)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_org uuid := public.organization_id_by_slug(p_organization_slug);
  v_senal record;
  v_company uuid;
  v_contact uuid;
  v_stage uuid;
  v_opportunity uuid;
  v_creados int := 0;
  v_anotados int := 0;
  v_nombre text;
begin
  if v_org is null then
    raise exception 'La empresa % no existe', p_organization_slug;
  end if;

  for v_senal in
    select l.id as lead_id,
           l.full_name,
           l.email,
           l.phone,
           humana.clicked,
           humana.opened,
           humana.visto_at
    from public.lead_mail_status lms
    join public.leads l on l.id = lms.lead_id
    join public.campaigns c on c.id = lms.campaign_id
    cross join lateral (
      select bool_or(e.payload->>'event_kind' = 'clicked') as clicked,
             bool_or(e.payload->>'event_kind' in ('opened', 'clicked')) as opened,
             max(e.occurred_at) as visto_at
      from public.external_lead_events e
      where e.lead_id = lms.lead_id
        and e.campaign_id = lms.campaign_id
        and e.payload->>'event_kind' in ('opened', 'clicked')
        -- A segundos del envío es un escáner, no una persona.
        and e.occurred_at >= coalesce((
          select min(s.occurred_at)
          from public.external_lead_events s
          where s.lead_id = e.lead_id
            and s.payload->>'event_kind' = 'sent'
            and s.payload->>'message_id' = e.payload->>'message_id'
        ), '-infinity'::timestamptz) + interval '60 seconds'
    ) humana
    where c.organization_id = v_org
      and coalesce(humana.opened, false)
      and not coalesce(lms.unsubscribed, false)
      and not coalesce(lms.complained, false)
      and l.email is not null
      -- Lo que el agente ya trabajo no se vuelve a tomar.
      and not exists (
        select 1 from public.sales_activities a
        where a.organization_id = v_org
          and a.metadata->>'lead_id' = l.id::text
      )
    order by humana.clicked desc, humana.visto_at desc nulls last
    limit greatest(1, least(coalesce(p_limite, 50), 200))
  loop
    v_nombre := public.nombre_presentable(
      coalesce(nullif(btrim(v_senal.full_name), ''), split_part(v_senal.email, '@', 1))
    );

    -- La empresa se reutiliza por correo; si no existe, nace del agente.
    select company_id into v_company
    from public.sales_contacts
    where organization_id = v_org and lower(email) = lower(v_senal.email)
    limit 1;

    if v_company is null then
      insert into public.sales_companies (organization_id, name, source, email, phone)
      values (v_org, v_nombre, 'agente_calificador', lower(v_senal.email), nullif(btrim(coalesce(v_senal.phone, '')), ''))
      returning id into v_company;

      insert into public.sales_contacts (organization_id, company_id, full_name, email, phone)
      values (v_org, v_company, v_nombre, lower(v_senal.email), nullif(btrim(coalesce(v_senal.phone, '')), ''))
      returning id into v_contact;
    else
      select id into v_contact
      from public.sales_contacts
      where organization_id = v_org and company_id = v_company
      order by created_at limit 1;
    end if;

    -- Un clic ya es una mano levantada; una apertura es solo atencion.
    select id into v_stage
    from public.sales_stages
    where organization_id = v_org and active
      and key = case when v_senal.clicked then 'contactado' else 'prospecto' end
    limit 1;

    select id into v_opportunity
    from public.sales_opportunities
    where organization_id = v_org and company_id = v_company and status = 'abierta'
    order by created_at desc limit 1;

    if v_opportunity is null then
      insert into public.sales_opportunities (
        organization_id, company_id, contact_id, name, stage_id,
        monthly_amount, source, next_action_at, next_action_note
      )
      values (
        v_org, v_company, v_contact,
        case when v_senal.clicked then 'Hizo clic en la campana' else 'Abrio la campana' end,
        v_stage, 0, 'agente_calificador',
        now() + interval '1 day',
        case when v_senal.clicked
          then 'Hizo clic: escribirle hoy, es lo mas caliente que hay'
          else 'Abrio el correo: escribirle con un segundo mensaje corto'
        end
      )
      returning id into v_opportunity;
      v_creados := v_creados + 1;
    else
      v_anotados := v_anotados + 1;
    end if;

    insert into public.sales_activities (
      organization_id, opportunity_id, company_id, contact_id, kind, subject, body,
      occurred_at, due_at, done, metadata
    )
    values (
      v_org, v_opportunity, v_company, v_contact, 'nota',
      case when v_senal.clicked then 'Hizo clic en el correo' else 'Abrio el correo' end,
      'Detectado por el agente calificador a partir de la campana de correo.',
      coalesce(v_senal.visto_at, now()), now() + interval '1 day', false,
      jsonb_build_object(
        'lead_id', v_senal.lead_id,
        'agente', 'calificador',
        'senal', case when v_senal.clicked then 'clic' else 'apertura' end
      )
    );
  end loop;

  return jsonb_build_object(
    'empresa', p_organization_slug,
    'negocios_creados', v_creados,
    'negocios_ya_existentes', v_anotados,
    'corrida_at', now()
  );
end;
$function$;

revoke all on function public.calificar_interes_de_correo(text, integer) from public;
revoke execute on function public.calificar_interes_de_correo(text, integer) from anon, authenticated;
grant execute on function public.calificar_interes_de_correo(text, integer) to service_role;

-- Los negocios que nacieron solo de un escáner se cierran con el motivo escrito:
-- los que abrió el calificador, sin ninguna gestión humana y sin una sola señal
-- de persona. Al 22-09-2026 son 9 en Altius (DLS-Binar y Rexnord en Contactado,
-- 7 en Prospecto). Rexnord además se dio de baja en Atlas Lead.
with falsos as (
  select o.id as opportunity_id, a.metadata->>'lead_id' as lead_id
  from public.sales_opportunities o
  join public.sales_activities a
    on a.opportunity_id = o.id and a.metadata->>'agente' = 'calificador'
  where o.status = 'abierta'
    and o.source = 'agente_calificador'
    and not exists (
      select 1 from public.sales_activities x
      where x.opportunity_id = o.id
        and coalesce(x.metadata->>'agente', '') <> 'calificador'
    )
    and not exists (
      select 1 from public.external_lead_events e
      where e.lead_id::text = a.metadata->>'lead_id'
        and e.payload->>'event_kind' in ('opened', 'clicked')
        and e.occurred_at >= coalesce((
          select min(s.occurred_at)
          from public.external_lead_events s
          where s.lead_id = e.lead_id
            and s.payload->>'event_kind' = 'sent'
            and s.payload->>'message_id' = e.payload->>'message_id'
        ), '-infinity'::timestamptz) + interval '60 seconds'
    )
),
cerrados as (
  update public.sales_opportunities o
  set status = 'perdida',
      closed_at = now(),
      lost_reason = case
        when f.lead_id = 'bee0b6f5-f613-4e9e-acb1-adf1ceb4325f'
          then 'La señal fue de un filtro de seguridad y el contacto se dio de baja'
        else 'La señal fue de un filtro de seguridad, no de una persona'
      end,
      next_action_at = null,
      next_action_note = null,
      updated_at = now()
  from falsos f
  where o.id = f.opportunity_id
  returning o.id
)
update public.sales_activities a
set done = true
from cerrados c
where a.opportunity_id = c.id
  and a.metadata->>'agente' = 'calificador';
