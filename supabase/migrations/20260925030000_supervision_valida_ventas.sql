-- Supervisión valida las ventas antes de que avancen en el CRM.
--
-- En Atlas 1 cada VENTA EN VALIDACION abría un caso (equifax_sales_cases) que
-- un backoffice validaba o rechazaba. Atlas 2.0 heredó la tipificación, sus
-- productos y la UF, pero no el caso: el cierre quedaba en «Prospecto
-- disponible» y nadie lo revisaba. Medido el 24-09-2026: 52 llamadas VENTA EN
-- VALIDACION, todas del equipo Equifax Outbound; 14 ya se habían validado en
-- Atlas 1 (junio y julio) y 38 no. En Atlas 1 la cola tampoco se trabajaba
-- desde el 23-07: 638 casos pendientes sin validador.
--
-- Geimser no tiene backoffice humano (pedido del 24-09-2026): valida la
-- supervisora del equipo. Por eso no hay un rol ni un permiso nuevo: aprueba o
-- rechaza el admin o el supervisor de los equipos del registro, igual que en
-- private.assert_can_manage_lead_phones.
--
--   * Cada llamada cerrada como venta (outcome 'sale', motivo VENTA EN
--     VALIDACION) deja una fila pendiente. Lo hace un disparador sobre calls,
--     así que cubre el cierre, la corrección de la tipificación y cualquier
--     camino futuro sin tocar save_call_management.
--   * Aprobar lleva el registro a 'convertido' (la conversión que cuentan el
--     inicio y los reportes) y guarda el estado anterior. Rechazar exige motivo
--     y no avanza el registro; si estaba aprobada, lo devuelve a su estado.
--   * Si la tipificación se corrige y deja de ser venta, la fila se anula y el
--     registro vuelve a su estado si había avanzado por ella.
--   * Nada se borra: cada decisión queda con quién, cuándo y por qué, y en
--     crm_audit_events.

create table if not exists public.sale_validations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  call_id uuid not null references public.calls(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  agent_id uuid references public.profiles(id) on delete set null,
  historical_agent_id uuid references public.historical_agents(id) on delete set null,
  sold_at timestamptz not null,
  products text[],
  uf_amount numeric,
  recipient_email text,
  agent_notes text,
  status text not null default 'pendiente',
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  decision_source text,
  -- Estado del registro antes de que la aprobación lo llevara a 'convertido'.
  lead_status_before text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sale_validations_call_key unique (call_id),
  constraint sale_validations_status_check check (status in ('pendiente', 'aprobada', 'rechazada', 'anulada')),
  constraint sale_validations_decision_source_check check (
    decision_source is null or decision_source in ('supervision', 'atlas1', 'revision')
  ),
  constraint sale_validations_rejection_note_check check (
    status <> 'rechazada' or nullif(btrim(coalesce(decision_note, '')), '') is not null
  )
);

create index if not exists sale_validations_queue_idx
  on public.sale_validations (organization_id, status, sold_at desc);
create index if not exists sale_validations_lead_idx on public.sale_validations (lead_id);
create index if not exists sale_validations_team_idx on public.sale_validations (team_id) where team_id is not null;
create index if not exists sale_validations_agent_idx on public.sale_validations (agent_id) where agent_id is not null;

comment on table public.sale_validations is
  'Una fila por llamada cerrada como VENTA EN VALIDACION. Supervisión (o admin) la aprueba —el registro pasa a convertido— o la rechaza con motivo. Reemplaza el backoffice de Atlas 1 (equifax_sales_cases).';

-- ---------------------------------------------------------------------------
-- Seguridad por fila: solo la propia empresa. Leen admin, supervisión y el
-- ejecutivo que hizo la venta (para saber si avanzó). Nadie escribe directo:
-- las filas las crea el disparador y las decide resolve_sale_validation.
-- ---------------------------------------------------------------------------
alter table public.sale_validations enable row level security;
revoke all on table public.sale_validations from anon;
revoke insert, update, delete on table public.sale_validations from authenticated;
grant select on table public.sale_validations to authenticated;

