-- Responder un correo lo deja atendido, pero la conversación todavía se
-- tipifica después. Quien tuvo el correo asignado sigue viendo al cliente y
-- puede abrir la gestión por correo durante 7 días, aunque ya no esté
-- pendiente y aunque el registro sea de otro ejecutivo.

create or replace function public.leads_de_mis_correos()
returns uuid[]
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select coalesce(array_agg(distinct correo.lead_id), '{}'::uuid[])
  from public.inbound_emails correo
  where correo.assigned_to = (select auth.uid())
    and correo.lead_id is not null
    and (correo.status = 'new' or correo.received_at >= now() - interval '7 days');
$$;

create or replace function public.begin_agent_offline_management(p_lead_id uuid, p_channel text)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_actor public.profiles%rowtype;
  v_lead public.leads%rowtype;
  v_call_id uuid;
  v_now timestamptz := now();
begin
  if v_actor_id is null then
    raise exception 'No autenticado.';
  end if;
  if p_channel is null or p_channel not in ('whatsapp', 'correo', 'presencial', 'otro') then
    raise exception 'Elige por qué canal fue el contacto.';
  end if;

  select * into v_actor
  from public.profiles
  where id = v_actor_id and role = 'agente' and active
  for update;
  if not found then
    raise exception 'Solo un ejecutivo activo puede registrar una gestión.';
  end if;

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'El registro no existe.';
  end if;
  perform public.assert_org_access(v_lead.organization_id);

  if v_actor_id is distinct from v_lead.managed_by
     and v_actor_id is distinct from v_lead.assigned_to
     and not exists (
       select 1 from public.inbound_emails correo
       where correo.lead_id = p_lead_id and correo.assigned_to = v_actor_id
         and (correo.status = 'new' or correo.received_at >= now() - interval '7 days')
     ) then
    raise exception 'Este registro no está a tu nombre. Pide a tu supervisor que te lo asigne.';
  end if;

  if exists (
    select 1 from public.calls c
    where c.agent_id = v_actor_id
      and c.ended_at is null
      and c.started_at >= v_now - interval '4 hours'
  ) then
    raise exception 'Tienes una gestión pendiente de tipificación. Ciérrala antes de registrar otra.';
  end if;

  if exists (
    select 1 from public.calls c
    where c.lead_id = p_lead_id and c.ended_at is null and c.started_at >= v_now - interval '4 hours'
  ) then
    raise exception 'Este registro ya tiene una gestión abierta.';
  end if;

  insert into public.calls (lead_id, agent_id, management_channel)
  values (p_lead_id, v_actor_id, p_channel)
  returning id into v_call_id;

  update public.leads
  set managed_by = coalesce(managed_by, v_actor_id), updated_at = v_now
  where id = p_lead_id;

  insert into public.call_events (call_id, lead_id, agent_id, event_type, payload)
  values (
    v_call_id, p_lead_id, v_actor_id, 'cti.offline_management_started',
    jsonb_build_object('channel', p_channel, 'campaign_id', v_lead.campaign_id)
  );

  insert into public.crm_audit_events (lead_id, crm_entity_id, actor_id, event_type, payload)
  values (
    p_lead_id, v_lead.crm_entity_id, v_actor_id, 'lead.offline_management_started',
    jsonb_build_object('call_id', v_call_id, 'channel', p_channel)
  );

  return jsonb_build_object('call_id', v_call_id, 'lead_id', p_lead_id, 'channel', p_channel);
end;
$function$;

revoke all on function public.begin_agent_offline_management(uuid, text) from public, anon;
grant execute on function public.begin_agent_offline_management(uuid, text) to authenticated;
