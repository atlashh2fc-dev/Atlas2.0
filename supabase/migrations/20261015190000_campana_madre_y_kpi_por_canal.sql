-- Campaña madre y KPI por canal.
--
-- En Reportes, una misma iniciativa aparecía repartida en tres campañas
-- («Secretaria Virtual», «Secretaria Virtual - Inbound» y «Meta Ads ·
-- WhatsApp · Secretaria Virtual Geimser») y no había forma de ver su resultado
-- completo. Es la jerarquía de campañas de Salesforce: la campaña es la
-- iniciativa de negocio y el canal es un atributo, no parte del nombre.
--
--  * `parent_campaign_id`: la campaña hija se suma a su madre en los reportes.
--    Un solo nivel: una madre no puede tener madre.
--  * `report_channel`: por dónde entra el contacto en esa campaña. Vacío se
--    lee como llamada saliente, que es el caso de casi todas.
--
-- Las hijas no se mueven: discador, flujos, línea de WhatsApp y agendas
-- siguen apuntando a la misma campaña de siempre. Solo cambia cómo se leen
-- los reportes.

alter table public.campaigns
  add column if not exists parent_campaign_id uuid references public.campaigns(id) on delete set null,
  add column if not exists report_channel text;

alter table public.campaigns drop constraint if exists campaigns_parent_not_self;
alter table public.campaigns
  add constraint campaigns_parent_not_self check (parent_campaign_id is null or parent_campaign_id <> id);

alter table public.campaigns drop constraint if exists campaigns_report_channel_check;
alter table public.campaigns
  add constraint campaigns_report_channel_check
  check (report_channel is null or report_channel in ('voz_saliente', 'voz_entrante', 'whatsapp', 'correo'));

create index if not exists campaigns_parent_campaign_id_idx
  on public.campaigns (parent_campaign_id)
  where parent_campaign_id is not null;

comment on column public.campaigns.parent_campaign_id is
  'Campaña madre. En Reportes la hija se suma a la madre y el selector solo lista madres. Un solo nivel.';
comment on column public.campaigns.report_channel is
  'Canal por el que entra el contacto en esta campaña (voz_saliente, voz_entrante, whatsapp, correo). Null = voz_saliente.';

-- Un solo nivel y misma empresa. Sin esto una madre con madre dejaría hijas
-- fuera de la suma, y una hija de otra empresa filtraría sus números.
create or replace function public.campaigns_validate_parent()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  parent record;
begin
  if new.parent_campaign_id is null then
    return new;
  end if;

  select id, organization_id, parent_campaign_id into parent
  from public.campaigns
  where id = new.parent_campaign_id;

  if parent.id is null then
    raise exception 'La campaña madre no existe.';
  end if;
  if parent.parent_campaign_id is not null then
    raise exception 'La campaña madre no puede ser hija de otra campaña.';
  end if;
  if parent.organization_id is distinct from new.organization_id then
    raise exception 'La campaña madre tiene que ser de la misma empresa.';
  end if;
  if exists (select 1 from public.campaigns child where child.parent_campaign_id = new.id) then
    raise exception 'Esta campaña ya agrupa a otras; no puede ser hija.';
  end if;

  return new;
end
$function$;

drop trigger if exists campaigns_validate_parent on public.campaigns;
create trigger campaigns_validate_parent
  before insert or update of parent_campaign_id, organization_id on public.campaigns
  for each row execute function public.campaigns_validate_parent();

