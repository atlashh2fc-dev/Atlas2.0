-- Puesto omnicanal del ejecutivo: el correo y el WhatsApp se reparten por
-- cola, presencia y capacidad, como en los contact center grandes.
--
-- Voz no cambia. El discador sigue leyendo `agent_current_status`,
-- `dialer_agent_sessions` y `calls` exactamente como antes: nada de esto toca
-- esas columnas ni esas funciones. Lo digital se monta al lado:
--
--   * Presencia por canal digital (`agent_channel_presence`): el ejecutivo
--     prende o apaga correo y WhatsApp sin tocar su estado de voz. Sin fila,
--     el canal está prendido: nadie deja de recibir por esta migración.
--   * Una pausa de voz puede dejar abiertos canales digitales
--     (`agent_status_reasons.canales_digitales`): «Correo / cotizaciones» saca
--     de voz pero deja recibir correo. Eso es el blending: la llamada
--     interrumpe, el correo espera.
--   * El correo entrante entra a la cola de su campaña: si no tiene dueño se
--     reparte al miembro disponible con menos carga, y si el dueño no está y
--     vence el nivel de servicio pasa a otro.
--   * El correo se cierra con tipificación: la gestión sin llamada por correo
--     cierra los correos pendientes del registro.
--   * Un tablero por cola para supervisión.

-- 1. Presencia por canal ------------------------------------------------------

create table if not exists public.agent_channel_presence (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  canal text not null check (canal in ('correo', 'whatsapp')),
  activo boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (profile_id, canal)
);

comment on table public.agent_channel_presence is
  'Canales digitales que el ejecutivo tiene prendidos. Sin fila = prendido. Voz no vive acá: sigue en agent_current_status.';

alter table public.agent_channel_presence enable row level security;

drop policy if exists agent_channel_presence_select_own on public.agent_channel_presence;
create policy agent_channel_presence_select_own on public.agent_channel_presence
  for select to authenticated
  using (profile_id = (select auth.uid()));

revoke all on public.agent_channel_presence from anon;
grant select on public.agent_channel_presence to authenticated;

alter table public.agent_status_reasons
  add column if not exists canales_digitales text[] not null default '{}';

comment on column public.agent_status_reasons.canales_digitales is
  'Canales digitales que siguen abiertos durante esta pausa de voz (correo, whatsapp). Una pausa como «Correo / cotizaciones» saca de la cola de voz pero deja recibir correo.';

update public.agent_status_reasons
   set canales_digitales = array['correo', 'whatsapp']
 where code in ('llamada_manual', 'andes_llamada', 'andes_gestion')
   and canales_digitales = '{}';
update public.agent_status_reasons
   set canales_digitales = array['correo']
 where code in ('correo_cotizaciones', 'trabajo_administrativo')
   and canales_digitales = '{}';

-- ¿Puede recibir trabajo nuevo de este canal? Conectado (latido reciente y no
-- desconectado), con el canal prendido, y disponible o en una pausa que deja
-- abierto ese canal. Estar en llamada no lo impide: el correo espera.
create or replace function public.agente_disponible_para(p_profile uuid, p_canal text)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select exists (
    select 1
    from public.profiles profile
    join public.agent_current_status estado on estado.profile_id = profile.id
    join public.agent_status_reasons motivo on motivo.id = estado.reason_id
    where profile.id = p_profile
      and profile.active
      and profile.role = 'agente'::public.app_role
      and estado.last_heartbeat_at >= now() - interval '3 minutes'
      and motivo.code not like '%desconectado'
      and (not motivo.is_pause or p_canal = any (motivo.canales_digitales))
  )
  and coalesce(
    (select presencia.activo from public.agent_channel_presence presencia
      where presencia.profile_id = p_profile and presencia.canal = p_canal),
    true
  );
$$;

revoke all on function public.agente_disponible_para(uuid, text) from public, anon, authenticated;
grant execute on function public.agente_disponible_para(uuid, text) to service_role;

-- 2. El correo entra a una cola ----------------------------------------------

alter table public.contact_center_queues
  add column if not exists max_correos_por_agente integer not null default 10,
  add column if not exists sla_correo_segundos integer not null default 14400;

alter table public.contact_center_queues drop constraint if exists contact_center_queues_max_correos_check;
alter table public.contact_center_queues add constraint contact_center_queues_max_correos_check
  check (max_correos_por_agente between 1 and 500);
