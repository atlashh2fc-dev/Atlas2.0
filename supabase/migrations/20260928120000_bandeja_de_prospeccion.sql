-- Pegar en Supabase > proyecto atlas-crm (lxdclavsycdidmzlbaid) > SQL Editor > Run.
--
-- La bandeja de prospección: quien abrió, hizo clic o respondió la campaña de
-- correo y espera que alguien le escriba. Es el trabajo que el resumen diario
-- de Atlas Lead anuncia ("Para contactar hoy por WhatsApp"); el correo avisa,
-- la gestión queda acá.
--
-- Una señal no es un negocio. Hasta hoy el calificador convertía cada apertura
-- en un negocio en "Prospecto": el 28-09-2026 los 43 negocios abiertos de
-- Altius eran "Abrio la campana" y ninguno tenía una sola gestión humana. El
-- pipeline estaba sirviendo de bandeja de leads. Desde ahora un lead nace como
-- negocio solo cuando una persona lo marca "Interesado" desde la bandeja.

-- ---------------------------------------------------------------------------
-- Cada intento con un prospecto: qué se hizo, qué pasó y cuándo volver.

create table if not exists public.prospeccion_toques (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  lead_id uuid not null references public.leads(id) on delete cascade,
  resultado text not null check (resultado in (
    'whatsapp', 'llamada', 'correo',          -- se le escribió o llamó: volver en unos días
    'posponer',                               -- no ahora
    'interesado', 'no_interesa', 'numero_malo' -- cierran la gestión en la bandeja
  )),
  nota text,
  seguir_at timestamptz,
  opportunity_id uuid references public.sales_opportunities(id) on delete set null,
  hecho_por uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists prospeccion_toques_lead_idx on public.prospeccion_toques (lead_id, created_at desc);
create index if not exists prospeccion_toques_org_idx on public.prospeccion_toques (organization_id, created_at desc);

alter table public.prospeccion_toques enable row level security;

drop policy if exists prospeccion_toques_select on public.prospeccion_toques;
create policy prospeccion_toques_select on public.prospeccion_toques
  for select to authenticated
  using (organization_id = any (public.current_org_ids())
     and (select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role]));

-- Se escribe solo por registrar_toque_de_prospeccion. Deshacer sí es directo,
-- y solo lo propio, reciente y que no creó un negocio.
drop policy if exists prospeccion_toques_delete on public.prospeccion_toques;
create policy prospeccion_toques_delete on public.prospeccion_toques
  for delete to authenticated
  using (organization_id = any (public.current_org_ids())
     and hecho_por = auth.uid()
     and created_at > now() - interval '1 day'
     and resultado <> 'interesado');

-- ---------------------------------------------------------------------------
-- La cola de una empresa. Interna: la leen la bandeja (con sesión) y el
-- vigilante (sin sesión), cada uno por su puerta.

