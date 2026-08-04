-- `managed_by + managed_at` no prueba que el ejecutivo haya hablado con el
-- cliente: save_call_management también persiste intentos no conectados, y el
-- discador estaba adelantando managed_by al momento de asignar. La fuente de
-- verdad de "Mis registros" pasa a ser una llamada propia, cerrada y conectada.

create index if not exists calls_agent_connected_lead_idx
  on public.calls (agent_id, lead_id)
  where status = 'connected'
    and ended_at is not null
    and discarded_reason is null;

create or replace view public.agent_contacted_leads
with (security_invoker = true)
as
select l.*
from public.leads l
where (select public.current_role_name()) = 'agente'
  and l.managed_by = (select auth.uid())
  and exists (
    select 1
    from public.calls c
    where c.lead_id = l.id
      and c.agent_id = (select auth.uid())
      and c.status = 'connected'
      and c.ended_at is not null
      and c.discarded_reason is null
  );

revoke all on public.agent_contacted_leads from public, anon;
grant select on public.agent_contacted_leads to authenticated, service_role;

comment on view public.agent_contacted_leads is
  'Clientes actualmente gestionados por el agente autenticado con evidencia de al menos una llamada propia conectada y cerrada. Respeta RLS mediante security_invoker.';

-- Asignar un intento sólo cambia la responsabilidad operativa. managed_by es
-- el autor de la última gestión cerrada y save_call_management lo actualiza al
-- guardar la tipificación; no debe adelantarse al contestar el discador.
create or replace function public.claim_dial_attempt_for_agent(
  p_dial_attempt_id uuid,
  p_agent_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_lead public.leads%rowtype;
  v_agent public.profiles%rowtype;
  v_lead_id uuid;
  v_team_id uuid;
  v_now timestamptz := now();
begin
  if v_actor_id is not null then
    raise exception 'claim_dial_attempt_for_agent solo puede ser llamada por el motor de discado.';
  end if;

  select * into v_agent
  from public.profiles
  where id = p_agent_id and role = 'agente' and active
  limit 1;
  if not found then
    raise exception 'El ejecutivo % no existe o no está activo.', p_agent_id;
  end if;

  update public.dial_attempts attempt
  set agent_id = p_agent_id, updated_at = v_now
  where attempt.id = p_dial_attempt_id
    and attempt.agent_id is null
    and attempt.status in ('queued', 'originating', 'ringing', 'answered', 'bridged')
  returning attempt.lead_id into v_lead_id;

  if v_lead_id is null then return false; end if;

  select * into v_lead from public.leads where id = v_lead_id for update;
  if not found then return false; end if;

  v_team_id := coalesce(v_lead.team_id, v_agent.team_id);

  update public.lead_assignments
  set is_active = false, ends_at = v_now, updated_at = v_now
  where lead_id = v_lead_id and is_active;

  insert into public.lead_assignments
    (lead_id, assigned_to, assigned_by, team_id, campaign_id, reason, source, is_active, starts_at)
  values
    (v_lead_id, p_agent_id, null, v_team_id, v_lead.campaign_id,
     'Atendió la llamada del discador', 'dialer.answer', true, v_now);

  update public.leads
  set assigned_to = p_agent_id,
      team_id = v_team_id,
      assignment_status = 'assigned',
      updated_at = v_now
  where id = v_lead_id;

  insert into public.crm_audit_events (lead_id, crm_entity_id, actor_id, event_type, payload)
  values (
    v_lead_id,
    v_lead.crm_entity_id,
    null,
    'lead.assigned',
    jsonb_build_object(
      'old_assigned_to', v_lead.assigned_to,
      'new_assigned_to', p_agent_id,
      'team_id', v_team_id,
      'campaign_id', v_lead.campaign_id,
      'source', 'dialer.answer',
      'dial_attempt_id', p_dial_attempt_id
    )
  );

  return true;
end;
$function$;

revoke all on function public.claim_dial_attempt_for_agent(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_dial_attempt_for_agent(uuid, uuid)
  to service_role;

create or replace function public.get_lead_view_counts(
  p_agent uuid default null,
  p_campaign uuid default null,
  p_status text default null,
  p_ids uuid[] default null
)
returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $function$
  with visible as (
    select l.phone, l.next_action_at, l.managed_at, l.assignment_status, l.workflow_status, l.status
    from public.leads l
    where (p_ids is null or l.id = any(p_ids))
      and (
        (
          (select public.current_role_name()) = 'agente'
          and l.managed_by = (select auth.uid())
          and exists (
            select 1
            from public.calls c
            where c.lead_id = l.id
              and c.agent_id = (select auth.uid())
              and c.status = 'connected'
              and c.ended_at is not null
              and c.discarded_reason is null
          )
        )
        or (
          (select public.current_role_name()) is distinct from 'agente'
          and (p_agent is null or l.assigned_to = p_agent or l.managed_by = p_agent)
        )
      )
      and (p_campaign is null or l.campaign_id = p_campaign)
  ),
  flagged as (
    select
      btrim(coalesce(phone, '')) <> '' as has_phone,
      next_action_at,
      (
        managed_at is not null
        or coalesce(assignment_status, '') = 'managed'
        or coalesce(workflow_status, '') = 'managed'
      ) as managed
    from visible
    where (p_status is null or status = p_status)
  )
  select jsonb_build_object(
    'prioridad', (select count(*) from flagged),
    'vencidas', (select count(*) from flagged where has_phone and next_action_at <= now()),
    'hoy', (
      select count(*) from flagged
      where has_phone
        and next_action_at >= date_trunc('day', now())
        and next_action_at < date_trunc('day', now()) + interval '1 day'
    ),
    'disponibles', (
      select count(*) from flagged
      where has_phone
        and not managed
        and (next_action_at is null or next_action_at >= date_trunc('day', now()) + interval '1 day')
    ),
    'bloqueados', (select count(*) from flagged where not has_phone),
    'gestionados', (select count(*) from flagged where has_phone and managed and next_action_at is null),
    'estados', coalesce(
      (select jsonb_agg(distinct status order by status) from visible where status is not null),
      '[]'::jsonb
    )
  );
$function$;

revoke execute on function public.get_lead_view_counts(uuid, uuid, text, uuid[]) from public, anon;
grant execute on function public.get_lead_view_counts(uuid, uuid, text, uuid[]) to authenticated, service_role;

comment on function public.get_lead_view_counts(uuid, uuid, text, uuid[]) is
  'Contadores de Registros. Para agentes sólo incluye clientes con llamada propia conectada, cerrada y no descartada.';
