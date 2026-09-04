-- Una membresía de campaña es la orden operativa completa. El administrador
-- no debe tener que crear después una extensión, elegir una campaña activa ni
-- repetir la misma asignación en una cola omnicanal.
create or replace function public.reconcile_campaign_agent_operational_onboarding()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare
  v_is_outbound_auto boolean := false;
  v_next_extension integer;
  v_next_campaign_id uuid;
begin
  if tg_op = 'INSERT' then
    if not exists (
      select 1
      from public.profiles profile
      where profile.id = new.profile_id
        and profile.active
        and profile.role = 'agente'::public.app_role
    ) then
      return new;
    end if;

    -- Las fuentes digitales/omnicanal usan la misma asignación de campaña.
    insert into public.contact_center_queue_members (queue_id, profile_id, is_active)
    select distinct source.queue_id, new.profile_id, true
    from public.contact_center_queue_sources source
    join public.contact_center_queues queue
      on queue.id = source.queue_id
     and queue.is_active
    where source.campaign_id = new.campaign_id
      and source.is_active
    on conflict (queue_id, profile_id) do update
    set is_active = true;

    select exists (
      select 1
      from public.campaigns campaign
      join public.dialer_campaign_configs config
        on config.campaign_id = campaign.id
       and config.is_active
       and config.dial_mode <> 'manual'
       and config.campaign_type = 'outbound'
      where campaign.id = new.campaign_id
        and campaign.is_active
    ) into v_is_outbound_auto;

    if not v_is_outbound_auto then
      return new;
    end if;

    -- La presencia del agente en Atlas sigue controlando si recibe llamadas.
    -- Sin un horario especial, la membresía deja de ser un bloqueo manual.
    update public.campaign_agents
    set schedule_required = false
    where id = new.id
      and schedule_required
      and not exists (
        select 1
        from public.campaign_agent_schedules schedule
        where schedule.campaign_agent_id = new.id
      );

    -- Serializa el correlativo para que altas simultáneas nunca compartan anexo.
    perform pg_catalog.pg_advisory_xact_lock(20260904, 152747);

    if not exists (
      select 1
      from public.agent_sip_credentials credentials
      where credentials.profile_id = new.profile_id
    ) then
      select greatest(
        6010,
        coalesce(max(
          case
            when credentials.extension ~ '^[0-9]{4,6}$'
              then credentials.extension::integer
            else null
          end
        ), 6009) + 1
      )
      into v_next_extension
      from public.agent_sip_credentials credentials;

      insert into public.agent_sip_credentials (
        profile_id,
        extension,
        sip_password,
        is_active
      ) values (
        new.profile_id,
        v_next_extension::text,
        pg_catalog.encode(extensions.gen_random_bytes(24), 'hex'),
        true
      );
    else
      update public.agent_sip_credentials
      set is_active = true,
          updated_at = now()
      where profile_id = new.profile_id
        and not is_active;
    end if;

    -- La primera campaña automática queda elegida sin intervención humana.
    -- Si el agente ya tiene un skill activo, la nueva membresía no lo cambia.
    insert into public.agent_active_campaigns (profile_id, campaign_id, updated_at)
    values (new.profile_id, new.campaign_id, now())
    on conflict (profile_id) do nothing;

    return new;
  end if;

  -- Al quitar una campaña, conserva una cola si otra fuente asignada todavía
  -- la necesita; de lo contrario deja al agente fuera de ese enrutamiento.
  update public.contact_center_queue_members member
  set is_active = false
  where member.profile_id = old.profile_id
    and exists (
      select 1
      from public.contact_center_queue_sources removed_source
      where removed_source.queue_id = member.queue_id
        and removed_source.campaign_id = old.campaign_id
    )
    and not exists (
      select 1
      from public.contact_center_queue_sources remaining_source
      join public.campaign_agents remaining_membership
        on remaining_membership.campaign_id = remaining_source.campaign_id
       and remaining_membership.profile_id = old.profile_id
      where remaining_source.queue_id = member.queue_id
        and remaining_source.is_active
    );

  if exists (
    select 1
    from public.agent_active_campaigns active_campaign
    where active_campaign.profile_id = old.profile_id
      and active_campaign.campaign_id = old.campaign_id
  ) then
    select membership.campaign_id
    into v_next_campaign_id
    from public.campaign_agents membership
    join public.campaigns campaign
      on campaign.id = membership.campaign_id
     and campaign.is_active
    join public.dialer_campaign_configs config
      on config.campaign_id = membership.campaign_id
     and config.is_active
     and config.dial_mode <> 'manual'
     and config.campaign_type = 'outbound'
    where membership.profile_id = old.profile_id
    order by membership.assigned_at, membership.id
    limit 1;

    if v_next_campaign_id is null then
      delete from public.agent_active_campaigns
      where profile_id = old.profile_id;
    else
      update public.agent_active_campaigns
      set campaign_id = v_next_campaign_id,
          updated_at = now()
      where profile_id = old.profile_id;
    end if;
  end if;

  return old;
