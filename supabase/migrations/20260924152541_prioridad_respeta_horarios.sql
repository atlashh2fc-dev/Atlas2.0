-- La prioridad del supervisor no debe saltarse los horarios por campaña.
--
-- ensure_my_active_campaign guardaba campaña activa también a quien tenía una sola
-- campaña automática. Esa fila hace que get_active_campaign_agent_extensions ignore
-- campaign_agent_schedules, y así Laura Pincheira entró a Meta Ads fuera de su horario.
-- Ahora la prioridad solo decide en el caso multiskill real: dos o más campañas
-- automáticas, ninguna con horario, y una sola en el primer lugar.

create or replace function public.ensure_my_active_campaign()
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_current public.agent_active_campaigns%rowtype;
  v_top uuid;
  v_top_count integer;
  v_eligible integer;
  v_scheduled integer;
begin
  if v_actor_id is null then
    return null;
  end if;

  select * into v_current from public.agent_active_campaigns where profile_id = v_actor_id;
  if found and (v_current.locked or v_current.source = 'agente') then
    return v_current.campaign_id;
  end if;

  with eligible as (
    select membership.id, membership.campaign_id, membership.priority, membership.schedule_required, campaign.name
    from public.campaign_agents membership
    join public.campaigns campaign on campaign.id = membership.campaign_id and campaign.is_active
    join public.dialer_campaign_configs config
      on config.campaign_id = membership.campaign_id and config.is_active and config.dial_mode <> 'manual'
    where membership.profile_id = v_actor_id
  ), top as (
    select * from eligible where priority = (select min(priority) from eligible)
  )
  select
    (select campaign_id from top order by name limit 1),
    (select count(*) from top),
    (select count(*) from eligible),
    (select count(*) from eligible
      where schedule_required
         or exists (select 1 from public.campaign_agent_schedules schedule where schedule.campaign_agent_id = eligible.id))
  into v_top, v_top_count, v_eligible, v_scheduled;

  if v_eligible < 2 or v_scheduled > 0 or v_top is null or v_top_count <> 1 or v_top = v_current.campaign_id then
    return v_current.campaign_id;
  end if;

  begin
    perform public.apply_agent_active_campaign(v_actor_id, v_top, 'prioridad', false, null);
  exception when others then
    -- En llamada o tipificando: se reintenta en la próxima lectura de la barra.
    return v_current.campaign_id;
  end;
  return v_top;
end;
$$;

-- Deshace la única asignación que la versión anterior hizo fuera de ese caso.
delete from public.agent_active_campaigns active
where active.source = 'prioridad'
  and not active.locked
  and (
    select count(*)
    from public.campaign_agents membership
    join public.campaigns campaign on campaign.id = membership.campaign_id and campaign.is_active
    join public.dialer_campaign_configs config
      on config.campaign_id = membership.campaign_id and config.is_active and config.dial_mode <> 'manual'
    where membership.profile_id = active.profile_id
  ) < 2;