drop policy if exists sale_validations_organization_isolation on public.sale_validations;
create policy sale_validations_organization_isolation on public.sale_validations
  as restrictive for all to authenticated
  using (organization_id = any (public.current_org_ids()))
  with check (organization_id = any (public.current_org_ids()));

drop policy if exists sale_validations_select on public.sale_validations;
create policy sale_validations_select on public.sale_validations
  for select to authenticated
  using (
    (select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
    or agent_id = (select auth.uid())
    or public.is_platform_owner()
  );

-- ---------------------------------------------------------------------------
-- ¿Es esta llamada una venta por validar?
-- ---------------------------------------------------------------------------
create or replace function public.call_is_sale_to_validate(p_outcome text, p_reason text, p_ended_at timestamptz)
returns boolean
language sql
immutable
set search_path to 'pg_catalog', 'public'
as $$
  select p_ended_at is not null
    and p_outcome = 'sale'
    and public.normalize_management_text(p_reason) = 'VENTA EN VALIDACION';
$$;

-- Devuelve el registro al estado que tenía antes de la aprobación, salvo que
-- otra venta aprobada del mismo registro lo sostenga como convertido.
create or replace function private.sale_validation_restore_lead(p_validation public.sale_validations)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  if p_validation.status <> 'aprobada' then
    return;
  end if;
  if exists (
    select 1 from public.sale_validations other
    where other.lead_id = p_validation.lead_id
      and other.id <> p_validation.id
      and other.status = 'aprobada'
  ) then
    return;
  end if;
  update public.leads
  set status = coalesce(p_validation.lead_status_before, 'en_gestion'),
      updated_at = now()
  where id = p_validation.lead_id
    and status = 'convertido';
end;
$$;

revoke all on function private.sale_validation_restore_lead(public.sale_validations) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Disparador: la venta nace pendiente al cerrarse; una corrección que la saca
-- de venta la anula, y una que la vuelve a venta la reabre.
-- ---------------------------------------------------------------------------
create or replace function public.sale_validation_from_call()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_lead public.leads%rowtype;
  v_existing public.sale_validations%rowtype;
begin
  select * into v_existing from public.sale_validations where call_id = new.id;

  if public.call_is_sale_to_validate(new.outcome, new.reason, new.ended_at) then
    if v_existing.id is not null then
      update public.sale_validations
      set products = new.equifax_products,
          uf_amount = new.equifax_uf_amount,
          recipient_email = new.equifax_recipient_email,
          agent_notes = new.notes,
          status = case when status = 'anulada' then 'pendiente' else status end,
          decided_by = case when status = 'anulada' then null else decided_by end,
          decided_at = case when status = 'anulada' then null else decided_at end,
          decision_note = case when status = 'anulada' then null else decision_note end,
          decision_source = case when status = 'anulada' then null else decision_source end,
          updated_at = now()
      where id = v_existing.id;
      return null;
    end if;

    select * into v_lead from public.leads where id = new.lead_id;
    if not found or v_lead.organization_id is null then
      return null;
    end if;

    insert into public.sale_validations (
      organization_id, call_id, lead_id, campaign_id, team_id, agent_id, historical_agent_id,
      sold_at, products, uf_amount, recipient_email, agent_notes
    )
    values (
      v_lead.organization_id, new.id, new.lead_id, v_lead.campaign_id, v_lead.team_id, new.agent_id,
      new.historical_agent_id, coalesce(new.ended_at, new.started_at, new.created_at),
      new.equifax_products, new.equifax_uf_amount, new.equifax_recipient_email, new.notes
    )
    on conflict (call_id) do nothing;
    return null;
  end if;

  if v_existing.id is not null and v_existing.status in ('pendiente', 'aprobada') then
    perform private.sale_validation_restore_lead(v_existing);
    update public.sale_validations
    set status = 'anulada',
        decided_by = null,
        decided_at = now(),
        decision_note = 'La tipificación de la llamada dejó de ser VENTA EN VALIDACION.',
        decision_source = 'revision',
        updated_at = now()
    where id = v_existing.id;
  end if;
  return null;
end;
$$;

drop trigger if exists calls_sale_validation on public.calls;
create trigger calls_sale_validation
  after insert or update of reason, outcome, ended_at, equifax_products, equifax_uf_amount, equifax_recipient_email, notes
  on public.calls
  for each row execute function public.sale_validation_from_call();

-- ---------------------------------------------------------------------------
-- Aprobar o rechazar. Admin o supervisor de los equipos del registro. Una
-- decisión se puede corregir (aprobada ↔ rechazada) dejando el motivo; una
-- venta anulada por corrección de la tipificación no se decide.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_sale_validation(p_validation_id uuid, p_decision text, p_note text)
returns public.sale_validations
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_role public.app_role := public.current_role_name();
  v_actor uuid := (select auth.uid());
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_row public.sale_validations%rowtype;
  v_lead public.leads%rowtype;
  v_result public.sale_validations%rowtype;
begin
  if v_actor is null then
    raise exception 'No autenticado.';
  end if;
  if v_role is null or v_role not in ('admin'::public.app_role, 'supervisor'::public.app_role) then
    raise exception 'Solo supervisión o administración puede validar ventas.' using errcode = '42501';
  end if;
  if p_decision not in ('aprobada', 'rechazada') then
    raise exception 'Decisión inválida.';
  end if;

  select * into v_row from public.sale_validations where id = p_validation_id for update;
  if not found then
    raise exception 'La venta no existe.';
  end if;
  perform public.assert_org_access(v_row.organization_id);
  if v_role = 'supervisor'::public.app_role
    and v_row.team_id is not null
    and not (v_row.team_id = any (public.supervised_team_ids())) then
    raise exception 'Esa venta no es de tus equipos.' using errcode = '42501';
  end if;

  if v_row.status = 'anulada' then
    raise exception 'La tipificación de esa llamada ya no es venta; no hay nada que validar.';
  end if;
  if v_row.status = p_decision then
    raise exception 'La venta ya está %.', p_decision;
  end if;
  if p_decision = 'rechazada' and v_note is null then
    raise exception 'Indica por qué se rechaza la venta.';
  end if;
  if v_row.status <> 'pendiente' and v_note is null then
    raise exception 'Indica por qué cambias la decisión.';
  end if;

  select * into v_lead from public.leads where id = v_row.lead_id for update;

  if p_decision = 'aprobada' then
    update public.sale_validations
    set status = 'aprobada',
        decided_by = v_actor,
        decided_at = now(),
        decision_note = v_note,
        decision_source = 'supervision',
        lead_status_before = case
          when v_lead.status is distinct from 'convertido' then v_lead.status
          else lead_status_before
        end,
        updated_at = now()
    where id = v_row.id
    returning * into v_result;

    update public.leads
    set status = 'convertido',
        updated_at = now()
    where id = v_row.lead_id
      and status is distinct from 'convertido';
  else
    perform private.sale_validation_restore_lead(v_row);
    update public.sale_validations
    set status = 'rechazada',
        decided_by = v_actor,
        decided_at = now(),
        decision_note = v_note,
        decision_source = 'supervision',
        updated_at = now()
    where id = v_row.id
    returning * into v_result;
  end if;

  insert into public.crm_audit_events (lead_id, crm_entity_id, actor_id, event_type, payload)
  values (
    v_row.lead_id, v_lead.crm_entity_id, v_actor,
    case when p_decision = 'aprobada' then 'sale_validation.approved' else 'sale_validation.rejected' end,
    jsonb_build_object(
      'sale_validation_id', v_row.id,
      'call_id', v_row.call_id,
      'previous_status', v_row.status,
      'note', v_note
    )
  );

  return v_result;
end;
$$;

revoke all on function public.resolve_sale_validation(uuid, text, text) from public, anon;
grant execute on function public.resolve_sale_validation(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Cola de supervisión: la lista y el contador del menú. Mismo alcance que la
-- decisión: admin ve la empresa; supervisor, sus equipos y lo que no tiene
-- equipo.
-- ---------------------------------------------------------------------------
create or replace function private.sale_validation_in_scope(p_row public.sale_validations)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select p_row.organization_id = any (public.current_org_ids())
    and (
      public.current_role_name() = 'admin'::public.app_role
      or (
        public.current_role_name() = 'supervisor'::public.app_role
        and (p_row.team_id is null or p_row.team_id = any (public.supervised_team_ids()))
      )
    );
$$;

revoke all on function private.sale_validation_in_scope(public.sale_validations) from public, anon, authenticated;

create or replace function public.list_sale_validations(p_status text default 'pendiente', p_limit integer default 200)
returns table (
  id uuid,
  status text,
  sold_at timestamptz,
  lead_id uuid,
  lead_name text,
  lead_rut text,
  lead_phone text,
  lead_email text,
  lead_status text,
  campaign_name text,
  team_name text,
  agent_name text,
  products text[],
  uf_amount numeric,
  recipient_email text,
  agent_notes text,
  decided_at timestamptz,
  decided_by_name text,
  decision_note text,
  decision_source text
)
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select
    v.id, v.status, v.sold_at, v.lead_id,
    lead.full_name, lead.rut, lead.phone, lead.email, lead.status,
    campaign.name, team.name,
    -- El historial de Atlas 1 se cargó con un perfil centinela; el nombre
    -- real del ejecutivo está en historical_agents.
    coalesce(historical.full_name, agent.full_name, agent.email),
    v.products, v.uf_amount, v.recipient_email, v.agent_notes,
    v.decided_at, coalesce(decider.full_name, decider.email), v.decision_note, v.decision_source
  from public.sale_validations v
  join public.leads lead on lead.id = v.lead_id
  left join public.campaigns campaign on campaign.id = v.campaign_id
  left join public.teams team on team.id = v.team_id
  left join public.profiles agent on agent.id = v.agent_id
  left join public.historical_agents historical on historical.id = v.historical_agent_id
  left join public.profiles decider on decider.id = v.decided_by
  where v.status = coalesce(p_status, v.status)
    and private.sale_validation_in_scope(v)
  order by
    case when v.status = 'pendiente' then v.sold_at end asc,
    coalesce(v.decided_at, v.sold_at) desc
  limit least(greatest(coalesce(p_limit, 200), 1), 1000);
$$;

revoke all on function public.list_sale_validations(text, integer) from public, anon;
grant execute on function public.list_sale_validations(text, integer) to authenticated;

create or replace function public.count_sale_validations()
returns table (status text, total integer)
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select v.status, count(*)::integer
  from public.sale_validations v
  where private.sale_validation_in_scope(v)
  group by v.status;
$$;

revoke all on function public.count_sale_validations() from public, anon;
grant execute on function public.count_sale_validations() to authenticated;

-- ---------------------------------------------------------------------------
-- Carga inicial desde las llamadas ya cerradas como venta. El historial de
-- Atlas 1 se carga con session_replication_role = replica (el disparador no
-- corre), así que esta función se vuelve a llamar después de cada corte de la
-- migración: solo agrega las ventas que faltan.
-- ---------------------------------------------------------------------------
create or replace function private.sale_validations_backfill()
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_inserted integer;
begin
  insert into public.sale_validations (
    organization_id, call_id, lead_id, campaign_id, team_id, agent_id, historical_agent_id,
    sold_at, products, uf_amount, recipient_email, agent_notes
  )
  select
    lead.organization_id, call.id, call.lead_id, lead.campaign_id, lead.team_id, call.agent_id,
    call.historical_agent_id, coalesce(call.ended_at, call.started_at, call.created_at),
    call.equifax_products, call.equifax_uf_amount, call.equifax_recipient_email, call.notes
  from public.calls call
  join public.leads lead on lead.id = call.lead_id
  where public.call_is_sale_to_validate(call.outcome, call.reason, call.ended_at)
    and lead.organization_id is not null
  on conflict (call_id) do nothing;
  get diagnostics v_inserted = row_count;

  -- Ventas que el backoffice de Atlas 1 ya validó (equifax_sales_cases con
  -- status 'validated', leído el 24-09-2026; source_call_id = legacy_call_id).
  -- No se le piden de nuevo a supervisión.
  with atlas1 (legacy_call_id, validated_at) as (
    values
      ('626501a7-97b3-4d51-b56d-d000d0bc1b16', '2026-06-25 16:52:22.038+00'::timestamptz),
      ('0bdb3691-9c7b-435a-b32f-3382d302dc6b', '2026-06-25 17:10:59.175+00'::timestamptz),
      ('4bf1a1bd-9ac4-4620-87ce-623a5335553c', '2026-06-25 17:21:36.126+00'::timestamptz),
      ('75272989-0ba4-41bd-ae88-d2fe3bef4dc2', '2026-06-25 17:22:44.972+00'::timestamptz),
      ('c5f3078e-a3e0-41b1-84f1-4449cc6c5cc1', '2026-06-25 17:23:05.034+00'::timestamptz),
      ('1ae93bc3-cd0a-41c4-afba-dfd0549dc3f5', '2026-06-25 17:23:41.923+00'::timestamptz),
      ('e96fe910-a526-4974-a132-e8f22d636990', '2026-06-25 17:24:10.913+00'::timestamptz),
      ('a0b012c9-c3ae-4fb9-8cba-f0a056f174e9', '2026-06-25 17:24:35.976+00'::timestamptz),
      ('a92d120a-91ba-452c-bad6-2748f0b4465e', '2026-06-25 17:25:09.892+00'::timestamptz),
      ('419f4b8a-0cf2-4118-aecf-24974a798216', '2026-06-30 15:57:50.255+00'::timestamptz),
      ('a2ec8363-90ba-4286-8d9c-d2692b8d3ff0', '2026-06-30 17:00:54.81+00'::timestamptz),
      ('926ca482-3f0c-4256-85da-490dde3c825d', '2026-06-30 17:01:25.154+00'::timestamptz),
      ('52fe0ed3-564f-4f7a-acf7-0c9c4a112d09', '2026-07-23 15:39:13.939+00'::timestamptz),
      ('8c53c561-5782-4c1e-8540-36b48b26ed3a', '2026-07-23 15:41:07.22+00'::timestamptz),
      ('89008448-d10a-443d-a279-822340ee54e7', '2026-07-23 15:41:38.72+00'::timestamptz),
      ('ce199db8-2691-4a37-b993-bfe0bb2307e8', '2026-07-23 15:42:17.106+00'::timestamptz),
      ('7f87f0cd-bea3-4c77-9b14-31672deb78ba', '2026-07-23 15:58:40.507+00'::timestamptz),
      ('1dfb1add-71ab-4cb7-a466-c2df3f82d941', '2026-07-23 16:02:59.547+00'::timestamptz),
      ('bc78191b-2805-4fd9-b60b-7d083d2e3550', '2026-07-23 16:03:59.377+00'::timestamptz),
      ('5eb9b447-ffb5-41a7-9f79-ade9643df7dd', '2026-07-23 16:33:27.299+00'::timestamptz),
      ('2c6810cc-ce0f-45ae-ac4c-6024dd0fa57e', '2026-07-23 16:34:06.602+00'::timestamptz),
      ('e55e17d5-f14c-453f-9077-f7912f5b36b6', '2026-07-23 16:47:03.481+00'::timestamptz)
  ),
  aprobadas as (
    update public.sale_validations v
    set status = 'aprobada',
        decided_at = atlas1.validated_at,
        decision_note = 'Validada por el backoffice en Atlas 1.',
        decision_source = 'atlas1',
        lead_status_before = lead.status,
        updated_at = now()
    from public.calls call, atlas1, public.leads lead
    where call.id = v.call_id
      and call.legacy_call_id = atlas1.legacy_call_id
      and lead.id = v.lead_id
      and v.status = 'pendiente'
    returning v.lead_id
  )
  update public.leads lead
  set status = 'convertido',
      updated_at = now()
  where lead.id in (select lead_id from aprobadas)
    and lead.status is distinct from 'convertido';

  return v_inserted;
end;
$$;

revoke all on function private.sale_validations_backfill() from public, anon, authenticated;

select private.sale_validations_backfill();