end;
$function$;

revoke all on function public.reconcile_campaign_agent_operational_onboarding()
  from public, anon, authenticated;

drop trigger if exists campaign_agents_operational_onboarding
  on public.campaign_agents;
create trigger campaign_agents_operational_onboarding
  after insert or delete on public.campaign_agents
  for each row execute function public.reconcile_campaign_agent_operational_onboarding();

-- Reconciliación única de membresías previas: deja el estado actual bajo las
-- mismas reglas que regirán todas las altas futuras.
insert into public.contact_center_queue_members (queue_id, profile_id, is_active)
select distinct source.queue_id, membership.profile_id, true
from public.campaign_agents membership
join public.profiles profile
  on profile.id = membership.profile_id
 and profile.active
 and profile.role = 'agente'::public.app_role
join public.contact_center_queue_sources source
  on source.campaign_id = membership.campaign_id
 and source.is_active
join public.contact_center_queues queue
  on queue.id = source.queue_id
 and queue.is_active
on conflict (queue_id, profile_id) do update
set is_active = true;

update public.campaign_agents membership
set schedule_required = false
from public.campaigns campaign,
     public.dialer_campaign_configs config
where campaign.id = membership.campaign_id
  and campaign.is_active
  and config.campaign_id = membership.campaign_id
  and config.is_active
  and config.dial_mode <> 'manual'
  and config.campaign_type = 'outbound'
  and membership.schedule_required
  and not exists (
    select 1
    from public.campaign_agent_schedules schedule
    where schedule.campaign_agent_id = membership.id
  );

do $backfill$
declare
  v_profile_id uuid;
  v_next_extension integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(20260904, 152747);

  for v_profile_id in
    select distinct membership.profile_id
    from public.campaign_agents membership
    join public.profiles profile
      on profile.id = membership.profile_id
     and profile.active
     and profile.role = 'agente'::public.app_role
    join public.campaigns campaign
      on campaign.id = membership.campaign_id
     and campaign.is_active
    join public.dialer_campaign_configs config
      on config.campaign_id = membership.campaign_id
     and config.is_active
     and config.dial_mode <> 'manual'
     and config.campaign_type = 'outbound'
  loop
    if not exists (
      select 1 from public.agent_sip_credentials credentials
      where credentials.profile_id = v_profile_id
    ) then
      select greatest(
        6010,
        coalesce(max(
          case
            when credentials.extension ~ '^[0-9]{4,6}$'
              then credentials.extension::integer
            else null
          end
        ), 6009) + 1
      )
      into v_next_extension
      from public.agent_sip_credentials credentials;

      insert into public.agent_sip_credentials (
        profile_id, extension, sip_password, is_active
      ) values (
        v_profile_id,
        v_next_extension::text,
        pg_catalog.encode(extensions.gen_random_bytes(24), 'hex'),
        true
      );
    end if;
  end loop;
end;
$backfill$;

update public.agent_sip_credentials credentials
set is_active = true,
    updated_at = now()
where not credentials.is_active
  and exists (
    select 1
    from public.campaign_agents membership
    join public.profiles profile
      on profile.id = membership.profile_id
     and profile.active
     and profile.role = 'agente'::public.app_role
    join public.campaigns campaign
      on campaign.id = membership.campaign_id
     and campaign.is_active
    join public.dialer_campaign_configs config
      on config.campaign_id = membership.campaign_id
     and config.is_active
     and config.dial_mode <> 'manual'
     and config.campaign_type = 'outbound'
    where membership.profile_id = credentials.profile_id
  );

insert into public.agent_active_campaigns (profile_id, campaign_id, updated_at)
select distinct on (membership.profile_id)
  membership.profile_id,
  membership.campaign_id,
  now()
from public.campaign_agents membership
join public.profiles profile
  on profile.id = membership.profile_id
 and profile.active
 and profile.role = 'agente'::public.app_role
join public.campaigns campaign
  on campaign.id = membership.campaign_id
 and campaign.is_active
join public.dialer_campaign_configs config
  on config.campaign_id = membership.campaign_id
 and config.is_active
 and config.dial_mode <> 'manual'
 and config.campaign_type = 'outbound'
left join public.agent_active_campaigns active_campaign
  on active_campaign.profile_id = membership.profile_id
where active_campaign.profile_id is null
order by membership.profile_id, membership.assigned_at, membership.id
on conflict (profile_id) do nothing;
