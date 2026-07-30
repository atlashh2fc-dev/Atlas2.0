-- El monitor en vivo necesita la extensión SIP, pero `agent_sip_credentials`
-- contiene además la contraseña y ya no puede leerse por admin/supervisor.
-- La vista `agent_live_status` era security_invoker y su JOIN a esa tabla
-- quedaba vacío para ellos, dejando el monitor completo en cero. Esta función
-- expone únicamente los campos operativos necesarios y valida el rol antes de
-- ejecutar con privilegios de propietario.
create or replace function public.get_agent_live_status()
returns table (
  profile_id uuid,
  full_name text,
  email text,
  extension text,
  campaign_id uuid,
  campaign_name text,
  phone_status text,
  phone_status_since timestamptz,
  reason_id uuid,
  reason_code text,
  reason_label text,
  is_pause boolean,
  reason_since timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(public.current_role_name()::text, '') not in ('admin', 'supervisor') then
    raise exception 'get_agent_live_status solo puede ser llamada por admin o supervisor.';
  end if;

  return query
  select
    p.id,
    p.full_name,
    p.email,
    c.extension,
    s.campaign_id,
    camp.name,
    coalesce(s.status, 'offline'),
    s.last_state_change_at,
    r.id,
    r.code,
    r.label,
    coalesce(r.is_pause, false),
    st.since
  from public.profiles p
  join public.agent_sip_credentials c
    on c.profile_id = p.id
   and c.is_active = true
  left join lateral (
    select ds.*
    from public.dialer_agent_sessions ds
    join public.campaigns active_campaign
      on active_campaign.id = ds.campaign_id
     and active_campaign.is_active = true
    where ds.profile_id = p.id
    order by ds.updated_at desc
    limit 1
  ) s on true
  left join public.campaigns camp on camp.id = s.campaign_id
  left join public.agent_current_status st on st.profile_id = p.id
  left join public.agent_status_reasons r on r.id = st.reason_id
  where p.role = 'agente'
    and p.active = true
  order by p.full_name;
end;
$$;

revoke all on function public.get_agent_live_status() from public, anon;
grant execute on function public.get_agent_live_status() to authenticated;
