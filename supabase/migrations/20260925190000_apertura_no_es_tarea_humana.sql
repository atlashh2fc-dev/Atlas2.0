-- Pegar en Supabase > proyecto atlas-crm (lxdclavsycdidmzlbaid) > SQL Editor > Run.
--
-- Una apertura de correo ya no es trabajo para una persona: la secuencia de
-- Atlas Lead le escribe los toques siguientes sola. Solo un clic crea tarea.
-- Además limpia los negocios de apertura que hoy aparecen con acción vencida.

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
        -- Una apertura no es tarea de nadie; solo un clic pide a una persona.
        case when v_senal.clicked then now() + interval '1 day' else null end,
        case when v_senal.clicked
          then 'Hizo clic: escribirle hoy, es lo mas caliente que hay'
          else 'Abrió el correo. La secuencia automática le sigue escribiendo; actuar solo si responde o hace clic.'
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
      coalesce(v_senal.visto_at, now()),
      case when v_senal.clicked then now() + interval '1 day' else null end,
      not v_senal.clicked,
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

-- Los negocios que ya existían por una apertura, sin ninguna gestión humana,
-- quedan sin acción vencida.
with solo_apertura as (
  select o.id
  from public.sales_opportunities o
  where o.status = 'abierta'
    and o.source = 'agente_calificador'
    and o.stage_id in (select id from public.sales_stages where key = 'prospecto')
    and not exists (
      select 1 from public.sales_activities x
      where x.opportunity_id = o.id
        and coalesce(x.metadata->>'agente', '') <> 'calificador'
    )
),
negocios as (
  update public.sales_opportunities o
  set next_action_at = null,
      next_action_note = 'Abrió el correo. La secuencia automática le sigue escribiendo; actuar solo si responde o hace clic.',
      updated_at = now()
  from solo_apertura s
  where o.id = s.id
  returning o.id
)
update public.sales_activities a
set done = true, due_at = null
from negocios n
where a.opportunity_id = n.id
  and a.metadata->>'agente' = 'calificador'
  and a.metadata->>'senal' = 'apertura';

-- Resultado: cuántos negocios quedan con acción vencida por empresa.
select o.slug as empresa, count(*) as vencidos
from public.sales_opportunities so
join public.organizations o on o.id = so.organization_id
where so.status = 'abierta' and so.next_action_at < now()
group by o.slug
order by o.slug;