alter table public.contact_center_queues drop constraint if exists contact_center_queues_sla_correo_check;
alter table public.contact_center_queues add constraint contact_center_queues_sla_correo_check
  check (sla_correo_segundos between 300 and 604800);

comment on column public.contact_center_queues.max_correos_por_agente is
  'Conversaciones de correo pendientes que puede tener un ejecutivo antes de dejar de recibir. Se cuenta por cliente, no por mensaje.';
comment on column public.contact_center_queues.sla_correo_segundos is
  'Tiempo de primera respuesta al correo. Si vence y el dueño no está disponible, el correo pasa a otro miembro.';

alter table public.inbound_emails
  add column if not exists queue_id uuid references public.contact_center_queues(id) on delete set null,
  add column if not exists primera_respuesta_at timestamptz,
  add column if not exists cerrado_at timestamptz,
  add column if not exists gestion_call_id uuid references public.calls(id) on delete set null,
  add column if not exists reasignaciones integer not null default 0;

create index if not exists inbound_emails_queue_idx
  on public.inbound_emails (queue_id, status, received_at desc) where queue_id is not null;

alter table public.inbound_emails drop constraint if exists inbound_emails_asignacion_check;
alter table public.inbound_emails add constraint inbound_emails_asignacion_check
  check (asignacion is null or asignacion in ('agenda', 'cotizacion', 'propietario', 'supervision', 'cola', 'reasignado'));

-- Primera respuesta: la marca el primer correo enviado desde el registro.
update public.inbound_emails correo
   set primera_respuesta_at = respuesta.enviado
  from (
    select respuesta_a, min(coalesce(enviado_at, created_at)) as enviado
    from public.correos_de_registro
    where estado = 'enviado' and respuesta_a is not null
    group by respuesta_a
  ) respuesta
 where respuesta.respuesta_a = correo.id and correo.primera_respuesta_at is null;

update public.inbound_emails
   set cerrado_at = coalesce(converted_at, updated_at)
 where status = 'converted' and cerrado_at is null;

