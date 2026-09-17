-- El agente que convierte interés en trabajo concreto.
--
-- Hoy alguien abre el correo o hace clic y esa señal se queda en una casilla de
-- la pantalla de Correo. Nadie la persigue. Este agente toma cada señal y crea
-- el negocio en el embudo, con su próxima acción y su fecha, para que exista
-- alguien a quien llamar mañana.
--
-- Reglas de la casa:
-- - Un clic vale más que una apertura: entra más adelante en el embudo.
-- - Nunca duplica: si esa empresa ya tiene un negocio abierto, solo anota.
-- - No inventa montos. El precio se acuerda hablando.
-- - Deja firmada cada creación como obra del agente, no de una persona.

create or replace function public.calificar_interes_de_correo(
  p_organization_slug text,
  p_limite integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
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
           lms.clicked,
           lms.opened,
           greatest(coalesce(lms.updated_at, lms.last_seen_at), lms.first_seen_at) as visto_at
    from public.lead_mail_status lms
    join public.leads l on l.id = lms.lead_id
    join public.campaigns c on c.id = lms.campaign_id
    where c.organization_id = v_org
      and (lms.opened or lms.clicked)
      and l.email is not null
      -- Lo que el agente ya trabajó no se vuelve a tomar.
      and not exists (
        select 1 from public.sales_activities a
        where a.organization_id = v_org
          and a.metadata->>'lead_id' = l.id::text
      )
    order by lms.clicked desc, lms.updated_at desc nulls last
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

    -- Un clic ya es una mano levantada; una apertura es solo atención.
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
        case when v_senal.clicked then 'Hizo clic en la campaña' else 'Abrió la campaña' end,
        v_stage, 0, 'agente_calificador',
        now() + interval '1 day',
        case when v_senal.clicked
          then 'Hizo clic: escribirle hoy, es lo más caliente que hay'
          else 'Abrió el correo: escribirle con un segundo mensaje corto'
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
      case when v_senal.clicked then 'Hizo clic en el correo' else 'Abrió el correo' end,
      'Detectado por el agente calificador a partir de la campaña de correo.',
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
$$;

revoke all on function public.calificar_interes_de_correo(text, integer) from public;
revoke execute on function public.calificar_interes_de_correo(text, integer) from anon, authenticated;
grant execute on function public.calificar_interes_de_correo(text, integer) to service_role;

create index if not exists sales_activities_lead_id_idx
  on public.sales_activities ((metadata->>'lead_id'))
  where metadata ? 'lead_id';

do $$
begin
  if has_function_privilege('anon', 'public.calificar_interes_de_correo(text, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.calificar_interes_de_correo(text, integer)', 'execute') then
    raise exception 'El agente calificador quedó al alcance de una sesión de navegador';
  end if;
end;
$$;