create or replace function public.prospeccion_de_empresa(p_org uuid, p_dias integer default 14)
returns table (
  lead_id uuid,
  empresa text,
  contacto text,
  email text,
  telefono text,
  campana text,
  clic boolean,
  aperturas integer,
  respondio boolean,
  primera_senal_at timestamptz,
  ultima_senal_at timestamptz,
  ultimo_resultado text,
  ultimo_toque_at timestamptz,
  seguir_at timestamptz,
  toques integer,
  estado text,
  prioridad integer
)
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
  with ventana as (
    select now() - make_interval(days => greatest(1, least(coalesce(p_dias, 14), 60))) as desde
  ),
  senales as (
    select e.lead_id,
           bool_or(e.payload->>'event_kind' = 'clicked') as clic,
           count(*) filter (where e.payload->>'event_kind' = 'opened')::int as aperturas,
           min(e.occurred_at) as primera,
           max(e.occurred_at) as ultima
    from public.external_lead_events e
    join public.leads l on l.id = e.lead_id and l.organization_id = p_org
    where e.payload->>'event_kind' in ('opened', 'clicked')
      and e.occurred_at > (select desde from ventana)
      -- A segundos del envío es un escáner, no una persona.
      and e.occurred_at >= coalesce((
        select min(s.occurred_at)
        from public.external_lead_events s
        where s.lead_id = e.lead_id
          and s.payload->>'event_kind' = 'sent'
          and s.payload->>'message_id' = e.payload->>'message_id'
      ), '-infinity'::timestamptz) + interval '60 seconds'
    group by e.lead_id
  ),
  respuestas as (
    select m.lead_id, min(m.occurred_at) as primera, max(m.occurred_at) as ultima
    from public.lead_mail_messages m
    join public.leads l on l.id = m.lead_id and l.organization_id = p_org
    where m.direction = 'inbound'
      and m.occurred_at > (select desde from ventana)
    group by m.lead_id
  ),
  interes as (
    select coalesce(s.lead_id, r.lead_id) as lead_id,
           coalesce(s.clic, false) as clic,
           coalesce(s.aperturas, 0) as aperturas,
           r.lead_id is not null as respondio,
           least(s.primera, r.primera) as primera,
           greatest(s.ultima, r.ultima) as ultima
    from senales s
    full join respuestas r on r.lead_id = s.lead_id
  ),
  toques as (
    select distinct on (t.lead_id)
           t.lead_id, t.resultado, t.created_at, t.seguir_at,
           count(*) over (partition by t.lead_id)::int as cuantos
    from public.prospeccion_toques t
    where t.organization_id = p_org
    order by t.lead_id, t.created_at desc
  ),
  cola as (
    select i.*, l.full_name, l.email, l.phone, l.extra, l.campaign_id,
           u.resultado, u.created_at as toque_at, u.seguir_at, coalesce(u.cuantos, 0) as cuantos,
           case
             when u.lead_id is null then 'nuevo'
             when i.ultima > u.created_at then 'volvio'
             when u.seguir_at <= now() then 'seguimiento'
             else 'esperando'
           end as estado
    from interes i
    join public.leads l on l.id = i.lead_id
    left join toques u on u.lead_id = i.lead_id
    where not exists (
        select 1 from public.lead_mail_status lms
        where lms.lead_id = l.id and (lms.unsubscribed or lms.complained)
      )
      -- Si ya es negocio, se trabaja en el pipeline.
      and not exists (
        select 1 from public.sales_opportunities o
        where o.organization_id = p_org and o.lead_id = l.id
      )
      and coalesce(u.resultado, '') not in ('interesado', 'no_interesa', 'numero_malo')
  )
  select c.lead_id,
         public.nombre_presentable(coalesce(
           nullif(btrim(c.extra->>'company_name'), ''),
           nullif(btrim(c.extra->>'company'), ''),
           nullif(btrim(c.full_name), ''),
           split_part(c.email, '@', 1)
         )),
         public.nombre_presentable(coalesce(nullif(btrim(c.extra->>'contact_name'), ''), nullif(btrim(c.full_name), ''))),
         c.email,
         nullif(btrim(c.phone), ''),
         ca.name,
         c.clic,
         c.aperturas,
         c.respondio,
         c.primera,
         c.ultima,
         c.resultado,
         c.toque_at,
         c.seguir_at,
         c.cuantos,
         c.estado,
         case
           when c.respondio then 0
           when c.clic then 1
           when c.estado = 'volvio' then 2
           when c.estado = 'nuevo' and c.aperturas > 1 then 3
           when c.estado = 'nuevo' then 4
           else 5
         end
  from cola c
  left join public.campaigns ca on ca.id = c.campaign_id
  where c.estado <> 'esperando'
  order by 17, c.ultima desc nulls last;
$function$;

revoke all on function public.prospeccion_de_empresa(uuid, integer) from public;
revoke execute on function public.prospeccion_de_empresa(uuid, integer) from anon, authenticated;
grant execute on function public.prospeccion_de_empresa(uuid, integer) to service_role;