create or replace function public.marcar_primera_respuesta_de_correo()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  if new.estado = 'enviado' and new.lead_id is not null then
    update public.inbound_emails
       set primera_respuesta_at = coalesce(new.enviado_at, now())
     where lead_id = new.lead_id
       and primera_respuesta_at is null
       and received_at <= coalesce(new.enviado_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists correos_de_registro_primera_respuesta on public.correos_de_registro;
create trigger correos_de_registro_primera_respuesta
  after insert or update of estado on public.correos_de_registro
  for each row execute function public.marcar_primera_respuesta_de_correo();

create or replace function public.sellar_cierre_de_correo()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $$
begin
  if new.status = 'converted' and old.status is distinct from 'converted' then
    new.cerrado_at := coalesce(new.cerrado_at, now());
  elsif new.status = 'new' and old.status = 'converted' then
    new.cerrado_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists inbound_emails_sella_cierre on public.inbound_emails;
create trigger inbound_emails_sella_cierre
  before update of status on public.inbound_emails
  for each row execute function public.sellar_cierre_de_correo();

-- El miembro de la cola que recibe el próximo correo: disponible para correo,
-- bajo su tope, con menos clientes pendientes y, a igualdad, el que lleva más
-- tiempo sin recibir.
create or replace function public.elegir_agente_de_correo(p_queue uuid, p_excluir uuid default null)
returns uuid
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  with carga as (
    select
      miembro.profile_id,
      miembro.joined_at,
      (select count(distinct correo.lead_id) from public.inbound_emails correo
        where correo.assigned_to = miembro.profile_id and correo.status = 'new') as pendientes,
      (select max(correo.asignado_at) from public.inbound_emails correo
        where correo.assigned_to = miembro.profile_id) as ultimo
    from public.contact_center_queue_members miembro
    where miembro.queue_id = p_queue
      and miembro.is_active
      and miembro.profile_id is distinct from p_excluir
      and public.agente_disponible_para(miembro.profile_id, 'correo')
  )
  select carga.profile_id
  from carga
  join public.contact_center_queues cola on cola.id = p_queue
  where carga.pendientes < cola.max_correos_por_agente
  order by carga.pendientes, carga.ultimo nulls first, carga.joined_at, carga.profile_id
  limit 1;
$$;

revoke all on function public.elegir_agente_de_correo(uuid, uuid) from public, anon, authenticated;
grant execute on function public.elegir_agente_de_correo(uuid, uuid) to service_role;

-- Reparte el correo pendiente. Corre después de cada sincronización del buzón
-- y cuando alguien prende su canal de correo:
--   * sin dueño → al miembro disponible de la cola de su campaña (o a quien ya
--     tiene otro correo pendiente del mismo cliente: el hilo no se parte);
--   * con dueño que no está y el nivel de servicio vencido → a otro miembro.
-- Una cola en modo manual solo etiqueta el correo: lo asigna supervisión.
create or replace function public.repartir_correos_pendientes()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_fila record;
  v_cola public.contact_center_queues%rowtype;
  v_agente uuid;
  v_asignados integer := 0;
  v_reasignados integer := 0;
begin
  for v_fila in
    select correo.id, correo.lead_id, correo.assigned_to, correo.asignado_at, correo.received_at,
           correo.queue_id, registro.campaign_id
    from public.inbound_emails correo
    join public.leads registro on registro.id = correo.lead_id
    where correo.status = 'new'
      and correo.received_at >= now() - interval '14 days'
    order by correo.received_at
    for update of correo skip locked
  loop
    v_agente := null;
    select cola.* into v_cola
    from public.contact_center_queues cola
    join public.contact_center_queue_sources fuente on fuente.queue_id = cola.id
    where fuente.channel_type = 'email'
      and fuente.campaign_id = v_fila.campaign_id
      and fuente.is_active
      and cola.is_active
    order by fuente.created_at
    limit 1;

    if v_cola.id is null then
      continue;
    end if;
    if v_fila.queue_id is distinct from v_cola.id then
      update public.inbound_emails set queue_id = v_cola.id where id = v_fila.id;
    end if;
    if v_cola.routing_mode = 'manual' then
      continue;
    end if;

    if v_fila.assigned_to is null then
      select otro.assigned_to into v_agente
      from public.inbound_emails otro
      where otro.lead_id = v_fila.lead_id and otro.status = 'new' and otro.assigned_to is not null
      limit 1;
      if v_agente is null then
        v_agente := public.elegir_agente_de_correo(v_cola.id, null);
      end if;
      if v_agente is not null then
        update public.inbound_emails
           set assigned_to = v_agente, asignacion = 'cola', asignado_at = now(), updated_at = now()
         where id = v_fila.id;
        v_asignados := v_asignados + 1;
      end if;
    elsif now() - coalesce(v_fila.asignado_at, v_fila.received_at) > make_interval(secs => v_cola.sla_correo_segundos)
      and not public.agente_disponible_para(v_fila.assigned_to, 'correo')
      and not exists (
        select 1 from public.inbound_emails respondido
        where respondido.id = v_fila.id and respondido.primera_respuesta_at is not null
      )
    then
      v_agente := public.elegir_agente_de_correo(v_cola.id, v_fila.assigned_to);
      if v_agente is not null then
        -- Todo lo pendiente de ese cliente con el mismo dueño se mueve junto.
        update public.inbound_emails
           set assigned_to = v_agente, asignacion = 'reasignado', asignado_at = now(),
               reasignaciones = reasignaciones + 1, updated_at = now()
         where lead_id = v_fila.lead_id and status = 'new' and assigned_to = v_fila.assigned_to;
        v_reasignados := v_reasignados + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object('asignados', v_asignados, 'reasignados', v_reasignados);
end;
$$;

revoke all on function public.repartir_correos_pendientes() from public, anon, authenticated;
grant execute on function public.repartir_correos_pendientes() to service_role;

-- La cola que ya atiende una campaña también atiende su buzón.
insert into public.contact_center_queue_sources (queue_id, channel_type, campaign_id, is_active)
select distinct on (buzon.campaign_id) fuente.queue_id, 'email', buzon.campaign_id, true
from public.buzon_campanas buzon
join public.contact_center_queue_sources fuente on fuente.campaign_id = buzon.campaign_id and fuente.is_active
where not exists (
  select 1 from public.contact_center_queue_sources correo
  where correo.campaign_id = buzon.campaign_id and correo.channel_type = 'email'
)
order by buzon.campaign_id, fuente.created_at;

-- 3. El ejecutivo ve y tipifica lo que le llegó por correo -------------------

-- Registros con correo pendiente asignado a quien consulta. Se resuelve una vez
-- por consulta, como active_dial_attempt_lead_ids, para no romper los índices
-- de la política de leads.
create or replace function public.leads_de_mis_correos()
returns uuid[]
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select coalesce(array_agg(distinct correo.lead_id), '{}'::uuid[])
  from public.inbound_emails correo
  where correo.assigned_to = (select auth.uid())
    and correo.status = 'new'
    and correo.lead_id is not null;
$$;

revoke all on function public.leads_de_mis_correos() from public, anon;
grant execute on function public.leads_de_mis_correos() to authenticated, service_role;

alter policy leads_select on public.leads
using (
  case (select public.current_role_name())
    when 'admin'::public.app_role then true
    when 'agente'::public.app_role then (
      assigned_to = (select auth.uid())
      or managed_by = (select auth.uid())
      or id = any((select public.active_dial_attempt_lead_ids())::uuid[])
      or id = any((select public.leads_de_mis_correos())::uuid[])
    )
    when 'supervisor'::public.app_role then (
      team_id in (select unnest((select public.supervised_team_ids())))
    )
    else false
  end
);

-- La gestión sin llamada también la puede abrir quien tiene el correo
-- asignado (la cola o la cotización pueden haberlo llevado a otra persona).
create or replace function public.begin_agent_offline_management(p_lead_id uuid, p_channel text)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_actor public.profiles%rowtype;
  v_lead public.leads%rowtype;
  v_call_id uuid;
  v_now timestamptz := now();
begin
  if v_actor_id is null then
    raise exception 'No autenticado.';
  end if;
  if p_channel is null or p_channel not in ('whatsapp', 'correo', 'presencial', 'otro') then
    raise exception 'Elige por qué canal fue el contacto.';
  end if;

  select * into v_actor
  from public.profiles
  where id = v_actor_id and role = 'agente' and active
  for update;
  if not found then
    raise exception 'Solo un ejecutivo activo puede registrar una gestión.';
  end if;

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'El registro no existe.';
  end if;
  perform public.assert_org_access(v_lead.organization_id);

  if v_actor_id is distinct from v_lead.managed_by
     and v_actor_id is distinct from v_lead.assigned_to
     and not exists (
       select 1 from public.inbound_emails correo
       where correo.lead_id = p_lead_id and correo.assigned_to = v_actor_id and correo.status = 'new'
     ) then
    raise exception 'Este registro no está a tu nombre. Pide a tu supervisor que te lo asigne.';
  end if;

  if exists (
    select 1 from public.calls c
    where c.agent_id = v_actor_id
      and c.ended_at is null
      and c.started_at >= v_now - interval '4 hours'
  ) then
    raise exception 'Tienes una gestión pendiente de tipificación. Ciérrala antes de registrar otra.';
  end if;

  if exists (
    select 1 from public.calls c
    where c.lead_id = p_lead_id and c.ended_at is null and c.started_at >= v_now - interval '4 hours'
  ) then
    raise exception 'Este registro ya tiene una gestión abierta.';
  end if;

  insert into public.calls (lead_id, agent_id, management_channel)
  values (p_lead_id, v_actor_id, p_channel)
  returning id into v_call_id;

  update public.leads
  set managed_by = coalesce(managed_by, v_actor_id), updated_at = v_now
  where id = p_lead_id;

  insert into public.call_events (call_id, lead_id, agent_id, event_type, payload)
  values (
    v_call_id, p_lead_id, v_actor_id, 'cti.offline_management_started',
    jsonb_build_object('channel', p_channel, 'campaign_id', v_lead.campaign_id)
  );

  insert into public.crm_audit_events (lead_id, crm_entity_id, actor_id, event_type, payload)
  values (
    p_lead_id, v_lead.crm_entity_id, v_actor_id, 'lead.offline_management_started',
    jsonb_build_object('call_id', v_call_id, 'channel', p_channel)
  );

  return jsonb_build_object('call_id', v_call_id, 'lead_id', p_lead_id, 'channel', p_channel);
end;
$function$;

revoke all on function public.begin_agent_offline_management(uuid, text) from public, anon;
grant execute on function public.begin_agent_offline_management(uuid, text) to authenticated;

-- Tipificar la gestión por correo cierra los correos pendientes del cliente
-- que eran de ese ejecutivo (o de nadie) y deja el rastro de qué gestión los
-- cerró. Solo se dispara al cerrar una gestión de correo: el discador no pasa
-- por acá.
create or replace function public.cerrar_correos_con_la_gestion()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  update public.inbound_emails
     set status = 'converted',
         converted_at = coalesce(converted_at, new.ended_at),
         converted_by = coalesce(converted_by, new.agent_id),
         gestion_call_id = new.id,
         updated_at = now()
   where lead_id = new.lead_id
     and status = 'new'
     and (assigned_to = new.agent_id or assigned_to is null);
  return new;
end;
$$;

drop trigger if exists calls_cierra_correos on public.calls;
create trigger calls_cierra_correos
  after update of ended_at on public.calls
  for each row
  when (new.management_channel = 'correo' and old.ended_at is null and new.ended_at is not null and new.discarded_reason is null)
  execute function public.cerrar_correos_con_la_gestion();

-- 4. Presencia del ejecutivo --------------------------------------------------

create or replace function public.mi_presencia_digital()
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  with yo as (select (select auth.uid()) as id),
  canales as (
    select
      exists (
        select 1 from public.contact_center_queue_members miembro
        join public.contact_center_queue_sources fuente on fuente.queue_id = miembro.queue_id and fuente.is_active
        where miembro.profile_id = (select id from yo) and miembro.is_active and fuente.channel_type = 'email'
      )
      or exists (
        select 1 from public.campaign_agents asignacion
        join public.campaign_channels canal on canal.campaign_id = asignacion.campaign_id
        where asignacion.profile_id = (select id from yo) and canal.channel = 'mail' and canal.enabled
      )
      or exists (
        select 1 from public.inbound_emails correo
        where correo.assigned_to = (select id from yo) and correo.status = 'new'
      ) as correo,
      exists (
        select 1 from public.contact_center_queue_members miembro
        join public.contact_center_queue_sources fuente on fuente.queue_id = miembro.queue_id and fuente.is_active
        where miembro.profile_id = (select id from yo) and miembro.is_active and fuente.channel_type = 'whatsapp'
      )
      or exists (
        select 1 from public.campaign_agents asignacion
        join public.campaign_channels canal on canal.campaign_id = asignacion.campaign_id
        where asignacion.profile_id = (select id from yo) and canal.channel = 'whatsapp' and canal.enabled
      ) as whatsapp
  )
  select jsonb_build_object(
    'tiene_correo', canales.correo,
    'tiene_whatsapp', canales.whatsapp,
    'correo', coalesce((select activo from public.agent_channel_presence where profile_id = (select id from yo) and canal = 'correo'), true),
    'whatsapp', coalesce((select activo from public.agent_channel_presence where profile_id = (select id from yo) and canal = 'whatsapp'), true),
    'recibe_correo', public.agente_disponible_para((select id from yo), 'correo'),
    'recibe_whatsapp', public.agente_disponible_para((select id from yo), 'whatsapp'),
    'pendientes_correo', (
      select count(distinct correo.lead_id) from public.inbound_emails correo
      where correo.assigned_to = (select id from yo) and correo.status = 'new'
    ),
    'pendientes_whatsapp', (
      select count(*) from public.whatsapp_conversations conversacion
      where conversacion.assigned_to = (select id from yo) and conversacion.status in ('open', 'pending')
        and conversacion.unread_count > 0
    )
  )
  from canales;
$$;

revoke all on function public.mi_presencia_digital() from public, anon;
grant execute on function public.mi_presencia_digital() to authenticated;

create or replace function public.cambiar_mi_presencia_digital(p_canal text, p_activo boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'No autenticado.';
  end if;
  if p_canal not in ('correo', 'whatsapp') then
    raise exception 'Canal desconocido.';
  end if;
  if not exists (
    select 1 from public.profiles where id = (select auth.uid()) and active and role = 'agente'::public.app_role
  ) then
    raise exception 'Solo un ejecutivo activo tiene presencia por canal.';
  end if;

  insert into public.agent_channel_presence (profile_id, canal, activo, updated_at)
  values ((select auth.uid()), p_canal, coalesce(p_activo, true), now())
  on conflict (profile_id, canal) do update set activo = excluded.activo, updated_at = excluded.updated_at;

  -- Al prenderse, lo que esperaba en la cola le llega sin esperar al próximo ciclo.
  if p_canal = 'correo' and p_activo then
    perform public.repartir_correos_pendientes();
  end if;

  return public.mi_presencia_digital();
end;
$$;

revoke all on function public.cambiar_mi_presencia_digital(text, boolean) from public, anon;
grant execute on function public.cambiar_mi_presencia_digital(text, boolean) to authenticated;

-- 5. WhatsApp prefiere a quien está presente ---------------------------------
-- Mismo reparto por menor carga y mismo tope que antes; solo se ordena primero
-- a quien está conectado y con WhatsApp prendido. Si nadie lo está, se asigna
-- igual que hoy: ninguna conversación queda sin dueño por este cambio.

create or replace function public.route_new_whatsapp_lead_to_queue()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_queue public.contact_center_queues%rowtype;
  v_agent_id uuid;
  v_team_id uuid;
begin
  if new.external_last_source_code is distinct from 'meta_whatsapp'
     or new.campaign_id is null then
    return new;
  end if;

  select queue.* into v_queue
  from public.contact_center_queues queue
  join public.contact_center_queue_sources source on source.queue_id = queue.id
  where source.channel_type = 'whatsapp'
    and source.campaign_id = new.campaign_id
    and source.is_active
    and queue.is_active
  order by source.created_at
  limit 1;

  if v_queue.id is null then
    return new;
  end if;

  if v_queue.routing_mode = 'manual' then
    new.assigned_to := null;
    return new;
  end if;

  select member.profile_id, profile.team_id
  into v_agent_id, v_team_id
  from public.contact_center_queue_members member
  join public.profiles profile on profile.id = member.profile_id
  left join public.whatsapp_conversations active_conversation
    on active_conversation.queue_id = member.queue_id
   and active_conversation.assigned_to = member.profile_id
   and active_conversation.status in ('open', 'pending')
  where member.queue_id = v_queue.id
    and member.is_active
    and profile.active
    and profile.role = 'agente'::public.app_role
  group by member.profile_id, profile.team_id, member.joined_at,
    member.max_concurrent, v_queue.max_concurrent_per_agent
  having coalesce(member.max_concurrent, v_queue.max_concurrent_per_agent) is null
      or count(active_conversation.id) < coalesce(member.max_concurrent, v_queue.max_concurrent_per_agent)
  order by public.agente_disponible_para(member.profile_id, 'whatsapp') desc,
    count(active_conversation.id), member.joined_at, member.profile_id
  limit 1;

  new.assigned_to := v_agent_id;
  if v_team_id is not null then new.team_id := v_team_id; end if;
  return new;
end;
$function$;

create or replace function public.handoff_whatsapp_conversation(p_conversation_id uuid, p_reason text, p_kind text, p_source_message_id uuid, p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_conversation public.whatsapp_conversations%rowtype;
  v_queue public.contact_center_queues%rowtype;
  v_agent_id uuid;
  v_team_id uuid;
  v_agent_name text;
  v_old_assigned_to uuid;
  v_now timestamptz := now();
begin
  if p_kind not in ('human_requested', 'appointment', 'quote', 'unknown', 'complaint') then
    raise exception 'invalid_whatsapp_handoff_kind';
  end if;

  select * into v_conversation
  from public.whatsapp_conversations
  where id = p_conversation_id
  for update;

  if v_conversation.id is null then
    raise exception 'whatsapp_conversation_not_found';
  end if;
  if v_conversation.status = 'closed' then
    raise exception 'whatsapp_conversation_closed';
  end if;
  if v_conversation.queue_id is null then
    raise exception 'whatsapp_handoff_queue_missing';
  end if;

  select * into v_queue from public.contact_center_queues where id = v_conversation.queue_id;

  -- Preserve the current responsible agent when that person remains an active
  -- member of the queue. Only unassigned/ineligible work is routed by load.
  select member.profile_id, profile.team_id, profile.full_name
  into v_agent_id, v_team_id, v_agent_name
  from public.contact_center_queue_members member
  join public.profiles profile on profile.id = member.profile_id
  where member.queue_id = v_conversation.queue_id
    and member.profile_id = v_conversation.assigned_to
    and member.is_active
    and profile.active
    and profile.role = 'agente'::public.app_role
  limit 1;

  if v_agent_id is null then
    -- Primero quien está presente y bajo su tope; si nadie, el de menor carga
    -- como antes, para que el traspaso de la IA nunca quede sin humano.
    select member.profile_id, profile.team_id, profile.full_name
    into v_agent_id, v_team_id, v_agent_name
    from public.contact_center_queue_members member
    join public.profiles profile on profile.id = member.profile_id
    left join public.whatsapp_conversations active_conversation
      on active_conversation.queue_id = member.queue_id
     and active_conversation.assigned_to = member.profile_id
     and active_conversation.status in ('open', 'pending')
    where member.queue_id = v_conversation.queue_id
      and member.is_active
      and profile.active
      and profile.role = 'agente'::public.app_role
    group by member.profile_id, profile.team_id, profile.full_name, member.joined_at, member.max_concurrent
    order by
      (coalesce(member.max_concurrent, v_queue.max_concurrent_per_agent) is null
        or count(active_conversation.id) < coalesce(member.max_concurrent, v_queue.max_concurrent_per_agent)) desc,
      public.agente_disponible_para(member.profile_id, 'whatsapp') desc,
      count(active_conversation.id), member.joined_at, member.profile_id
    limit 1;
  end if;

  if v_agent_id is null then
    raise exception 'whatsapp_handoff_agent_unavailable';
  end if;

  v_old_assigned_to := v_conversation.assigned_to;

  update public.lead_assignments
  set is_active = false,
      ends_at = v_now,
      updated_at = v_now
  where lead_id = v_conversation.lead_id
    and is_active;

  insert into public.lead_assignments (
    lead_id, assigned_to, assigned_by, team_id, campaign_id,
    reason, source, is_active, starts_at
  ) values (
    v_conversation.lead_id,
    v_agent_id,
    null,
    v_team_id,
    v_conversation.campaign_id,
    nullif(btrim(p_reason), ''),
    'whatsapp.ai_handoff',
    true,
    v_now
  );

  update public.leads
  set assigned_to = v_agent_id,
      team_id = coalesce(v_team_id, team_id),
      assignment_status = 'assigned',
      updated_at = v_now
  where id = v_conversation.lead_id;

  update public.whatsapp_conversations
  set assigned_to = v_agent_id,
      ai_state = 'handoff',
      status = 'open',
      ai_last_error = null
  where id = p_conversation_id;

  insert into public.whatsapp_conversation_events (
    conversation_id, event_type, note, metadata
  ) values (
    p_conversation_id,
    'ai_handoff',
    nullif(btrim(p_reason), ''),
    jsonb_build_object(
      'kind', p_kind,
      'assigned_to', v_agent_id,
      'assigned_to_name', v_agent_name,
      'source_message_id', p_source_message_id,
      'run_id', p_run_id,
      'source', 'mercury'
    )
  );

  insert into public.crm_audit_events (
    lead_id, crm_entity_id, actor_id, event_type, payload
  )
  select
    lead.id,
    lead.crm_entity_id,
    null,
    'lead.assigned',
    jsonb_build_object(
      'old_assigned_to', v_old_assigned_to,
      'new_assigned_to', v_agent_id,
      'team_id', v_team_id,
      'campaign_id', v_conversation.campaign_id,
      'reason', nullif(btrim(p_reason), ''),
      'source', 'whatsapp.ai_handoff',
      'handoff_kind', p_kind,
      'conversation_id', p_conversation_id,
      'source_message_id', p_source_message_id,
      'run_id', p_run_id
    )
  from public.leads lead
  where lead.id = v_conversation.lead_id;

  return jsonb_build_object(
    'conversation_id', p_conversation_id,
    'lead_id', v_conversation.lead_id,
    'assigned_to', v_agent_id,
    'assigned_to_name', v_agent_name,
    'team_id', v_team_id,
    'handoff_kind', p_kind
  );
end;
$function$;

-- 6. Tablero por cola ----------------------------------------------------------

create or replace function public.tablero_de_colas()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_rol text := coalesce(public.current_role_name()::text, '');
  v_org uuid := public.current_org_id();
  v_inicio_dia timestamptz := date_trunc('day', now() at time zone 'America/Santiago') at time zone 'America/Santiago';
begin
  if (select auth.uid()) is null or v_rol not in ('admin', 'supervisor') then
    raise exception 'No tienes permiso para ver el tablero de colas.';
  end if;

  return coalesce((
    select jsonb_agg(fila.dato order by fila.nombre)
    from (
      select cola.name as nombre, jsonb_build_object(
        'id', cola.id,
        'nombre', cola.name,
        'modo', cola.routing_mode,
        'sla_whatsapp_segundos', cola.service_level_seconds,
        'sla_correo_segundos', cola.sla_correo_segundos,
        'max_correos', cola.max_correos_por_agente,
        'max_whatsapp', cola.max_concurrent_per_agent,
        'canales', (
          select coalesce(jsonb_agg(distinct fuente.channel_type), '[]'::jsonb)
          from public.contact_center_queue_sources fuente
          where fuente.queue_id = cola.id and fuente.is_active
        ),
        'correo', (
          select jsonb_build_object(
            'pendientes', count(distinct correo.lead_id) filter (where correo.status = 'new'),
            'sin_asignar', count(distinct correo.lead_id) filter (where correo.status = 'new' and correo.assigned_to is null),
            'vencidos', count(distinct correo.lead_id) filter (
              where correo.status = 'new' and correo.primera_respuesta_at is null
                and now() - correo.received_at > make_interval(secs => cola.sla_correo_segundos)
            ),
            'mas_antiguo', min(correo.received_at) filter (where correo.status = 'new' and correo.primera_respuesta_at is null),
            'atendidos_hoy', count(*) filter (where correo.cerrado_at >= v_inicio_dia),
            'mediana_respuesta_minutos', round((
              percentile_cont(0.5) within group (order by extract(epoch from (correo.primera_respuesta_at - correo.received_at)) / 60)
                filter (where correo.primera_respuesta_at >= now() - interval '7 days')
            )::numeric, 0)
          )
          from public.inbound_emails correo
          where correo.queue_id = cola.id and correo.received_at >= now() - interval '30 days'
        ),
        'whatsapp', (
          select jsonb_build_object(
            'abiertas', count(*),
            'sin_asignar', count(*) filter (where conversacion.assigned_to is null),
            'sin_responder', count(*) filter (
              where conversacion.last_inbound_at is not null
                and (conversacion.last_outbound_at is null or conversacion.last_outbound_at < conversacion.last_inbound_at)
            ),
            'vencidas', count(*) filter (
              where conversacion.last_inbound_at is not null
                and (conversacion.last_outbound_at is null or conversacion.last_outbound_at < conversacion.last_inbound_at)
                and now() - conversacion.last_inbound_at > make_interval(secs => cola.service_level_seconds)
            ),
            'mas_antigua', min(conversacion.last_inbound_at) filter (
              where conversacion.last_inbound_at is not null
                and (conversacion.last_outbound_at is null or conversacion.last_outbound_at < conversacion.last_inbound_at)
            )
          )
          from public.whatsapp_conversations conversacion
          where conversacion.queue_id = cola.id and conversacion.status in ('open', 'pending')
        ),
        'miembros', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', perfil.id,
            'nombre', perfil.full_name,
            'conectado', coalesce(estado.last_heartbeat_at >= now() - interval '3 minutes' and motivo.code not like '%desconectado', false),
            'estado', motivo.label,
            'en_pausa', coalesce(motivo.is_pause, false),
            'estado_desde', estado.since,
            'telefono', (
              select sesion.status from public.dialer_agent_sessions sesion
              where sesion.profile_id = perfil.id
              order by sesion.last_state_change_at desc nulls last
              limit 1
            ),
            'correo_prendido', coalesce(presencia_correo.activo, true),
            'whatsapp_prendido', coalesce(presencia_whatsapp.activo, true),
            'recibe_correo', public.agente_disponible_para(perfil.id, 'correo'),
            'recibe_whatsapp', public.agente_disponible_para(perfil.id, 'whatsapp'),
            'correos', (
              select count(distinct correo.lead_id) from public.inbound_emails correo
              where correo.assigned_to = perfil.id and correo.status = 'new'
            ),
            'whatsapp', (
              select count(*) from public.whatsapp_conversations conversacion
              where conversacion.assigned_to = perfil.id and conversacion.status in ('open', 'pending')
            )
          ) order by perfil.full_name), '[]'::jsonb)
          from public.contact_center_queue_members miembro
          join public.profiles perfil on perfil.id = miembro.profile_id and perfil.active
          left join public.agent_current_status estado on estado.profile_id = perfil.id
          left join public.agent_status_reasons motivo on motivo.id = estado.reason_id
          left join public.agent_channel_presence presencia_correo
            on presencia_correo.profile_id = perfil.id and presencia_correo.canal = 'correo'
          left join public.agent_channel_presence presencia_whatsapp
            on presencia_whatsapp.profile_id = perfil.id and presencia_whatsapp.canal = 'whatsapp'
          where miembro.queue_id = cola.id and miembro.is_active
        )
      ) as dato
      from public.contact_center_queues cola
      where cola.is_active
        and cola.organization_id = v_org
        and private.can_view_contact_center_queue(cola.id)
    ) fila
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.tablero_de_colas() from public, anon;
grant execute on function public.tablero_de_colas() to authenticated;