-- La campaña y sus hijas. Es SECURITY DEFINER porque solo devuelve ids y la
-- seguridad por fila de campaigns no deja ver todas las campañas a un
-- supervisor: sin esto, su reporte de la madre perdía las hijas en silencio.
create or replace function public.campaign_family_ids(p_campaign_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(array_agg(c.id), array[p_campaign_id])
  from public.campaigns c
  where c.id = p_campaign_id
     or (
       c.parent_campaign_id = p_campaign_id
       and (public.request_is_service_role() or public.can_access_org(c.organization_id))
     );
$function$;

revoke all on function public.campaign_family_ids(uuid) from public, anon;
grant execute on function public.campaign_family_ids(uuid) to authenticated, service_role;

-- Secretaria Virtual queda como una sola campaña con tres canales.
update public.campaigns
set report_channel = 'voz_saliente'
where id = '111cb0ed-6e72-4c68-a83f-236d3c86b60b';

update public.campaigns
set parent_campaign_id = '111cb0ed-6e72-4c68-a83f-236d3c86b60b',
    report_channel = 'voz_entrante'
where id = '08e74270-89ca-4aea-9fd4-860b23bca07a';

update public.campaigns
set parent_campaign_id = '111cb0ed-6e72-4c68-a83f-236d3c86b60b',
    report_channel = 'whatsapp'
where id = 'f59045b2-cb77-49dd-ae4a-a105cdd55121';

-- Los reportes que reciben una campaña pasan a sumar también sus hijas.
--
-- Se reescriben sobre la definición vigente en vez de copiarlas enteras:
-- son funciones de cientos de líneas y transcribirlas a mano es la forma de
-- perder un arreglo anterior. Cada reemplazo se verifica; si el texto no está,
-- la migración falla en vez de quedar a medias.
--
-- `= any((select ...)::uuid[])` deja la lista como InitPlan: se calcula una vez y no
-- por cada fila de leads.
do $migration$
declare
  definition text;
  rewritten text;
  family constant text := 'any((select public.campaign_family_ids(p_campaign_id))::uuid[])';
begin
  -- Resumen del admin.
  definition := pg_get_functiondef(
    'public.get_crm_dashboard_summary(timestamptz, timestamptz, timestamptz, timestamptz, uuid)'::regprocedure
  );
  rewritten := replace(
    definition,
    'join params p on p.campaign_id is null or c.id = p.campaign_id',
    'join params p on p.campaign_id is null or c.id = p.campaign_id or c.parent_campaign_id = p.campaign_id'
  );
  if rewritten = definition then
    raise exception 'get_crm_dashboard_summary: no se encontró el filtro de campaña';
  end if;
  execute rewritten;

  -- Contactabilidad por hora.
  definition := pg_get_functiondef(
    'public.get_contactability_by_hour(timestamptz, timestamptz, uuid)'::regprocedure
  );
  rewritten := replace(definition, 'l.campaign_id = p_campaign_id', 'l.campaign_id = ' || family);
  if rewritten = definition then
    raise exception 'get_contactability_by_hour: no se encontró el filtro de campaña';
  end if;
  execute rewritten;

  -- Desglose por tipificación (admin y supervisor).
  definition := pg_get_functiondef(
    'public.get_campaign_tipification_breakdown(timestamptz, timestamptz, uuid)'::regprocedure
  );
  rewritten := replace(definition, 'l.campaign_id = p_campaign_id', 'l.campaign_id = ' || family);
  if rewritten = definition then
    raise exception 'get_campaign_tipification_breakdown: no se encontró el filtro de campaña';
  end if;
  execute rewritten;

  -- Reporte del supervisor: leads y ejecutivos asignados a la campaña.
  definition := pg_get_functiondef(
    'public.get_supervisor_report_summary(timestamptz, timestamptz, uuid, uuid)'::regprocedure
  );
  rewritten := replace(definition, 'l.campaign_id = p_campaign_id', 'l.campaign_id = ' || family);
  rewritten := replace(rewritten, 'ca.campaign_id = p_campaign_id', 'ca.campaign_id = ' || family);
  if rewritten = definition or position('ca.campaign_id = p_campaign_id' in rewritten) > 0 then
    raise exception 'get_supervisor_report_summary: no se encontró el filtro de campaña';
  end if;
  execute rewritten;
end
$migration$;

-- Registros: el filtro de campaña también suma las hijas. Sin esto, la base
-- de Reportes (8.256) y la lista que abre (8.180) no cuadraban.
do $migration$
declare
  definition text;
  rewritten text;
begin
  definition := pg_get_functiondef('public.get_lead_view_counts(uuid, uuid, text, uuid[])'::regprocedure);
  rewritten := replace(
    definition,
    'l.campaign_id = p_campaign)',
    'l.campaign_id = any((select public.campaign_family_ids(p_campaign))::uuid[]))'
  );
  if rewritten = definition then
    raise exception 'get_lead_view_counts: no se encontró el filtro de campaña';
  end if;
  execute rewritten;
end
$migration$;

-- Campañas del selector de Reportes: una por iniciativa. Una hija en el
-- alcance trae a su madre, y la madre la representa. `has_channels` avisa que
-- la campaña tiene hijas y vale la pena pedir el desglose por canal.
--
-- Es una función aparte a propósito: `get_report_scope_campaigns` también
-- decide permisos (discador, caller ID, ficha de campaña, calidad) y tiene que
-- seguir listando cada campaña, hijas incluidas.
create or replace function public.get_report_scope_campaign_groups()
returns table(id uuid, name text, has_channels boolean)
language sql
stable
set search_path to 'public'
as $function$
  with top_level as (
    select distinct coalesce(c.parent_campaign_id, c.id) as id
    from public.get_report_scope_campaigns() scope
    join public.campaigns c on c.id = scope.id
  )
  select
    t.id,
    coalesce(parent.name, child.name) as name,
    exists (select 1 from public.campaigns kid where kid.parent_campaign_id = t.id) as has_channels
  from top_level t
  left join public.campaigns parent on parent.id = t.id
  -- Si la madre no es visible por la seguridad por fila, se nombra con la
  -- primera hija del alcance para no mostrar una opción vacía.
  left join lateral (
    select c.name from public.campaigns c where c.parent_campaign_id = t.id order by c.name limit 1
  ) child on parent.id is null
  order by 2;
$function$;

revoke all on function public.get_report_scope_campaign_groups() from public, anon;
grant execute on function public.get_report_scope_campaign_groups() to authenticated;

-- Resultado por canal de una campaña y sus hijas.
--
-- Cada lead cuenta en el canal por el que entró: el de su campaña, o Correo si
-- llegó por una campaña de Atlas Lead. Es atribución por canal de origen, como
-- la «Primary Campaign Source» de Salesforce: un lead tiene un solo canal, así
-- que la suma de las filas es el total y una venta nunca se cuenta dos veces,
-- aunque el cliente haya pasado por WhatsApp y después por una llamada.
--
-- Las etapas miran todo lo que pasó con el lead en el período, por cualquier
-- canal: gestionado (una gestión o un mensaje), contactado (conversación
-- efectiva o respuesta por WhatsApp), interesado (seguimiento, derivación o
-- agenda) y venta (venta en validación).
--
-- SECURITY DEFINER porque lee tablas de correo que no se exponen a la API; el
-- alcance se aplica a mano: admin o supervisor, empresa visible y, para el
-- supervisor, solo los registros de sus equipos.
create or replace function public.get_campaign_channel_leads(
  p_from timestamptz,
  p_to timestamptz,
  p_campaign_id uuid
)
returns table(
  lead_id uuid,
  channel text,
  managed boolean,
  contacted boolean,
  interested boolean,
  sale boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  v_role text := coalesce((select public.current_role_name())::text, '');
  v_family uuid[] := public.campaign_family_ids(p_campaign_id);
  v_team_ids uuid[];
begin
  if not public.request_is_service_role() and v_role not in ('admin', 'supervisor') then
    raise exception 'No tienes permisos para ver este reporte.';
  end if;
  -- El supervisor ve los registros de sus equipos, igual que en su resumen.
  if v_role = 'supervisor' then
    v_team_ids := coalesce(public.supervised_team_ids(), '{}'::uuid[]);
  end if;

  return query
  with
  family as (
    select c.id, coalesce(c.report_channel, 'voz_saliente') as report_channel
    from public.campaigns c
    where c.id = any(v_family)
      and public.can_access_org(c.organization_id)
  ),
  family_leads as (
    select
      lead.id,
      case
        when family.report_channel = 'voz_saliente' and (
          lower(btrim(coalesce(lead.extra->>'source', lead.extra->>'external_source', ''))) = 'atlas_lead'
          or lower(btrim(coalesce(lead.external_last_source_code, ''))) = 'atlas_lead'
          or exists (
            select 1
            from public.lead_external_refs reference
            join public.integration_sources source on source.id = reference.source_id
            where reference.lead_id = lead.id
              and source.code = 'atlas_lead'
          )
          or exists (select 1 from public.mail_campaign_lead_status mail_status where mail_status.lead_id = lead.id)
          or exists (select 1 from public.lead_mail_messages mail_message where mail_message.lead_id = lead.id)
        ) then 'correo'
        else family.report_channel
      end as channel
    from public.leads lead
    join family on family.id = lead.campaign_id
    where v_team_ids is null or lead.team_id = any(v_team_ids)
  ),
  lead_calls as (
    select
      call.lead_id,
      bool_or(call.status = 'connected') as contacted,
      bool_or(
        call.outcome in ('interested', 'callback', 'sale')
        or call.reason in (
          'SE ENVIA INFORMACION',
          'VOLVER A LLAMAR',
          'CONTACTO CON TERCERO',
          'REUNION AGENDADA',
          'COTIZACION ENVIADA',
          'VENTA EN VALIDACION'
        )
      ) as interested,
      bool_or(call.outcome = 'sale' or call.reason = 'VENTA EN VALIDACION') as sale
    from public.calls call
    join family_leads lead on lead.id = call.lead_id
    where call.started_at >= p_from
      and call.started_at <= p_to
      and call.discarded_reason is null
    group by call.lead_id
  ),
  lead_whatsapp as (
    select
      conversation.lead_id,
      bool_or(message.direction = 'inbound') as replied
    from public.whatsapp_conversations conversation
    join family_leads lead on lead.id = conversation.lead_id
    join public.whatsapp_messages message on message.conversation_id = conversation.id
    where coalesce(message.provider_timestamp, message.created_at) >= p_from
      and coalesce(message.provider_timestamp, message.created_at) <= p_to
    group by conversation.lead_id
  ),
  whatsapp_qualified as (
    select distinct conversation.lead_id
    from public.whatsapp_conversations conversation
    join family_leads lead on lead.id = conversation.lead_id
    join public.whatsapp_conversation_events event on event.conversation_id = conversation.id
    where event.event_type in ('ai_handoff', 'callback_scheduled', 'appointment_scheduled')
      and event.created_at >= p_from
      and event.created_at <= p_to
    union
    select conversation.lead_id
    from public.whatsapp_conversations conversation
    join family_leads lead on lead.id = conversation.lead_id
    join public.whatsapp_closure_reasons reason on reason.id = conversation.close_reason_id
    where reason.code in ('qualified_followup', 'human_handoff')
      and conversation.closed_at >= p_from
      and conversation.closed_at <= p_to
  )
  select
    lead.id,
    case lead.channel
      when 'voz_entrante' then 'Llamada entrante'
      when 'whatsapp' then 'WhatsApp'
      when 'correo' then 'Correo'
      else 'Llamada saliente'
    end,
    calls.lead_id is not null or whatsapp.lead_id is not null,
    coalesce(calls.contacted, false) or coalesce(whatsapp.replied, false),
    coalesce(calls.interested, false) or qualified.lead_id is not null,
    coalesce(calls.sale, false)
  from family_leads lead
  left join lead_calls calls on calls.lead_id = lead.id
  left join lead_whatsapp whatsapp on whatsapp.lead_id = lead.id
  left join whatsapp_qualified qualified on qualified.lead_id = lead.id;
end
$function$;

revoke all on function public.get_campaign_channel_leads(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.get_campaign_channel_leads(timestamptz, timestamptz, uuid) to authenticated;

-- Una fila por canal. Aparecen los canales declarados en la campaña y sus
-- hijas, aunque estén en cero (un canal sin movimiento también es un dato), y
-- Correo solo si de verdad entraron registros por ahí.
create or replace function public.get_campaign_channel_funnel(
  p_from timestamptz,
  p_to timestamptz,
  p_campaign_id uuid
)
returns table(
  channel text,
  base integer,
  managed integer,
  contacted integer,
  interested integer,
  sales integer
)
language sql
stable
security invoker
set search_path to 'public'
as $function$
  with
  per_lead as (
    select * from public.get_campaign_channel_leads(p_from, p_to, p_campaign_id)
  ),
  channels(channel, sort_order, report_channel) as (
    values
      ('Llamada saliente'::text, 1, 'voz_saliente'::text),
      ('Llamada entrante'::text, 2, 'voz_entrante'::text),
      ('WhatsApp'::text, 3, 'whatsapp'::text),
      ('Correo'::text, 4, 'correo'::text)
  ),
  declared as (
    select distinct coalesce(c.report_channel, 'voz_saliente') as report_channel
    from public.campaigns c
    where c.id = any((select public.campaign_family_ids(p_campaign_id))::uuid[])
  )
  select
    ch.channel,
    count(lead.lead_id)::integer,
    count(*) filter (where lead.managed)::integer,
    count(*) filter (where lead.contacted)::integer,
    count(*) filter (where lead.interested)::integer,
    count(*) filter (where lead.sale)::integer
  from channels ch
  left join per_lead lead on lead.channel = ch.channel
  where exists (select 1 from declared d where d.report_channel = ch.report_channel)
     or exists (select 1 from per_lead p where p.channel = ch.channel)
  group by ch.channel, ch.sort_order
  order by ch.sort_order;
$function$;

revoke all on function public.get_campaign_channel_funnel(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.get_campaign_channel_funnel(timestamptz, timestamptz, uuid) to authenticated;

-- Ids de una celda: el número del reporte y la lista que abre en Registros
-- salen de la misma función, así que no pueden discrepar.
create or replace function public.get_campaign_channel_lead_ids(
  p_from timestamptz,
  p_to timestamptz,
  p_campaign_id uuid,
  p_channel text,
  p_stage text
)
returns uuid[]
language sql
stable
security invoker
set search_path to 'public'
as $function$
  select coalesce(array_agg(lead.lead_id), '{}'::uuid[])
  from public.get_campaign_channel_leads(p_from, p_to, p_campaign_id) lead
  where (p_channel is null or lead.channel = p_channel)
    and case p_stage
      when 'gestionados' then lead.managed
      when 'contactados' then lead.contacted
      when 'interesados' then lead.interested
      when 'ventas' then lead.sale
      else true
    end;
$function$;

revoke all on function public.get_campaign_channel_lead_ids(timestamptz, timestamptz, uuid, text, text) from public, anon;
grant execute on function public.get_campaign_channel_lead_ids(timestamptz, timestamptz, uuid, text, text) to authenticated;