-- La puerta con sesión: la empresa activa de quien mira, y solo comercial.
create or replace function public.bandeja_de_prospeccion(p_dias integer default 14)
returns table (
  lead_id uuid,
  empresa text,
  contacto text,
  email text,
  telefono text,
  campana text,
  clic boolean,
  aperturas integer,
  respondio boolean,
  primera_senal_at timestamptz,
  ultima_senal_at timestamptz,
  ultimo_resultado text,
  ultimo_toque_at timestamptz,
  seguir_at timestamptz,
  toques integer,
  estado text,
  prioridad integer
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  if (select public.current_role_name()) not in ('admin'::public.app_role, 'supervisor'::public.app_role)
     and not public.is_platform_owner() then
    raise exception 'Solo el equipo comercial ve la bandeja' using errcode = '42501';
  end if;
  return query select * from public.prospeccion_de_empresa(public.current_org_id(), p_dias);
end;
$function$;

revoke all on function public.bandeja_de_prospeccion(integer) from public;
revoke execute on function public.bandeja_de_prospeccion(integer) from anon;
grant execute on function public.bandeja_de_prospeccion(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Registrar lo que se hizo. "Interesado" es el único camino por el que un
-- prospecto entra al pipeline: en "Contactado", con responsable y fecha.

create or replace function public.registrar_toque_de_prospeccion(
  p_lead_id uuid,
  p_resultado text,
  p_nota text default null,
  p_dias integer default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_org uuid := public.current_org_id();
  v_yo uuid := auth.uid();
  v_lead record;
  v_seguir timestamptz;
  v_empresa text;
  v_company uuid;
  v_contact uuid;
  v_stage uuid;
  v_opportunity uuid;
  v_nota text := nullif(btrim(coalesce(p_nota, '')), '');
begin
  if (select public.current_role_name()) not in ('admin'::public.app_role, 'supervisor'::public.app_role)
     and not public.is_platform_owner() then
    raise exception 'Solo el equipo comercial gestiona prospectos' using errcode = '42501';
  end if;
  if p_resultado not in ('whatsapp', 'llamada', 'correo', 'posponer', 'interesado', 'no_interesa', 'numero_malo') then
    raise exception 'Resultado desconocido: %', p_resultado;
  end if;

  select l.id, l.full_name, l.email, l.phone, l.extra, l.campaign_id
    into v_lead
  from public.leads l
  where l.id = p_lead_id and l.organization_id = v_org;
  if not found then
    raise exception 'Ese prospecto no es de tu empresa';
  end if;

  v_seguir := case
    when p_resultado in ('whatsapp', 'llamada', 'correo') then now() + make_interval(days => greatest(1, least(coalesce(p_dias, 3), 60)))
    when p_resultado = 'posponer' then now() + make_interval(days => greatest(1, least(coalesce(p_dias, 7), 60)))
    else null
  end;

  if p_resultado = 'interesado' then
    select o.id into v_opportunity
    from public.sales_opportunities o
    where o.organization_id = v_org and o.lead_id = v_lead.id
    order by o.created_at desc limit 1;

    if v_opportunity is null then
      v_empresa := public.nombre_presentable(coalesce(
        nullif(btrim(v_lead.extra->>'company_name'), ''),
        nullif(btrim(v_lead.extra->>'company'), ''),
        nullif(btrim(v_lead.full_name), ''),
        split_part(v_lead.email, '@', 1)
      ));

      if v_lead.email is not null then
        select ct.company_id, ct.id into v_company, v_contact
        from public.sales_contacts ct
        where ct.organization_id = v_org and lower(ct.email) = lower(v_lead.email)
        order by ct.created_at limit 1;
      end if;

      if v_company is null then
        insert into public.sales_companies (organization_id, name, source, email, phone, metadata, created_by)
        values (v_org, v_empresa, 'atlas_lead', lower(v_lead.email), nullif(btrim(coalesce(v_lead.phone, '')), ''),
                jsonb_build_object('lead_id', v_lead.id), v_yo)
        returning id into v_company;

        insert into public.sales_contacts (organization_id, company_id, full_name, email, phone)
        values (v_org, v_company,
                public.nombre_presentable(coalesce(nullif(btrim(v_lead.extra->>'contact_name'), ''), v_lead.full_name, v_empresa)),
                lower(v_lead.email), nullif(btrim(coalesce(v_lead.phone, '')), ''))
        returning id into v_contact;
      end if;

      select id into v_stage
      from public.sales_stages
      where organization_id = v_org and active and key = 'contactado'
      limit 1;
      if v_stage is null then
        select id into v_stage
        from public.sales_stages
        where organization_id = v_org and active and not is_won and not is_lost
        order by position limit 1;
      end if;
      if v_stage is null then
        raise exception 'No hay etapas configuradas';
      end if;

      insert into public.sales_opportunities (
        organization_id, company_id, contact_id, name, stage_id, status, monthly_amount,
        source, campaign_id, lead_id, owner_id, created_by, next_action_at, next_action_note
      )
      values (
        v_org, v_company, v_contact, v_empresa || ' · desde Atlas Lead', v_stage, 'abierta', 0,
        'atlas_lead', v_lead.campaign_id, v_lead.id, v_yo, v_yo,
        now() + interval '1 day', coalesce(v_nota, 'Mostró interés: proponer una reunión')
      )
      returning id into v_opportunity;
    end if;

    insert into public.sales_activities (
      organization_id, opportunity_id, company_id, contact_id, kind, subject, body, occurred_at, done, owner_id, metadata
    )
    select v_org, o.id, o.company_id, o.contact_id, 'nota', 'Interesado desde la bandeja de prospección',
           v_nota, now(), true, v_yo, jsonb_build_object('lead_id', v_lead.id, 'origen', 'prospeccion')
    from public.sales_opportunities o where o.id = v_opportunity;
  end if;

  insert into public.prospeccion_toques (organization_id, lead_id, resultado, nota, seguir_at, opportunity_id, hecho_por)
  values (v_org, v_lead.id, p_resultado, v_nota, v_seguir, v_opportunity, v_yo);

  return jsonb_build_object('opportunity_id', v_opportunity, 'seguir_at', v_seguir);
end;
$function$;

revoke all on function public.registrar_toque_de_prospeccion(uuid, text, text, integer) from public;
revoke execute on function public.registrar_toque_de_prospeccion(uuid, text, text, integer) from anon;
grant execute on function public.registrar_toque_de_prospeccion(uuid, text, text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- El calificador se retira: la bandeja calcula la señal en vivo y nadie tiene
-- que convertirla en negocio. Queda la función para que una corrida en vuelo
-- no falle mientras se publica el código sin el cron.

create or replace function public.calificar_interes_de_correo(p_organization_slug text, p_limite integer default 50)
returns jsonb
language sql
stable
set search_path to 'pg_catalog', 'public'
as $function$
  select jsonb_build_object(
    'empresa', p_organization_slug,
    'retirado', true,
    'detalle', 'Las señales de correo se gestionan en la bandeja de prospección; ya no se crean negocios por apertura.'
  );
$function$;

revoke all on function public.calificar_interes_de_correo(text, integer) from public;
revoke execute on function public.calificar_interes_de_correo(text, integer) from anon, authenticated;
grant execute on function public.calificar_interes_de_correo(text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Los negocios que eran solo una señal salen del pipeline. Se respaldan antes
-- (con sus notas) y la señal sigue viva en la bandeja: nada se pierde.

create table if not exists public.respaldo_negocios_de_senal_20260928 as
select o.*
from public.sales_opportunities o
where o.source = 'agente_calificador'
  and o.status = 'abierta'
  and not exists (
    select 1 from public.sales_activities a
    where a.opportunity_id = o.id
      and coalesce(a.metadata->>'agente', '') <> 'calificador'
  );

create table if not exists public.respaldo_actividades_de_senal_20260928 as
select a.*
from public.sales_activities a
where a.opportunity_id in (select id from public.respaldo_negocios_de_senal_20260928);

alter table public.respaldo_negocios_de_senal_20260928 enable row level security;
alter table public.respaldo_actividades_de_senal_20260928 enable row level security;

delete from public.sales_opportunities o
using public.respaldo_negocios_de_senal_20260928 r
where o.id = r.id;

-- ---------------------------------------------------------------------------
-- El vigilante ya no pregunta si la señal se volvió negocio, sino si alguien
-- le escribió a quien mostró interés. Es la medida que importa: el lead que
-- espera más de un día se enfría.

create or replace function public.verificar_procesos_de_empresa(p_organization_slug text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_org uuid := public.organization_id_by_slug(p_organization_slug);
  v_revisiones jsonb := '[]'::jsonb;
  v_campanas_mudas text[];
  v_sin_gestion int;
  v_calientes_sin_gestion int;
  v_leads_desalineados int;
  v_politicas_rotas int;
  v_vencidos int;
  v_lote_en_espera int;
  v_circuitos_abiertos int;
  v_ultimo_lote timestamptz;
  v_dias_sin_lote numeric;
begin
  if v_org is null then
    raise exception 'La empresa % no existe', p_organization_slug;
  end if;

  select coalesce(
    array_agg(mc.name order by mc.name) filter (
      where not exists (
        select 1 from public.mail_campaign_lead_status s
        where s.mail_campaign_id = mc.id and s.sent_count > 0
      )
    ),
    '{}'::text[]
  )
  into v_campanas_mudas
  from public.mail_campaigns mc
  join public.campaigns c on c.id = mc.campaign_id
  where c.organization_id = v_org and mc.status = 'active';

  v_revisiones := v_revisiones || public.verificar_envios_de_correo(v_org);

  select count(*) filter (where b.estado = 'nuevo' and b.primera_senal_at < now() - interval '24 hours'),
         count(*) filter (where b.estado = 'nuevo' and (b.clic or b.respondio) and b.ultima_senal_at < now() - interval '4 hours')
    into v_sin_gestion, v_calientes_sin_gestion
  from public.prospeccion_de_empresa(v_org, 14) b;

  v_revisiones := v_revisiones || jsonb_build_object(
    'revision', 'Interés sin gestionar',
    'estado', case
      when v_calientes_sin_gestion > 0 then 'alerta'
      when v_sin_gestion > 0 then 'aviso'
      else 'ok' end,
    'detalle', case
      when v_calientes_sin_gestion > 0 then v_calientes_sin_gestion || ' persona(s) hicieron clic o respondieron hace más de cuatro horas y nadie les ha escrito. Están en Ventas > Prospección.'
      when v_sin_gestion > 0 then v_sin_gestion || ' persona(s) abrieron la campaña hace más de un día y siguen sin gestión en Ventas > Prospección.'
      else 'Todo interés de más de un día ya tiene una gestión registrada.'
    end
  );

  select count(*) into v_leads_desalineados
  from public.leads l
  join public.campaigns c on c.id = l.campaign_id
  where l.organization_id is distinct from c.organization_id;

  v_revisiones := v_revisiones || jsonb_build_object(
    'revision', 'Frontera entre empresas',
    'estado', case when v_leads_desalineados = 0 then 'ok' else 'alerta' end,
    'detalle', case
      when v_leads_desalineados = 0 then 'Ningún registro quedó en una empresa distinta a la de su campaña.'
      else v_leads_desalineados || ' registro(s) están marcados con otra empresa: datos visibles para quien no corresponde.'
    end
  );

  select count(*) into v_politicas_rotas
  from pg_policies
  where schemaname = 'public'
    and (qual like '%\_sin\_empresa%' or with_check like '%\_sin\_empresa%');

  v_revisiones := v_revisiones || jsonb_build_object(
    'revision', 'Permisos de lectura',
    'estado', case when v_politicas_rotas = 0 then 'ok' else 'alerta' end,
    'detalle', case
      when v_politicas_rotas = 0 then 'Ninguna política apunta a una función sin permiso de ejecución.'
      else v_politicas_rotas || ' política(s) llaman a una función que nadie puede ejecutar: esas pantallas van a responder error.'
    end
  );

  select count(*) into v_vencidos
  from public.sales_opportunities
  where organization_id = v_org and status = 'abierta'
    and next_action_at is not null and next_action_at < now();

  v_revisiones := v_revisiones || jsonb_build_object(
    'revision', 'Trabajo pendiente',
    'estado', case when v_vencidos = 0 then 'ok' when v_vencidos <= 10 then 'aviso' else 'alerta' end,
    'detalle', case
      when v_vencidos = 0 then 'Ningún negocio tiene la próxima acción vencida.'
      else v_vencidos || ' negocio(s) tienen la próxima acción vencida y esperan gestión.'
    end
  );

  select count(*) into v_lote_en_espera
  from public.mail_campaigns mc
  join public.campaigns c on c.id = mc.campaign_id
  where c.organization_id = v_org
    and mc.status = 'active'
    and mc.created_at < now() - interval '24 hours'
    and not exists (
      select 1 from public.mail_campaign_lead_status s
      where s.mail_campaign_id = mc.id
    );

  v_revisiones := v_revisiones || jsonb_build_object(
    'revision', 'Campañas que nunca enviaron',
    'estado', case when v_lote_en_espera = 0 then 'ok' else 'alerta' end,
    'detalle', case
      when v_lote_en_espera = 0 then 'Toda campaña activa ya entregó al menos un contacto.'
      else v_lote_en_espera || ' campaña(s) activas no han entregado un solo contacto desde que se crearon: ' ||
           array_to_string(v_campanas_mudas, '; ') || '.'
    end
  );

  select count(*) filter (where cs.state = 'open')
  into v_circuitos_abiertos
  from public.integration_circuit_states cs;

  select max(b.accepted_at) into v_ultimo_lote
  from public.integration_inbox_batches b
  where b.campaign_key is not null;

  v_dias_sin_lote := case
    when v_ultimo_lote is null then null
    else round(extract(epoch from (now() - v_ultimo_lote)) / 86400.0)
  end;

  v_revisiones := v_revisiones || jsonb_build_object(
    'revision', 'Puente con Atlas Lead',
    'estado', case
      when v_circuitos_abiertos > 0 then 'alerta'
      when v_ultimo_lote is null or v_dias_sin_lote > 3 then 'aviso'
      else 'ok' end,
    'detalle', case
      when v_circuitos_abiertos > 0 then
        v_circuitos_abiertos || ' circuito(s) de salida abiertos: lo que Atlas devuelve a Atlas Lead no está llegando. Revisar INTEGRATION_OUTBOX_DESTINATIONS_JSON.'
      when v_ultimo_lote is null then
        'Atlas Lead nunca ha reportado un lote de campaña.'
      when v_dias_sin_lote > 3 then
        'Atlas Lead no reporta un lote con campaña desde hace ' || v_dias_sin_lote || ' días.'
      else
        'El puente responde; último lote con campaña hace ' || v_dias_sin_lote || ' día(s).'
    end,
    'ultimo_movimiento', v_ultimo_lote
  );

  return jsonb_build_object(
    'empresa', p_organization_slug,
    'revisado_at', now(),
    'alertas', (select count(*) from jsonb_array_elements(v_revisiones) r where r->>'estado' = 'alerta'),
    'avisos', (select count(*) from jsonb_array_elements(v_revisiones) r where r->>'estado' = 'aviso'),
    'revisiones', v_revisiones
  );
end;
$function$;
