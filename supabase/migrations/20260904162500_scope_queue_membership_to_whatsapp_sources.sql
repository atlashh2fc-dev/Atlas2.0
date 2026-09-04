-- La membresía ACD actual gobierna el enrutamiento automático de WhatsApp.
-- Voz y correo conservan sus skills nativos en campaign_agents; conectarlos
-- como fuentes de una misma cola no debe convertir a sus ejecutivos en
-- receptores de WhatsApp.

begin;

drop index if exists public.contact_center_queue_sources_channel_campaign_uidx;

create unique index if not exists contact_center_queue_sources_non_routed_campaign_uidx
  on public.contact_center_queue_sources (channel_type, campaign_id)
  where campaign_id is not null
    and channel_type in ('voice', 'email');

do $scope_onboarding$
declare
  v_definition text;
  v_rewritten text;
begin
  select pg_get_functiondef(
    'public.reconcile_campaign_agent_operational_onboarding()'::regprocedure
  ) into v_definition;

  v_rewritten := replace(
    v_definition,
    'where source.campaign_id = new.campaign_id
      and source.is_active',
    'where source.campaign_id = new.campaign_id
      and source.channel_type = ''whatsapp''
      and source.is_active'
  );
  v_rewritten := replace(
    v_rewritten,
    'where removed_source.queue_id = member.queue_id
        and removed_source.campaign_id = old.campaign_id',
    'where removed_source.queue_id = member.queue_id
        and removed_source.campaign_id = old.campaign_id
        and removed_source.channel_type = ''whatsapp'''
  );
  v_rewritten := replace(
    v_rewritten,
    'where remaining_source.queue_id = member.queue_id
        and remaining_source.is_active',
    'where remaining_source.queue_id = member.queue_id
        and remaining_source.channel_type = ''whatsapp''
        and remaining_source.is_active'
  );

  if v_rewritten = v_definition
    or (length(v_rewritten) - length(replace(v_rewritten, 'channel_type = ''whatsapp''', ''))) <
       3 * length('channel_type = ''whatsapp''')
  then
    raise exception 'No se pudo limitar el onboarding ACD a fuentes WhatsApp.';
  end if;

  execute v_rewritten;
end;
$scope_onboarding$;

-- Restaura la membresía efectiva según las fuentes WhatsApp, sin borrar
-- historia ni afectar los skills de voz/correo.
update public.contact_center_queue_members member
set is_active = false
where member.is_active
  and not exists (
    select 1
    from public.contact_center_queue_sources source
    join public.campaign_agents membership
      on membership.campaign_id = source.campaign_id
     and membership.profile_id = member.profile_id
    join public.profiles profile
      on profile.id = membership.profile_id
     and profile.active
     and profile.role = 'agente'::public.app_role
    where source.queue_id = member.queue_id
      and source.channel_type = 'whatsapp'
      and source.is_active
  );

insert into public.contact_center_queue_members (queue_id, profile_id, is_active)
select distinct source.queue_id, membership.profile_id, true
from public.contact_center_queue_sources source
join public.campaign_agents membership
  on membership.campaign_id = source.campaign_id
join public.profiles profile
  on profile.id = membership.profile_id
 and profile.active
 and profile.role = 'agente'::public.app_role
where source.channel_type = 'whatsapp'
  and source.is_active
on conflict (queue_id, profile_id) do update
set is_active = true;

commit;
