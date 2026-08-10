-- Orquestador de leads: servicio independiente del motor telefonico.
-- Selecciona y reserva registros para ejecutivos disponibles, pero nunca
-- origina llamadas ni toca Asterisk.

create table public.lead_orchestrator_configs (
  campaign_id uuid primary key references public.campaigns(id) on delete cascade,
  is_active boolean not null default false,
  tick_seconds integer not null default 5 check (tick_seconds between 2 and 300),
  assignment_ttl_seconds integer not null default 300 check (assignment_ttl_seconds between 60 and 14400),
  max_dispatch_per_tick integer not null default 10 check (max_dispatch_per_tick between 1 and 100),
  fallback_order text not null default 'oldest_first' check (fallback_order in ('oldest_first', 'newest_first')),
  last_dispatch_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.lead_priority_rules (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  position integer not null check (position between 1 and 1000),
  name text not null,
  field_name text not null,
  operator text not null check (operator in ('eq', 'neq', 'contains', 'gte', 'lte', 'is_empty', 'is_not_empty')),
  comparison_value text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, position)
);

create table public.lead_orchestrator_assignments (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  agent_id uuid not null references public.profiles(id) on delete cascade,
  priority_rule_id uuid references public.lead_priority_rules(id) on delete set null,
  priority_reason text not null,
  status text not null default 'delivered' check (status in ('delivered', 'opened', 'completed', 'expired', 'cancelled')),
  claimed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  opened_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index lead_orchestrator_one_active_lead_idx
  on public.lead_orchestrator_assignments (lead_id)
  where status in ('delivered', 'opened');
create unique index lead_orchestrator_one_active_agent_idx
  on public.lead_orchestrator_assignments (agent_id)
  where status in ('delivered', 'opened');
create index lead_orchestrator_assignments_campaign_status_idx
  on public.lead_orchestrator_assignments (campaign_id, status, expires_at);
create index lead_priority_rules_campaign_position_idx
  on public.lead_priority_rules (campaign_id, position) where is_active;

alter table public.lead_orchestrator_configs enable row level security;
alter table public.lead_priority_rules enable row level security;
alter table public.lead_orchestrator_assignments enable row level security;

create policy lead_orchestrator_configs_select on public.lead_orchestrator_configs
  for select to authenticated using (true);
create policy lead_orchestrator_configs_admin_write on public.lead_orchestrator_configs
  for all to authenticated using (public.current_role_name() = 'admin')
  with check (public.current_role_name() = 'admin');

create policy lead_priority_rules_select on public.lead_priority_rules
  for select to authenticated using (true);
create policy lead_priority_rules_admin_write on public.lead_priority_rules
  for all to authenticated using (public.current_role_name() = 'admin')
  with check (public.current_role_name() = 'admin');

create policy lead_orchestrator_assignments_select on public.lead_orchestrator_assignments
  for select to authenticated using (
    agent_id = (select auth.uid()) or public.current_role_name() in ('admin', 'supervisor')
  );

create trigger lead_orchestrator_configs_set_updated_at
  before update on public.lead_orchestrator_configs
  for each row execute function public.set_updated_at();
create trigger lead_priority_rules_set_updated_at
  before update on public.lead_priority_rules
  for each row execute function public.set_updated_at();
create trigger lead_orchestrator_assignments_set_updated_at
  before update on public.lead_orchestrator_assignments
  for each row execute function public.set_updated_at();

create or replace function public.get_active_lead_orchestrator_configs()
returns table (
  campaign_id uuid,
  tick_seconds integer,
  assignment_ttl_seconds integer,
  max_dispatch_per_tick integer
)
language sql
security definer
set search_path = public
as $function$
  select c.campaign_id, c.tick_seconds, c.assignment_ttl_seconds, c.max_dispatch_per_tick
  from public.lead_orchestrator_configs c
  join public.campaigns campaign on campaign.id = c.campaign_id
  where c.is_active and campaign.is_active;
$function$;

revoke all on function public.get_active_lead_orchestrator_configs() from public, anon, authenticated;
grant execute on function public.get_active_lead_orchestrator_configs() to service_role;

create or replace function public.expire_lead_orchestrator_assignments(p_campaign_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_count integer;
begin
  with expired as (
    update public.lead_orchestrator_assignments assignment
    set status = 'expired', updated_at = now()
    where assignment.campaign_id = p_campaign_id
      and assignment.status = 'delivered'
      and assignment.expires_at <= now()
    returning assignment.lead_id, assignment.agent_id
  ), released as (
    update public.leads lead
    set assigned_to = null,
        assignment_status = 'pending'
    from expired
    where lead.id = expired.lead_id
      and lead.assigned_to = expired.agent_id
      and lead.managed_at is null
    returning lead.id
  )
  select count(*)::integer into v_count from expired;
  return coalesce(v_count, 0);
end;
$function$;

revoke all on function public.expire_lead_orchestrator_assignments(uuid) from public, anon, authenticated;
grant execute on function public.expire_lead_orchestrator_assignments(uuid) to service_role;

create or replace function public.claim_next_lead_assignments(
  p_campaign_id uuid,
  p_batch_size integer default 10
)
returns table (
  assignment_id uuid,
  lead_id uuid,
  agent_id uuid,
  priority_reason text
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_config public.lead_orchestrator_configs;
  v_agent record;
  v_candidate record;
  v_assignment_id uuid;
  v_claimed integer := 0;
begin
  select * into v_config
  from public.lead_orchestrator_configs
  where campaign_id = p_campaign_id and is_active
  for update;

  if not found then return; end if;

  perform public.expire_lead_orchestrator_assignments(p_campaign_id);

  for v_agent in
    select membership.profile_id as agent_id
    from public.campaign_agents membership
    join public.profiles profile
      on profile.id = membership.profile_id
     and profile.active
     and profile.role = 'agente'
    join public.agent_current_status current_status
      on current_status.profile_id = profile.id
     and current_status.last_heartbeat_at >= now() - interval '90 seconds'
    join public.agent_status_reasons reason
      on reason.id = current_status.reason_id
     and reason.is_pause = false
    where membership.campaign_id = p_campaign_id
      and not exists (
        select 1 from public.lead_orchestrator_assignments active_assignment
        where active_assignment.agent_id = profile.id
          and active_assignment.status in ('delivered', 'opened')
      )
      and not exists (
        select 1 from public.calls open_call
        where open_call.agent_id = profile.id and open_call.ended_at is null
      )
    order by (
      select max(previous.claimed_at)
      from public.lead_orchestrator_assignments previous
      where previous.agent_id = profile.id
    ) asc nulls first, profile.id
  loop
    exit when v_claimed >= least(greatest(coalesce(p_batch_size, 1), 1), v_config.max_dispatch_per_tick);

    select
      lead.id,
      matched.rule_id,
      coalesce(matched.rule_name, 'Fallback · orden de ingreso') as reason
    into v_candidate
    from public.leads lead
    left join lateral (
      select rule.id as rule_id, rule.name as rule_name, rule.position
      from public.lead_priority_rules rule
      cross join lateral (
        select case rule.field_name
          when 'status' then lead.status
          when 'rut' then lead.rut
          when 'phone' then lead.phone
          when 'email' then lead.email
          when 'full_name' then lead.full_name
          when 'external_priority_rank' then lead.external_priority_rank::text
          else lead.extra ->> rule.field_name
        end as field_value
      ) value_source
      where rule.campaign_id = p_campaign_id
        and rule.is_active
        and case rule.operator
          when 'eq' then lower(coalesce(value_source.field_value, '')) = lower(coalesce(rule.comparison_value, ''))
          when 'neq' then lower(coalesce(value_source.field_value, '')) <> lower(coalesce(rule.comparison_value, ''))
          when 'contains' then lower(coalesce(value_source.field_value, '')) like '%' || lower(coalesce(rule.comparison_value, '')) || '%'
          when 'is_empty' then nullif(btrim(coalesce(value_source.field_value, '')), '') is null
          when 'is_not_empty' then nullif(btrim(coalesce(value_source.field_value, '')), '') is not null
          when 'gte' then value_source.field_value ~ '^-?[0-9]+([.,][0-9]+)?$'
            and replace(value_source.field_value, ',', '.')::numeric >= replace(coalesce(rule.comparison_value, '0'), ',', '.')::numeric
          when 'lte' then value_source.field_value ~ '^-?[0-9]+([.,][0-9]+)?$'
            and replace(value_source.field_value, ',', '.')::numeric <= replace(coalesce(rule.comparison_value, '0'), ',', '.')::numeric
          else false
        end
      order by rule.position
      limit 1
    ) matched on true
    where lead.campaign_id = p_campaign_id
      and lead.phone is not null and btrim(lead.phone) <> ''
      and lead.managed_at is null
      and coalesce(lead.assignment_status, 'pending') not in ('managed', 'exception')
      and coalesce(lead.workflow_status, 'pending') not in ('managed', 'exception', 'callback')
      and lead.next_action_at is null
      and not exists (
        select 1 from public.lead_orchestrator_assignments active_assignment
        where active_assignment.lead_id = lead.id
          and active_assignment.status in ('delivered', 'opened')
      )
      and not exists (
        select 1 from public.calls open_call
        where open_call.lead_id = lead.id and open_call.ended_at is null
      )
    order by
      matched.position asc nulls last,
      lead.external_priority_rank asc nulls last,
      case when v_config.fallback_order = 'oldest_first' then lead.created_at end asc,
      case when v_config.fallback_order = 'newest_first' then lead.created_at end desc,
      lead.id
    limit 1
    for update of lead skip locked;

    if not found then exit; end if;

    insert into public.lead_orchestrator_assignments (
      campaign_id, lead_id, agent_id, priority_rule_id, priority_reason, expires_at
    ) values (
      p_campaign_id, v_candidate.id, v_agent.agent_id, v_candidate.rule_id,
      v_candidate.reason, now() + make_interval(secs => v_config.assignment_ttl_seconds)
    ) returning id into v_assignment_id;

    update public.leads
    set assigned_to = v_agent.agent_id,
        assignment_status = 'assigned'
    where id = v_candidate.id;

    insert into public.call_events (call_id, lead_id, agent_id, event_type, payload)
    values (
      null,
      v_candidate.id,
      v_agent.agent_id,
      'lead_orchestrator.assigned',
      jsonb_build_object(
        'assignment_id', v_assignment_id,
        'campaign_id', p_campaign_id,
        'priority_reason', v_candidate.reason,
        'source', 'lead_orchestrator'
      )
    );

    v_claimed := v_claimed + 1;
    assignment_id := v_assignment_id;
    lead_id := v_candidate.id;
    agent_id := v_agent.agent_id;
    priority_reason := v_candidate.reason;
    return next;
  end loop;

  update public.lead_orchestrator_configs
  set last_dispatch_at = now(), updated_at = now()
  where campaign_id = p_campaign_id;
end;
$function$;

revoke all on function public.claim_next_lead_assignments(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_next_lead_assignments(uuid, integer) to service_role;

create or replace function public.open_my_lead_orchestrator_assignment(p_lead_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  update public.lead_orchestrator_assignments
  set status = 'opened', opened_at = coalesce(opened_at, now()), updated_at = now()
  where lead_id = p_lead_id
    and agent_id = auth.uid()
    and status = 'delivered';
end;
$function$;

revoke all on function public.open_my_lead_orchestrator_assignment(uuid) from public, anon;
grant execute on function public.open_my_lead_orchestrator_assignment(uuid) to authenticated;

-- Acción acotada a la campaña Kovacs para recorrer la demostración sin
-- inventar una llamada telefónica. Cierra la entrega visible y deja al motor
-- libre para mostrar inmediatamente el siguiente lead priorizado.
create or replace function public.complete_my_kovacs_demo_assignment(p_lead_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_assignment public.lead_orchestrator_assignments;
begin
  select assignment.* into v_assignment
  from public.lead_orchestrator_assignments assignment
  join public.campaigns campaign on campaign.id = assignment.campaign_id
  where assignment.lead_id = p_lead_id
    and assignment.agent_id = auth.uid()
    and assignment.status in ('delivered', 'opened')
    and lower(regexp_replace(btrim(campaign.name), '\s+', ' ', 'g')) = 'kovacs'
  for update;

  if not found then
    raise exception 'No existe una asignación demo activa para este lead.';
  end if;

  update public.lead_orchestrator_assignments
  set status = 'completed', completed_at = now(), updated_at = now()
  where id = v_assignment.id;

  update public.leads
  set managed_by = auth.uid(),
      managed_at = now(),
      assignment_status = 'managed',
      workflow_status = 'managed',
      tipificacion_actual = 'Demo completada',
      observacion_actual = 'Recorrido de demostración del motor Kovacs.'
  where id = p_lead_id;

  insert into public.call_events (call_id, lead_id, agent_id, event_type, payload)
  values (
    null,
    p_lead_id,
    auth.uid(),
    'lead_orchestrator.demo_completed',
    jsonb_build_object('assignment_id', v_assignment.id, 'source', 'lead_orchestrator')
  );
end;
$function$;

revoke all on function public.complete_my_kovacs_demo_assignment(uuid) from public, anon;
grant execute on function public.complete_my_kovacs_demo_assignment(uuid) to authenticated;

create or replace function public.complete_lead_orchestrator_assignment()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  if new.managed_at is not null and old.managed_at is distinct from new.managed_at then
    update public.lead_orchestrator_assignments
    set status = 'completed', completed_at = new.managed_at, updated_at = now()
    where lead_id = new.id and status in ('delivered', 'opened');
  end if;
  return new;
end;
$function$;

create trigger leads_complete_orchestrator_assignment
  after update of managed_at on public.leads
  for each row execute function public.complete_lead_orchestrator_assignment();

with campaign as (
  insert into public.campaigns (name, description, is_active)
  values (
    'Kovacs',
    'Demo aislada de priorizacion y asignacion automatica de leads para ejecutivos.',
    true
  )
  on conflict (name) do update
    set description = excluded.description,
        updated_at = now()
  returning id
), config as (
  insert into public.lead_orchestrator_configs (campaign_id, is_active)
  select id, false from campaign
  on conflict (campaign_id) do nothing
  returning campaign_id
)
insert into public.lead_priority_rules (campaign_id, position, name, field_name, operator, comparison_value)
select campaign.id, seed.position, seed.name, seed.field_name, seed.operator, seed.comparison_value
from campaign
cross join (values
  (1, 'Scoring alto', 'Scoring', 'gte', '80'),
  (2, 'Prioridad Santiago', 'Ciudad', 'eq', 'Santiago'),
  (3, 'No contestados', 'status', 'eq', 'no_contesta')
) as seed(position, name, field_name, operator, comparison_value)
on conflict (campaign_id, position) do nothing;

-- Base ficticia Kovacs: 100 registros sintéticos inspirados en las columnas
-- operacionales compartidas por el cliente. `example.com`, nombres Demo y
-- teléfonos deliberadamente no utilizables evitan confundirla con datos reales.
with kovacs_campaign as (
  select id
  from public.campaigns
  where lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) = 'kovacs'
  limit 1
), demo_rows as (
  select
    series as row_number,
    9100000 + series as quote_number,
    (array['CHEVROLET', 'NISSAN', 'TOYOTA', 'OMODA', 'JAECOO', 'AUDI', 'BMW', 'JEEP'])[((series - 1) % 8) + 1] as brand,
    (array['N400', 'KICKS', '4RUNNER', 'C5', 'J7', 'Q2', 'X1', 'RENEGADE'])[((series - 1) % 8) + 1] as model,
    (array['Santiago', 'Viña del Mar', 'Valparaíso', 'Talca', 'Los Andes', 'Concepción'])[((series - 1) % 6) + 1] as city,
    (array['Mall Plaza Oeste', 'Movicenter', 'Valparaíso Centro', 'Talca Usados', 'Los Andes', 'Concepción'])[((series - 1) % 6) + 1] as branch,
    55 + ((series * 17) % 46) as scoring,
    (array[8490000, 10990000, 13990000, 14990000, 16990000, 19990000, 22990000])[((series - 1) % 7) + 1] as price
  from generate_series(1, 100) as series
)
insert into public.leads (
  campaign_id,
  full_name,
  rut,
  phone,
  email,
  status,
  assignment_status,
  workflow_status,
  extra,
  created_at,
  updated_at
)
select
  campaign.id,
  'Cliente Demo Kovacs ' || lpad(demo.row_number::text, 3, '0'),
  '99' || lpad(demo.row_number::text, 6, '0') || '-D',
  '+560000' || lpad(demo.row_number::text, 6, '0'),
  'demo.kovacs.' || lpad(demo.row_number::text, 3, '0') || '@example.com',
  case when demo.row_number % 4 = 0 then 'no_contesta' else 'nuevo' end,
  'pending',
  'pending',
  jsonb_build_object(
    'N° Cotización', demo.quote_number,
    'Marca', demo.brand,
    'Modelo', demo.model,
    'Línea Negocio', 'Usados Usados',
    'Precio Todo Evento', demo.price,
    'Cliente', 'Cliente Demo Kovacs ' || lpad(demo.row_number::text, 3, '0'),
    'RUT', '99' || lpad(demo.row_number::text, 6, '0') || '-D',
    'Teléfono Móvil', '+560000' || lpad(demo.row_number::text, 6, '0'),
    'Teléfono Casa', case when demo.row_number % 3 = 0 then '+560001' || lpad(demo.row_number::text, 6, '0') else '' end,
    'Teléfono Oficina', case when demo.row_number % 5 = 0 then '+560002' || lpad(demo.row_number::text, 6, '0') else '' end,
    'Email(s)', 'demo.kovacs.' || lpad(demo.row_number::text, 3, '0') || '@example.com',
    'Fecha Creación', to_char(now() - make_interval(hours => demo.row_number * 3), 'DD/MM/YYYY HH24:MI:SS'),
    'Canal', case when demo.row_number % 5 = 0 then 'Inbound' else 'Internet' end,
    'Fuente', case
      when demo.row_number % 3 = 0 then 'RECUPERACIÓN USADOS'
      when demo.row_number % 3 = 1 then 'LÍNEA 600'
      else 'FORMULARIO WEB'
    end,
    'Campaña', 'Kovacs Demo Recuperación',
    'Tipo Vehículo', case when demo.row_number % 10 = 0 then 'Seminuevo' else 'Nuevo' end,
    'Sucursal de Preferencia', demo.branch,
    'Ciudad', demo.city,
    'Región', case
      when demo.city in ('Santiago', 'Los Andes') then 'RM'
      when demo.city in ('Viña del Mar', 'Valparaíso') then 'V'
      when demo.city = 'Talca' then 'VII'
      else 'VIII'
    end,
    'Tipo Compra', case when demo.row_number % 3 = 0 then 'Financiamiento' else 'Contado' end,
    'Encuestado', case when demo.row_number % 4 = 0 then 'No' else 'Sí' end,
    'Atendido', case when demo.row_number % 4 in (1, 2) then 'Sí' else 'No' end,
    'Cot Enviada', case when demo.row_number % 4 = 1 then 'Sí' else 'No' end,
    'Conforme Con atención', case when demo.row_number % 6 in (1, 2, 3) then 'Sí' else 'No' end,
    'Motivo No Conforme', case
      when demo.row_number % 6 = 0 then 'Ejecutivo no realizó seguimiento'
      when demo.row_number % 6 = 4 then 'Cotización no recibida'
      else ''
    end,
    'Alerta Enviada', case when demo.row_number % 10 = 0 then 'Sí' else 'No' end,
    'Motivo de envío de alerta', case when demo.row_number % 10 = 0 then 'Cliente solicita seguimiento comercial' else '' end,
    'Opciones para cerrar negocio', case
      when demo.row_number % 5 = 0 then 'Reenviar cotización'
      when demo.row_number % 5 = 1 then 'Coordinar test drive'
      else 'Seguimiento comercial'
    end,
    'Prospección (libre)', case
      when demo.row_number % 4 = 0 then 'Cliente demo no contesta; volver a intentar en horario de tarde.'
      when demo.row_number % 4 = 1 then 'Cliente demo recibió cotización y está evaluando alternativas.'
      when demo.row_number % 4 = 2 then 'Cliente demo solicita contacto del ejecutivo de la sucursal.'
      else 'Cliente demo interesado en conocer opciones de financiamiento.'
    end,
    'Scoring', demo.scoring,
    'Intentos', demo.row_number % 4,
    'Estado base', case when demo.row_number % 4 = 0 then 'No contactado' else 'Pendiente' end
  ),
  now() - make_interval(hours => demo.row_number * 3),
  now() - make_interval(hours => demo.row_number * 3)
from kovacs_campaign campaign
cross join demo_rows demo
on conflict do nothing;
