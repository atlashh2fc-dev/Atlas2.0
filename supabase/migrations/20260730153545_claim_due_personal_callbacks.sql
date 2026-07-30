-- Entrega de compromisos: a la hora acordada, el discador marca al cliente y la
-- llamada entra al ejecutivo que lo agendó. El intento nace ya reservado a esa
-- persona, así que ningún otro puede tomarlo.
create or replace function public.claim_due_personal_callbacks(
  p_campaign_id uuid,
  p_limit integer default 5
)
returns table(
  dial_attempt_id uuid,
  lead_id uuid,
  phone text,
  full_name text,
  rut text,
  agent_id uuid,
  agent_extension text
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_cfg public.dialer_campaign_configs%rowtype;
begin
  if v_actor_id is not null then
    raise exception 'claim_due_personal_callbacks solo puede ser llamada por el motor de discado.';
  end if;

  select * into v_cfg
  from public.dialer_campaign_configs
  where campaign_id = p_campaign_id;

  if not found or not v_cfg.is_active or not v_cfg.personal_callback_enabled then
    return;
  end if;

  return query
  with due as (
    select
      l.id,
      l.phone,
      l.full_name,
      l.rut,
      coalesce(l.managed_by, l.assigned_to) as owner_id
    from public.leads l
    where l.campaign_id = p_campaign_id
      and l.workflow_status = 'callback'
      and l.callback_mode = 'personal'
      and l.next_action_at is not null
      and l.next_action_at <= now()
      and l.next_action_at >= now() - make_interval(mins => v_cfg.personal_callback_window_minutes)
      and coalesce(l.managed_by, l.assigned_to) is not null
      and l.phone is not null
      and btrim(l.phone) <> ''
      and (
        l.callback_last_attempt_at is null
        or l.callback_last_attempt_at <= now() - make_interval(secs => v_cfg.personal_callback_retry_seconds)
      )
      and not exists (
        select 1 from public.calls c where c.lead_id = l.id and c.ended_at is null
      )
      and not exists (
        select 1 from public.dial_attempts da
        where da.lead_id = l.id
          and da.status in ('queued', 'originating', 'ringing', 'answered', 'bridged')
      )
      and not exists (
        select 1 from public.dial_attempts da2
        where da2.status in ('queued', 'originating', 'ringing', 'answered', 'bridged')
          and regexp_replace(coalesce(da2.phone, ''), '\D', '', 'g')
              = regexp_replace(l.phone, '\D', '', 'g')
      )
    order by l.next_action_at asc
    limit greatest(coalesce(p_limit, 5), 0)
    for update of l skip locked
  ), listo as (
    select d.id, d.phone, d.full_name, d.rut, d.owner_id, s.extension
    from due d
    join public.dialer_agent_sessions s
      on s.profile_id = d.owner_id
     and s.campaign_id = p_campaign_id
     and s.status = 'available'
    where not exists (
      select 1 from public.calls open_call
      where open_call.agent_id = d.owner_id
        and open_call.ended_at is null
        and open_call.started_at >= now() - interval '4 hours'
    )
  ), marcado as (
    update public.leads l
       set callback_attempts = l.callback_attempts + 1,
           callback_last_attempt_at = now(),
           updated_at = now()
      from listo
     where l.id = listo.id
    returning l.id as marked_id
  ), creado as (
    insert into public.dial_attempts (lead_id, campaign_id, phone, status, agent_id, attempt_kind)
    select listo.id, p_campaign_id, listo.phone, 'queued', listo.owner_id, 'personal_callback'
    from listo
    where exists (select 1 from marcado where marcado.marked_id = listo.id)
    returning
      public.dial_attempts.id as attempt_id,
      public.dial_attempts.lead_id as lead_ref,
      public.dial_attempts.agent_id as agent_ref
  )
  select
    creado.attempt_id,
    creado.lead_ref,
    listo.phone,
    listo.full_name,
    listo.rut,
    creado.agent_ref,
    listo.extension
  from creado
  join listo on listo.id = creado.lead_ref;
end;
$function$;

revoke execute on function public.claim_due_personal_callbacks(uuid, integer) from public, anon, authenticated;

comment on function public.claim_due_personal_callbacks(uuid, integer) is 'Compromisos vencidos listos para entregar a su ejecutivo. El intento nace reservado a esa persona.';
