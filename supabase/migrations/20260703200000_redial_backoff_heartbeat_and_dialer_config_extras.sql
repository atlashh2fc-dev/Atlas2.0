-- Heartbeat para detectar desconexiones abruptas (cerrar pestaña/crash del
-- navegador sin pasar por signOut()): el CRM actualiza esta columna cada
-- ~20s mientras el agente está logueado; el motor la revisa y fuerza
-- 'desconectado' si se venció, igual que markAgentLoggedOut().
alter table public.agent_current_status
  add column if not exists last_heartbeat_at timestamptz;

-- Config extra por campaña: tope de reintentos automáticos, timeout de cola
-- para no dejar a un cliente esperando sin agente indefinidamente, tasa de
-- abandono objetivo para el auto-ajuste del ratio en modo predictivo, y
-- flag para habilitar AMD (detección de contestador) — todos con defaults
-- que no cambian el comportamiento de campañas ya configuradas.
alter table public.dialer_campaign_configs
  add column if not exists max_redial_attempts integer not null default 4,
  add column if not exists abandon_timeout_seconds integer not null default 90,
  add column if not exists target_abandonment_rate numeric not null default 6.0,
  add column if not exists amd_enabled boolean not null default false;

-- Redial con backoff: antes, un lead con un intento terminado en
-- no_answer/busy/failed volvía a estar disponible en el siguiente tick
-- (sin espera alguna) mientras next_action_at siguiera nulo/pasado. Ahora
-- se espera 15min tras el 1er intento negativo, 1h tras el 2do, 4h desde
-- el 3ro en adelante, y se deja de reintentar automáticamente al llegar a
-- max_redial_attempts (configurable por campaña, default 4) — el lead
-- sigue disponible para gestión manual del ejecutivo, solo deja de
-- auto-discarse.
create or replace function public.claim_next_dial_targets(p_campaign_id uuid, p_batch_size integer default 1)
returns table(dial_attempt_id uuid, lead_id uuid, phone text, full_name text, rut text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_max_redial_attempts integer;
begin
  if v_actor_id is not null then
    raise exception 'claim_next_dial_targets solo puede ser llamada por el motor de discado.';
  end if;

  select coalesce(dc.max_redial_attempts, 4) into v_max_redial_attempts
  from public.dialer_campaign_configs dc
  where dc.campaign_id = p_campaign_id;
  v_max_redial_attempts := coalesce(v_max_redial_attempts, 4);

  return query
  with recent_negative as (
    select
      da.lead_id,
      count(*) as attempts,
      max(da.ended_at) as last_ended_at
    from public.dial_attempts da
    where da.campaign_id = p_campaign_id
      and da.status in ('no_answer', 'busy', 'failed', 'voicemail')
      and da.ended_at >= now() - interval '7 days'
    group by da.lead_id
  ), candidates as (
    select l.id, l.phone, l.full_name, l.rut
    from public.leads l
    left join recent_negative rn on rn.lead_id = l.id
    where l.campaign_id = p_campaign_id
      and l.phone is not null
      and btrim(l.phone) <> ''
      and (l.next_action_at is null or l.next_action_at <= now())
      and not exists (
        select 1
        from public.dial_attempts da
        where da.lead_id = l.id
          and da.status in ('queued', 'originating', 'ringing', 'answered', 'bridged')
      )
      and coalesce(rn.attempts, 0) < v_max_redial_attempts
      and (
        rn.last_ended_at is null
        or rn.last_ended_at <= now() - (
          case
            when rn.attempts <= 1 then interval '15 minutes'
            when rn.attempts = 2 then interval '1 hour'
            else interval '4 hours'
          end
        )
      )
    order by l.external_priority_rank asc nulls last, l.next_action_at asc nulls last, l.updated_at asc
    limit p_batch_size
    for update of l skip locked
  ), inserted as (
    insert into public.dial_attempts (lead_id, campaign_id, phone, status)
    select c.id, p_campaign_id, c.phone, 'queued'
    from candidates c
    returning public.dial_attempts.id as inserted_attempt_id,
      public.dial_attempts.lead_id as inserted_lead_id
  )
  select i.inserted_attempt_id, i.inserted_lead_id, c.phone, c.full_name, c.rut
  from inserted i
  join candidates c on c.id = i.inserted_lead_id;
end;
$function$;
