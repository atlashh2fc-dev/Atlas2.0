-- Los ejecutivos de una campaña de orquestación de leads no necesitan una
-- extensión SIP: reciben registros, no llamadas. Este heartbeat publica su
-- disponibilidad solo cuando pertenecen a un motor activo y no tienen una
-- credencial telefónica, manteniendo intacta la seguridad del CTI normal.
create or replace function public.heartbeat_my_lead_orchestrator()
returns boolean
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_available_reason_id uuid;
begin
  if v_actor_id is null then
    return false;
  end if;

  if not exists (
    select 1
    from public.profiles profile
    join public.campaign_agents membership on membership.profile_id = profile.id
    join public.campaigns campaign on campaign.id = membership.campaign_id and campaign.is_active
    join public.lead_orchestrator_configs config
      on config.campaign_id = campaign.id and config.is_active
    where profile.id = v_actor_id
      and profile.active
      and profile.role = 'agente'
      and not exists (
        select 1
        from public.agent_sip_credentials credential
        where credential.profile_id = profile.id and credential.is_active
      )
  ) then
    return false;
  end if;

  select reason.id into v_available_reason_id
  from public.agent_status_reasons reason
  where reason.is_active and reason.is_pause = false
  order by reason.sort_order, reason.id
  limit 1;

  if v_available_reason_id is null then
    raise exception 'No existe un estado Disponible activo.';
  end if;

  insert into public.agent_current_status (profile_id, reason_id, since, last_heartbeat_at)
  values (v_actor_id, v_available_reason_id, now(), now())
  on conflict (profile_id) do update
  set reason_id = excluded.reason_id,
      since = case
        when agent_current_status.reason_id = excluded.reason_id then agent_current_status.since
        else now()
      end,
      last_heartbeat_at = now();

  return true;
end;
$function$;

revoke all on function public.heartbeat_my_lead_orchestrator() from public, anon;
grant execute on function public.heartbeat_my_lead_orchestrator() to authenticated;
