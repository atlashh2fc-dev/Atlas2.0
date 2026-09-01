-- Native Atlas Lead -> Atlas CRM mail operations.
-- Atlas Lead owns sending/provider delivery facts; Atlas CRM owns campaign
-- supervision, assignment and customer work. A mapping is always explicit:
-- this migration never creates a CRM campaign from a name or umbrella key.

begin;

insert into public.integration_sources (code, name, source_kind, provider, is_active)
values ('atlas_lead', 'Atlas Lead', 'mail_platform', 'atlas_lead', true)
on conflict (code) do update
set name = excluded.name,
    source_kind = excluded.source_kind,
    provider = excluded.provider,
    is_active = true,
    updated_at = now();

-- One authorization predicate for every mail read path. A supervisor receives
-- campaign scope only through a supervised team that already participates in
-- that campaign, either through a lead or an agent skill membership.
create or replace function public.can_supervise_campaign(p_campaign_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when public.request_is_service_role() then true
    when (select auth.uid()) is null then false
    when not exists (
      select 1
      from public.profiles actor
      where actor.id = (select auth.uid())
        and actor.active
    ) then false
    when (select public.current_role_name()) = 'admin'::public.app_role then true
    when (select public.current_role_name()) <> 'supervisor'::public.app_role then false
    else exists (
      select 1
      from public.leads lead
      where lead.campaign_id = p_campaign_id
        and lead.team_id = any(public.supervised_team_ids())
    ) or exists (
      select 1
      from public.campaign_agents membership
      join public.profiles agent on agent.id = membership.profile_id
      where membership.campaign_id = p_campaign_id
        and agent.role = 'agente'::public.app_role
        and agent.team_id = any(public.supervised_team_ids())
    )
  end;
$function$;

revoke all on function public.can_supervise_campaign(uuid) from public, anon;
grant execute on function public.can_supervise_campaign(uuid) to authenticated, service_role;

-- Campaign visibility is not contact visibility. In a multi-team campaign a
-- supervisor may only see contacts from a supervised team. A team-less lead is
-- visible only when one of the supervisor's teams has an active agent enabled
-- for that campaign, so the unassigned queue remains actionable without
-- exposing it to every supervisor who happens to share the campaign.
create or replace function public.can_supervise_mail_lead(
  p_campaign_id uuid,
  p_team_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when public.request_is_service_role() then true
    when (select auth.uid()) is null then false
    when not exists (
      select 1
      from public.profiles actor
      where actor.id = (select auth.uid())
        and actor.active
    ) then false
    when coalesce((select public.current_role_name())::text, '') = 'admin' then true
    when coalesce((select public.current_role_name())::text, '') <> 'supervisor' then false
    when p_team_id is not null then p_team_id = any(public.supervised_team_ids())
    else 1 = (
      select count(distinct agent.team_id)
      from public.campaign_agents membership
      join public.profiles agent on agent.id = membership.profile_id
      where membership.campaign_id = p_campaign_id
        and agent.role = 'agente'::public.app_role
        and agent.active
        and agent.team_id is not null
    ) and exists (
      select 1
      from public.campaign_agents membership
      join public.profiles agent on agent.id = membership.profile_id
      where membership.campaign_id = p_campaign_id
        and agent.role = 'agente'::public.app_role
        and agent.active
        and agent.team_id = any(public.supervised_team_ids())
    )
  end;
$function$;

revoke all on function public.can_supervise_mail_lead(uuid, uuid) from public, anon;
grant execute on function public.can_supervise_mail_lead(uuid, uuid)
  to authenticated, service_role;

-- Explicit control-plane operation. `external_campaign_key` is the canonical
-- Atlas Lead identity and `campaign_id` is the canonical Atlas CRM identity.
create or replace function public.map_atlas_lead_mail_campaign(
  p_external_campaign_key text,
  p_campaign_id uuid,
  p_name text,
  p_status text default 'active',
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_is_service boolean := public.request_is_service_role();
  v_external_key text := nullif(btrim(coalesce(p_external_campaign_key, '')), '');
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_status text := lower(btrim(coalesce(p_status, 'active')));
  v_source_id uuid;
  v_mail_campaign_id uuid;
  v_existing_campaign_id uuid;
  v_readiness text;
  v_routing_team_id uuid;
  v_routed_unassigned integer := 0;
begin
  if not v_is_service and (
    v_actor_id is null
    or coalesce((select public.current_role_name())::text, '') <> 'admin'
    or not exists (
      select 1 from public.profiles actor
      where actor.id = v_actor_id and actor.active
    )
  ) then
    raise exception 'Solo admin o service_role puede mapear campañas Atlas Lead.';
  end if;

  if v_external_key is null or length(v_external_key) > 300 then
    raise exception 'external_campaign_key es obligatorio y admite hasta 300 caracteres.';
  end if;
  if p_campaign_id is null or not exists (
    select 1 from public.campaigns campaign where campaign.id = p_campaign_id
  ) then
    raise exception 'La campaña CRM indicada no existe.';
  end if;
  if v_name is null or length(v_name) > 300 then
    raise exception 'El nombre de campaña Atlas Lead es obligatorio y admite hasta 300 caracteres.';
  end if;
  if v_status not in ('draft', 'active', 'paused', 'completed', 'archived') then
    raise exception 'Estado de campaña mail inválido.';
  end if;
  if jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then
    raise exception 'metadata debe ser un objeto JSON.';
  end if;
  begin
    v_routing_team_id := nullif(btrim(coalesce(p_metadata->>'routing_team_id', '')), '')::uuid;
  exception when invalid_text_representation then
    raise exception 'metadata.routing_team_id debe ser UUID.';
  end;
  if v_routing_team_id is null then
    raise exception 'metadata.routing_team_id es obligatorio.';
  end if;
  if not exists (
    select 1 from public.teams team where team.id = v_routing_team_id
  ) then
    raise exception 'El equipo de enrutamiento no existe.';
  end if;
  if not exists (
    select 1
    from public.campaign_agents membership
    join public.profiles agent on agent.id = membership.profile_id
    where membership.campaign_id = p_campaign_id
      and membership.profile_id = agent.id
      and agent.role = 'agente'::public.app_role
      and agent.active
      and agent.team_id = v_routing_team_id
  ) then
    raise exception 'El equipo de enrutamiento no tiene ejecutivos activos habilitados para la campaña.';
  end if;

  select source.id into v_source_id
  from public.integration_sources source
  where source.code = 'atlas_lead'
    and source.is_active;

  if v_source_id is null then
    raise exception 'La fuente atlas_lead no está activa.';
  end if;

  select mail_campaign.campaign_id
  into v_existing_campaign_id
  from public.mail_campaigns mail_campaign
  where mail_campaign.source_id = v_source_id
    and mail_campaign.external_campaign_key = v_external_key
  for update;

  if v_existing_campaign_id is not null and v_existing_campaign_id <> p_campaign_id then
    raise exception 'external_campaign_key ya está mapeada a otra campaña CRM.';
  end if;

  insert into public.mail_campaigns (
    campaign_id, source_id, external_campaign_key, name, umbrella_key,
    status, metadata, created_by
  ) values (
    p_campaign_id, v_source_id, v_external_key, v_name, 'atlas_lead',
    v_status,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'mapping_mode', 'explicit',
      'mapping_status', 'registered',
      'readiness', 'pending_handshake'
    ),
    v_actor_id
  )
  on conflict (source_id, external_campaign_key) do update
  set name = excluded.name,
      umbrella_key = 'atlas_lead',
      status = excluded.status,
      metadata = public.mail_campaigns.metadata || excluded.metadata || jsonb_build_object(
        'mapping_status', 'registered',
        'readiness', coalesce(public.mail_campaigns.metadata->>'readiness', 'pending_handshake')
      ),
      updated_at = now()
  where public.mail_campaigns.campaign_id = excluded.campaign_id
  returning id, metadata->>'readiness' into v_mail_campaign_id, v_readiness;

  -- The WHERE above also closes the concurrent remap race: a conflicting
  -- insert cannot mutate the canonical relationship and returns no row.
  if v_mail_campaign_id is null then
    raise exception 'external_campaign_key ya está mapeada a otra campaña CRM.';
  end if;

  update public.leads lead
  set team_id = v_routing_team_id,
      updated_at = now()
  where lead.campaign_id = p_campaign_id
    and lead.team_id is null
    and exists (
      select 1
      from public.mail_campaign_lead_status status
      where status.mail_campaign_id = v_mail_campaign_id
        and status.lead_id = lead.id
    );
  get diagnostics v_routed_unassigned = row_count;

  insert into public.crm_audit_events (actor_id, event_type, payload)
  values (
    v_actor_id,
    'mail_campaign.mapped',
    jsonb_build_object(
      'mail_campaign_id', v_mail_campaign_id,
      'external_campaign_key', v_external_key,
      'campaign_id', p_campaign_id,
      'status', v_status,
      'source', 'atlas_lead',
      'routing_team_id', v_routing_team_id,
      'mapping_status', 'registered',
      'readiness', v_readiness,
      'routed_unassigned_leads', v_routed_unassigned
    )
  );

  return jsonb_build_object(
    'mapped', true,
    'mail_campaign_id', v_mail_campaign_id,
    'campaign_id', p_campaign_id,
    'external_campaign_key', v_external_key,
    'source_id', v_source_id,
    'status', v_status,
    'routing_team_id', v_routing_team_id,
    'routed_unassigned_leads', v_routed_unassigned,
    'mapping_status', 'registered',
    'readiness', v_readiness
  );
end;
$function$;

revoke all on function public.map_atlas_lead_mail_campaign(text, uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.map_atlas_lead_mail_campaign(text, uuid, text, text, jsonb)
  to service_role;
grant execute on function public.map_atlas_lead_mail_campaign(text, uuid, text, text, jsonb)
  to authenticated;

-- Called only after the CRM server has received and validated Atlas Lead's
-- readiness ACK. The database records that acknowledgement; it never performs
-- remote HTTP or infers readiness from the existence of a mapping.
create or replace function public.confirm_atlas_lead_mail_campaign_handshake(
  p_external_campaign_key text,
  p_campaign_id uuid,
  p_readiness_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_is_service boolean := public.request_is_service_role();
  v_external_key text := nullif(btrim(coalesce(p_external_campaign_key, '')), '');
  v_mail_campaign_id uuid;
  v_confirmed_at timestamptz := now();
begin
  if not v_is_service and (
    v_actor_id is null
    or coalesce((select public.current_role_name())::text, '') <> 'admin'
    or not exists (
      select 1 from public.profiles actor
      where actor.id = v_actor_id and actor.active
    )
  ) then
    raise exception 'Solo admin o service_role puede confirmar el handshake Atlas Lead.';
  end if;

  if v_external_key is null or p_campaign_id is null then
    raise exception 'external_campaign_key y campaign_id son obligatorios.';
  end if;
  if jsonb_typeof(coalesce(p_readiness_metadata, '{}'::jsonb)) <> 'object' then
    raise exception 'readiness_metadata debe ser un objeto JSON.';
  end if;

  update public.mail_campaigns mail_campaign
  set metadata = mail_campaign.metadata || jsonb_build_object(
        'mapping_status', 'registered',
        'readiness', 'ready',
        'mapping_confirmed_at', v_confirmed_at,
        'readiness_metadata', coalesce(p_readiness_metadata, '{}'::jsonb)
      ),
      updated_at = now()
  from public.integration_sources source
  where source.id = mail_campaign.source_id
    and source.code = 'atlas_lead'
    and mail_campaign.external_campaign_key = v_external_key
    and mail_campaign.campaign_id = p_campaign_id
  returning mail_campaign.id into v_mail_campaign_id;

  if v_mail_campaign_id is null then
    raise exception 'No existe un mapping Atlas Lead para esa campaña CRM.';
  end if;

  insert into public.crm_audit_events (actor_id, event_type, payload)
  values (
    v_actor_id,
    'mail_campaign.handshake_confirmed',
    jsonb_build_object(
      'mail_campaign_id', v_mail_campaign_id,
      'external_campaign_key', v_external_key,
      'campaign_id', p_campaign_id,
      'readiness', 'ready',
      'confirmed_at', v_confirmed_at,
      'ack', coalesce(p_readiness_metadata, '{}'::jsonb)
    )
  );

  return jsonb_build_object(
    'confirmed', true,
    'mail_campaign_id', v_mail_campaign_id,
    'campaign_id', p_campaign_id,
    'external_campaign_key', v_external_key,
    'mapping_status', 'registered',
    'readiness', 'ready',
    'confirmed_at', v_confirmed_at
  );
end;
$function$;

revoke all on function public.confirm_atlas_lead_mail_campaign_handshake(text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.confirm_atlas_lead_mail_campaign_handshake(text, uuid, jsonb)
  to authenticated, service_role;

-- Keep the legacy signature for controlled compatibility, but it may only
-- update an existing mapping or create one when a CRM UUID is supplied.
create or replace function public.sync_atlas_lead_mail_campaign(
  p_external_campaign_key text,
  p_name text,
  p_umbrella_key text default 'equifax',
  p_description text default null,
  p_source_code text default 'atlas_lead',
  p_campaign_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_source_id uuid;
  v_campaign_id uuid := p_campaign_id;
  v_mapped_campaign_id uuid;
  v_existing_metadata jsonb := '{}'::jsonb;
begin
  if lower(btrim(coalesce(p_source_code, ''))) <> 'atlas_lead' then
    raise exception 'La función legacy solo admite la fuente atlas_lead.';
  end if;

  select source.id into v_source_id
  from public.integration_sources source
  where source.code = 'atlas_lead' and source.is_active;

  select mail_campaign.campaign_id, mail_campaign.metadata
  into v_mapped_campaign_id, v_existing_metadata
  from public.mail_campaigns mail_campaign
  where mail_campaign.source_id = v_source_id
    and mail_campaign.external_campaign_key = nullif(btrim(coalesce(p_external_campaign_key, '')), '')
  limit 1;

  if v_mapped_campaign_id is not null
    and p_campaign_id is not null
    and v_mapped_campaign_id <> p_campaign_id
  then
    raise exception 'external_campaign_key ya está mapeada a otra campaña CRM.';
  end if;
  v_campaign_id := coalesce(v_mapped_campaign_id, p_campaign_id);

  if v_campaign_id is null then
    raise exception 'La campaña Atlas Lead no tiene un mapping CRM explícito.';
  end if;

  return public.map_atlas_lead_mail_campaign(
    p_external_campaign_key,
    v_campaign_id,
    p_name,
    'active',
    coalesce(v_existing_metadata, '{}'::jsonb)
      || coalesce(p_metadata, '{}'::jsonb)
      || jsonb_strip_nulls(jsonb_build_object(
      'legacy_umbrella_key', nullif(btrim(coalesce(p_umbrella_key, '')), ''),
      'legacy_description', nullif(btrim(coalesce(p_description, '')), '')
    ))
  );
end;
$function$;

revoke all on function public.sync_atlas_lead_mail_campaign(text, text, text, text, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.sync_atlas_lead_mail_campaign(text, text, text, text, text, uuid, jsonb)
  to service_role;

-- Mail SELECT policies all share the same campaign authorization predicate.
drop policy if exists mail_campaigns_select on public.mail_campaigns;
create policy mail_campaigns_select on public.mail_campaigns
for select to authenticated
using ((select public.can_supervise_campaign(campaign_id)));

drop policy if exists mail_campaign_bases_select on public.mail_campaign_bases;
create policy mail_campaign_bases_select on public.mail_campaign_bases
for select to authenticated
using ((select public.can_supervise_campaign(campaign_id)));

drop policy if exists mail_campaign_base_recipients_select on public.mail_campaign_base_recipients;
create policy mail_campaign_base_recipients_select on public.mail_campaign_base_recipients
for select to authenticated
using (
  exists (
    select 1
    from public.leads lead
    where lead.id = mail_campaign_base_recipients.lead_id
      and public.can_supervise_mail_lead(
        mail_campaign_base_recipients.campaign_id,
        lead.team_id
      )
  )
  or (
    mail_campaign_base_recipients.lead_id is null
    and public.can_supervise_mail_lead(
      mail_campaign_base_recipients.campaign_id,
      null
    )
  )
);

drop policy if exists mail_result_batches_select on public.mail_result_batches;
create policy mail_result_batches_select on public.mail_result_batches
for select to authenticated
using ((select public.can_supervise_campaign(campaign_id)));

drop policy if exists mail_result_contacts_select on public.mail_result_contacts;
create policy mail_result_contacts_select on public.mail_result_contacts
for select to authenticated
using (
  exists (
    select 1
    from public.leads lead
    where lead.id = mail_result_contacts.lead_id
      and public.can_supervise_mail_lead(
        mail_result_contacts.campaign_id,
        lead.team_id
      )
  )
  or (
    mail_result_contacts.lead_id is null
    and public.can_supervise_mail_lead(mail_result_contacts.campaign_id, null)
  )
);

drop policy if exists lead_mail_status_select on public.lead_mail_status;
create policy lead_mail_status_select on public.lead_mail_status
for select to authenticated
using (
  exists (
    select 1
    from public.leads lead
    where lead.id = lead_mail_status.lead_id
      and public.can_supervise_mail_lead(lead_mail_status.campaign_id, lead.team_id)
  )
);

-- Replace the former role + Equifax umbrella shortcut in every current mail
-- read model. Guards make migration drift fail loudly instead of leaving an
-- accidentally broad SECURITY DEFINER function in place.
do $rewrite_mail_read_models$
declare
  v_signature text;
  v_definition text;
  v_rewritten text;
begin
  foreach v_signature in array array[
    'public.get_mail_engagement_page(uuid,uuid,integer,integer,timestamptz,uuid)',
    'public.get_mail_engagement_report_read_model(uuid,uuid)',
    'public.get_mail_agent_control_summary_read_model(uuid,uuid)',
    'public.get_mail_operational_bucket_summary(uuid,uuid)',
    'public.get_mail_operational_queue_page(uuid,uuid,text,integer,integer,integer,timestamptz,uuid)'
  ] loop
    select pg_get_functiondef(v_signature::regprocedure) into v_definition;
    -- Most read models already have a business predicate before the former
    -- role filter, but the aggregate report starts its WHERE clause with that
    -- filter. Rewrite both shapes explicitly so production formatting drift
    -- cannot leave the legacy Equifax-only supervisor shortcut behind.
    v_rewritten := regexp_replace(
      v_definition,
      '[[:space:]]+where \(ac\.is_service or ac\.actor_role in \(''admin'', ''supervisor''\)\)[[:space:]]+and \(ac\.is_service or ac\.actor_role <> ''supervisor'' or mc\.umbrella_key = ''equifax''\)',
      E'\n  where public.can_supervise_mail_lead(s.campaign_id, l.team_id)',
      'g'
    );
    v_rewritten := regexp_replace(
      v_rewritten,
      '[[:space:]]+and \(ac\.is_service or ac\.actor_role in \(''admin'', ''supervisor''\)\)[[:space:]]+and \(ac\.is_service or ac\.actor_role <> ''supervisor'' or mc\.umbrella_key = ''equifax''\)',
      E'\n    and public.can_supervise_mail_lead(s.campaign_id, l.team_id)',
      'g'
    );

    if v_rewritten = v_definition or v_rewritten like '%mc.umbrella_key = ''equifax''%' then
      raise exception 'No se pudo centralizar el alcance del read model %.', v_signature;
    end if;

    execute v_rewritten;
    execute format('alter function %s set search_path = %L', v_signature, '');
  end loop;
end;
$rewrite_mail_read_models$;

-- One database transaction for the entire supervisor decision. Every target is
-- validated before any assignment row changes; an exception rolls back all
-- lead, history and audit writes from the RPC.
create or replace function public.assign_mail_engagement_opportunities(
  p_lead_ids uuid[],
  p_agent_id uuid,
  p_mail_campaign_id uuid default null,
  p_campaign_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_actor_role text := coalesce((select public.current_role_name())::text, '');
  v_lead_ids uuid[];
  v_campaign_ids uuid[];
  v_visible_count integer := 0;
  v_assigned_count integer := 0;
  v_agent_team_id uuid;
begin
  if v_actor_id is null or v_actor_role not in ('admin', 'supervisor') then
    raise exception 'No tienes permisos para asignar oportunidades mail.';
  end if;
  perform actor.id
  from public.profiles actor
  where actor.id = v_actor_id and actor.active
  for key share;
  if not found then
    raise exception 'La sesión no pertenece a un usuario activo.';
  end if;

  if v_actor_role = 'supervisor' then
    perform team.id
    from public.teams team
    where team.supervisor_id = v_actor_id
    order by team.id
    for key share;
  end if;

  select array_agg(candidate.lead_id order by candidate.lead_id)
  into v_lead_ids
  from (
    select distinct lead_id
    from unnest(coalesce(p_lead_ids, array[]::uuid[])) as input(lead_id)
    where lead_id is not null
  ) candidate;

  if coalesce(cardinality(v_lead_ids), 0) < 1 then
    raise exception 'Selecciona al menos una oportunidad mail.';
  end if;
  if cardinality(v_lead_ids) > 100 then
    raise exception 'La asignación mail admite como máximo 100 oportunidades.';
  end if;

  select agent.team_id into v_agent_team_id
  from public.profiles agent
  where agent.id = p_agent_id
    and agent.role = 'agente'::public.app_role
    and agent.active
  for key share;

  if not found or v_agent_team_id is null then
    raise exception 'El ejecutivo destino no existe, no está activo o no tiene equipo.';
  end if;

  if v_actor_role = 'supervisor'
    and not (v_agent_team_id = any(public.supervised_team_ids()))
  then
    raise exception 'El ejecutivo destino no pertenece a un equipo supervisado.';
  end if;

  if p_mail_campaign_id is not null and not exists (
    select 1
    from public.mail_campaigns mail_campaign
    where mail_campaign.id = p_mail_campaign_id
      and (p_campaign_id is null or mail_campaign.campaign_id = p_campaign_id)
      and public.can_supervise_campaign(mail_campaign.campaign_id)
  ) then
    raise exception 'La campaña mail no existe o está fuera de tu alcance.';
  end if;

  -- Lock before the authoritative validation. This closes the TOCTOU window
  -- where another transaction could move a lead between the precheck and the
  -- assignment. UUID order keeps overlapping batch locks deterministic.
  perform lead.id
  from public.leads lead
  where lead.id = any(v_lead_ids)
  order by lead.id
  for update;

  if (select count(*) from public.leads lead where lead.id = any(v_lead_ids))
    <> cardinality(v_lead_ids)
  then
    raise exception 'Una o más oportunidades ya no existen.';
  end if;

  -- Every invariant below is re-read while the selected lead rows remain
  -- locked, immediately before the first mutation.
  with visible as (
    select distinct status.lead_id, status.campaign_id
    from public.mail_campaign_lead_status status
    join public.leads lead
      on lead.id = status.lead_id
     and lead.campaign_id = status.campaign_id
    where status.lead_id = any(v_lead_ids)
      and (status.opened or status.clicked)
      and (p_mail_campaign_id is null or status.mail_campaign_id = p_mail_campaign_id)
      and (p_campaign_id is null or status.campaign_id = p_campaign_id)
      and public.can_supervise_mail_lead(status.campaign_id, lead.team_id)
  )
  select count(distinct visible.lead_id)::integer,
         array_agg(distinct visible.campaign_id order by visible.campaign_id)
  into v_visible_count, v_campaign_ids
  from visible;

  if v_visible_count <> cardinality(v_lead_ids) then
    raise exception 'Una o más oportunidades no son mail, no están priorizadas o están fuera de tu alcance.';
  end if;

  -- Lock candidate memberships first, then validate the complete set. A
  -- concurrent delete either wins before the lock and is observed as missing,
  -- or waits until this assignment commits.
  perform membership.campaign_id
  from public.campaign_agents membership
  where membership.profile_id = p_agent_id
    and membership.campaign_id = any(v_campaign_ids)
  order by membership.campaign_id
  for key share;

  if exists (
    select 1
    from unnest(v_campaign_ids) as scoped(campaign_id)
    where not exists (
      select 1
      from public.campaign_agents membership
      where membership.campaign_id = scoped.campaign_id
        and membership.profile_id = p_agent_id
    )
  ) then
    raise exception 'El ejecutivo destino no tiene habilitada una de las campañas seleccionadas.';
  end if;

  if exists (
    select 1
    from public.leads lead
    where lead.id = any(v_lead_ids)
      and lead.team_id is not null
      and lead.team_id <> v_agent_team_id
  ) then
    raise exception 'Una o más oportunidades pertenecen a otro equipo.';
  end if;

  update public.lead_assignments assignment
  set is_active = false,
      ends_at = now(),
      updated_at = now()
  where assignment.lead_id = any(v_lead_ids)
    and assignment.is_active;

  insert into public.lead_assignments (
    lead_id, assigned_to, assigned_by, team_id, campaign_id, reason,
    source, is_active, starts_at
  )
  select lead.id, p_agent_id, v_actor_id, coalesce(lead.team_id, v_agent_team_id),
    lead.campaign_id, 'Lead priorizado por apertura/click de mailing',
    'mail_engagement', true, now()
  from public.leads lead
  where lead.id = any(v_lead_ids)
  order by lead.id;

  with before_state as materialized (
    select lead.id, lead.crm_entity_id, lead.assigned_to as old_assigned_to,
      coalesce(lead.team_id, v_agent_team_id) as effective_team_id,
      lead.campaign_id
    from public.leads lead
    where lead.id = any(v_lead_ids)
  ), updated as (
    update public.leads lead
    set assigned_to = p_agent_id,
        team_id = before_state.effective_team_id,
        assignment_status = 'assigned',
        updated_at = now()
    from before_state
    where lead.id = before_state.id
    returning lead.id, lead.crm_entity_id, before_state.old_assigned_to,
      before_state.effective_team_id, before_state.campaign_id
  ), audited as (
    insert into public.crm_audit_events (
      lead_id, crm_entity_id, actor_id, event_type, payload
    )
    select updated.id, updated.crm_entity_id, v_actor_id, 'lead.assigned',
      jsonb_build_object(
        'old_assigned_to', updated.old_assigned_to,
        'new_assigned_to', p_agent_id,
        'team_id', updated.effective_team_id,
        'campaign_id', updated.campaign_id,
        'set_managed_by', false,
        'next_action_at', null,
        'reason', 'Lead priorizado por apertura/click de mailing',
        'source', 'mail_engagement',
        'mail_campaign_id', p_mail_campaign_id
      )
    from updated
    returning lead_id
  )
  select count(*)::integer into v_assigned_count from audited;

  if v_assigned_count <> cardinality(v_lead_ids) then
    raise exception 'La asignación atómica no alcanzó todas las oportunidades.';
  end if;

  return jsonb_build_object(
    'assigned', v_assigned_count,
    'requested', cardinality(v_lead_ids),
    'lead_ids', to_jsonb(v_lead_ids),
    'agent_id', p_agent_id,
    'campaign_ids', to_jsonb(v_campaign_ids),
    'mail_campaign_id', p_mail_campaign_id,
    'source', 'mail_engagement'
  );
end;
$function$;

revoke all on function public.assign_mail_engagement_opportunities(uuid[], uuid, uuid, uuid)
  from public, anon;
grant execute on function public.assign_mail_engagement_opportunities(uuid[], uuid, uuid, uuid)
  to authenticated;

-- Optional delivery/message detail remains compact in the operational
-- projection; the immutable inbox item continues to be the raw event ledger.
alter table public.lead_mail_status
  add column if not exists last_event_semantics text not null default 'atomic_event';

alter table public.mail_campaign_lead_status
  add column if not exists last_event_semantics text not null default 'atomic_event',
  add column if not exists last_delivery_id text,
  add column if not exists last_message_id text,
  add column if not exists last_message_subject text,
  add column if not exists last_event_kind text,
  add column if not exists last_link_url text,
  add column if not exists last_provider_event_id text;

alter table public.lead_mail_status
  drop constraint if exists lead_mail_status_event_semantics_check;
alter table public.lead_mail_status
  add constraint lead_mail_status_event_semantics_check
  check (last_event_semantics in ('atomic_event', 'cumulative_snapshot'));

alter table public.mail_campaign_lead_status
  drop constraint if exists mail_campaign_lead_status_event_semantics_check;
alter table public.mail_campaign_lead_status
  add constraint mail_campaign_lead_status_event_semantics_check
  check (last_event_semantics in ('atomic_event', 'cumulative_snapshot'));

-- A canonical Atlas Lead contact can be materialized only behind an explicit
-- mail_campaign mapping. The source/campaign/external key tuple is locked and
-- stored in lead_external_refs, making a replay idempotent and concurrent
-- workers deterministic. This helper is intentionally not an ingestion API.
create or replace function public.materialize_atlas_lead_mail_roster_item(
  p_source_id uuid,
  p_campaign_id uuid,
  p_external_key text,
  p_payload jsonb,
  p_occurred_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_external_key text := nullif(btrim(coalesce(p_external_key, '')), '');
  v_external_campaign_key text := nullif(btrim(coalesce(p_payload->>'external_campaign_key', '')), '');
  v_email text := public.atlas_normalize_email(p_payload->>'email');
  v_phone text := nullif(btrim(coalesce(p_payload->>'phone', '')), '');
  v_contact_name text := nullif(btrim(coalesce(p_payload->>'contact_name', '')), '');
  v_company_name text := nullif(btrim(coalesce(p_payload->>'company_name', '')), '');
  v_lead_id uuid;
  v_workflow_id uuid;
  v_email_matches integer := 0;
  v_phone_matches integer := 0;
  v_matched_by text := 'atlas_lead_roster';
  v_routing_team_id uuid;
begin
  if not public.request_is_service_role() then
    raise exception 'materialize_atlas_lead_mail_roster_item requiere service_role.';
  end if;

  if v_external_key is null or v_email is null then
    return null;
  end if;

  select (mail_campaign.metadata->>'routing_team_id')::uuid
  into v_routing_team_id
    from public.mail_campaigns mail_campaign
    join public.integration_sources source on source.id = mail_campaign.source_id
    where mail_campaign.source_id = p_source_id
      and source.code = 'atlas_lead'
      and source.is_active
      and mail_campaign.campaign_id = p_campaign_id
      and mail_campaign.external_campaign_key = v_external_campaign_key;

  if v_routing_team_id is null then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    concat_ws('|', p_source_id::text, p_campaign_id::text, v_external_key),
    0
  ));

  select reference.lead_id,
    coalesce(nullif(reference.source_payload->>'matched_by', ''), 'existing_external_ref')
  into v_lead_id, v_matched_by
  from public.lead_external_refs reference
  where reference.source_id = p_source_id
    and reference.campaign_id = p_campaign_id
    and reference.external_key = v_external_key
  for update;

  if v_lead_id is null then
    select count(*), (array_agg(lead.id order by lead.id))[1]
    into v_email_matches, v_lead_id
    from public.leads lead
    where lead.campaign_id = p_campaign_id
      and public.atlas_normalize_email(lead.email) = v_email;

    -- An ambiguous email is not a safe identity match. The stable external key
    -- gets its own CRM lead instead of being attached to the wrong person.
    if v_email_matches = 1 then
      v_matched_by := 'unique_email_roster';
    elsif v_email_matches > 1 then
      v_lead_id := null;
    end if;
  end if;

  -- Respect the CRM campaign-level phone identity already enforced by
  -- leads_dedup_phone_idx. A single phone match is the same native lead, not a
  -- second contact created only because Atlas Lead supplied another email.
  if v_lead_id is null and v_phone is not null then
    select count(*), (array_agg(lead.id order by lead.id))[1]
    into v_phone_matches, v_lead_id
    from public.leads lead
    where lead.campaign_id = p_campaign_id
      and lead.rut is null
      and lead.phone is not null
      and btrim(lead.phone) <> ''
      and regexp_replace(lead.phone, '[^0-9]', '', 'g')
        = regexp_replace(v_phone, '[^0-9]', '', 'g');

    if v_phone_matches = 1 then
      v_matched_by := 'unique_phone_roster';
    elsif v_phone_matches > 1 then
      v_lead_id := null;
    end if;
  end if;

  -- Email remains the stronger match. If its lead has no phone but the
  -- incoming phone belongs to another deduplicated lead, preserve both
  -- identities and keep the incoming phone only in the immutable event.
  if v_lead_id is not null and v_phone is not null and exists (
    select 1
    from public.leads other
    where other.campaign_id = p_campaign_id
      and other.id <> v_lead_id
      and other.rut is null
      and other.phone is not null
      and btrim(other.phone) <> ''
      and regexp_replace(other.phone, '[^0-9]', '', 'g')
        = regexp_replace(v_phone, '[^0-9]', '', 'g')
  ) then
    v_phone := null;
  end if;

  if v_lead_id is null then
    select campaign.workflow_id into v_workflow_id
    from public.campaigns campaign
    where campaign.id = p_campaign_id;

    if not found then
      return null;
    end if;

    insert into public.leads (
      full_name, phone, email, status, team_id, workflow_id, campaign_id,
      created_by, assignment_status, workflow_status,
      external_last_source_code, external_last_seen_at, extra
    ) values (
      coalesce(v_contact_name, v_company_name, v_email, v_external_key),
      v_phone,
      v_email,
      'nuevo',
      v_routing_team_id,
      v_workflow_id,
      p_campaign_id,
      null,
      'unassigned',
      'pending',
      'atlas_lead',
      coalesce(p_occurred_at, now()),
      jsonb_strip_nulls(jsonb_build_object(
        'external_source', 'atlas_lead',
        'atlas_lead_external_key', v_external_key,
        'source_lead_id', nullif(btrim(coalesce(p_payload->>'source_lead_id', '')), ''),
        'company_name', v_company_name,
        'contact_name', v_contact_name,
        'country', nullif(btrim(coalesce(p_payload->>'country', '')), '')
      ))
    )
    returning id into v_lead_id;
  else
    update public.leads lead
    set email = coalesce(public.atlas_normalize_email(lead.email), v_email),
        phone = coalesce(nullif(btrim(lead.phone), ''), v_phone),
        team_id = coalesce(lead.team_id, v_routing_team_id),
        external_last_source_code = 'atlas_lead',
        external_last_seen_at = greatest(
          coalesce(lead.external_last_seen_at, '-infinity'::timestamptz),
          coalesce(p_occurred_at, now())
        ),
        extra = coalesce(lead.extra, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
          'source_lead_id', nullif(btrim(coalesce(p_payload->>'source_lead_id', '')), ''),
          'company_name', v_company_name,
          'contact_name', v_contact_name,
          'country', nullif(btrim(coalesce(p_payload->>'country', '')), '')
        )),
        updated_at = now()
    where lead.id = v_lead_id;
  end if;

  insert into public.lead_external_refs (
    source_id, campaign_id, lead_id, external_key, source_payload,
    first_seen_at, last_seen_at
  ) values (
    p_source_id, p_campaign_id, v_lead_id, v_external_key,
    jsonb_strip_nulls(jsonb_build_object(
      'matched_by', v_matched_by,
      'external_campaign_key', v_external_campaign_key,
      'source_lead_id', nullif(btrim(coalesce(p_payload->>'source_lead_id', '')), '')
    )),
    coalesce(p_occurred_at, now()),
    coalesce(p_occurred_at, now())
  )
  on conflict (source_id, campaign_id, external_key) do update
  set last_seen_at = greatest(public.lead_external_refs.last_seen_at, excluded.last_seen_at),
      source_payload = public.lead_external_refs.source_payload || excluded.source_payload
  where public.lead_external_refs.lead_id = excluded.lead_id
  returning lead_id into v_lead_id;

  if v_lead_id is null then
    raise exception 'external_key Atlas Lead entró en conflicto con otro lead CRM.';
  end if;

  return v_lead_id;
end;
$function$;

revoke all on function public.materialize_atlas_lead_mail_roster_item(
  uuid, uuid, text, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.materialize_atlas_lead_mail_roster_item(
  uuid, uuid, text, jsonb, timestamptz
) to service_role;

-- Atomic events increment occurrence counters. Cumulative snapshots advance
-- state monotonically but use greatest(existing, snapshot) so replaying a newer
-- snapshot does not manufacture another open/click occurrence.
create or replace function public.apply_engagement_events_v2(
  p_worker_id text, p_item_ids uuid[]
)
returns table (item_id uuid, success boolean, error_code text)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_roster_item record;
begin
  if coalesce(cardinality(p_item_ids), 0) > 500 then
    raise exception 'integration_v2_batch_limit';
  end if;

  -- The first signed `sent` event may carry the exported roster record. It can
  -- create a lead/ref only after the canonical campaign mapping already exists.
  for v_roster_item in
    select item.source_id, batch.campaign_id, item.external_key,
      item.payload, item.occurred_at
    from public.integration_inbox_items item
    join public.integration_inbox_batches batch on batch.id = item.batch_id
    join public.integration_sources source on source.id = item.source_id
    where item.id = any(coalesce(p_item_ids, array[]::uuid[]))
      and item.status = 'processing'
      and item.lease_owner = btrim(p_worker_id)
      and item.event_type = 'engagement.event.v1'
      and source.code = 'atlas_lead'
      and source.is_active
      and nullif(btrim(item.payload->>'event_kind'), '') = 'sent'
  loop
    perform public.materialize_atlas_lead_mail_roster_item(
      v_roster_item.source_id,
      v_roster_item.campaign_id,
      v_roster_item.external_key,
      v_roster_item.payload,
      v_roster_item.occurred_at
    );
  end loop;

  return query
  with input as (
    select i.id, i.source_id, i.external_key, i.occurred_at, i.payload, b.campaign_id,
      public.atlas_normalize_email(i.payload->>'email') as email_normalized,
      nullif(btrim(i.payload->>'event_kind'), '') as event_kind,
      coalesce(nullif(btrim(i.payload->>'event_semantics'), ''), 'atomic_event') as event_semantics,
      public.atlas_boolish(i.payload->>'sent') or coalesce(i.payload->>'event_kind' = 'sent', false) as sent,
      public.atlas_boolish(i.payload->>'delivered') or coalesce(i.payload->>'event_kind' = 'delivered', false) as delivered,
      public.atlas_boolish(i.payload->>'bounced') or coalesce(i.payload->>'event_kind' = 'bounced', false) as bounced,
      public.atlas_boolish(i.payload->>'opened') or coalesce(i.payload->>'event_kind' = 'opened', false) as opened,
      public.atlas_boolish(i.payload->>'clicked') or coalesce(i.payload->>'event_kind' = 'clicked', false) as clicked,
      public.atlas_boolish(i.payload->>'complained') or coalesce(i.payload->>'event_kind' = 'complained', false) as complained,
      public.atlas_boolish(i.payload->>'unsubscribed') or coalesce(i.payload->>'event_kind' = 'unsubscribed', false) as unsubscribed,
      nullif(btrim(i.payload->>'external_campaign_key'), '') as external_campaign_key,
      nullif(btrim(i.payload->>'delivery_id'), '') as delivery_id,
      nullif(btrim(i.payload->>'message_id'), '') as message_id,
      nullif(btrim(i.payload->>'message_subject'), '') as message_subject,
      nullif(btrim(i.payload->>'link_url'), '') as link_url,
      nullif(btrim(i.payload->>'provider_event_id'), '') as provider_event_id
    from public.integration_inbox_items i
    join public.integration_inbox_batches b on b.id = i.batch_id
    where i.id = any(coalesce(p_item_ids, array[]::uuid[]))
      and i.status = 'processing'
      and i.lease_owner = btrim(p_worker_id)
      and i.event_type = 'engagement.event.v1'
  ), email_matches as (
    select input.id, (array_agg(lead.id order by lead.id))[1] as lead_id, count(*) as matches
    from input
    join public.leads lead
      on lead.campaign_id = input.campaign_id
     and public.atlas_normalize_email(lead.email) = input.email_normalized
    where input.email_normalized is not null
    group by input.id
  ), resolved as (
    select input.*,
      coalesce(reference.lead_id, case when email_match.matches = 1 then email_match.lead_id end) as lead_id,
      mail_campaign.id as mail_campaign_id,
      projected.integration_item_id as projected_item_id,
      input.event_semantics in ('atomic_event', 'cumulative_snapshot') as semantics_valid,
      (input.event_kind is null or input.event_kind in (
        'sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained', 'unsubscribed'
      )) as event_kind_valid
    from input
    left join public.lead_external_refs reference
      on reference.source_id = input.source_id
     and reference.campaign_id = input.campaign_id
     and reference.external_key = input.external_key
    left join email_matches email_match on email_match.id = input.id
    left join public.mail_campaigns mail_campaign
      on mail_campaign.source_id = input.source_id
     and mail_campaign.campaign_id = input.campaign_id
     and mail_campaign.external_campaign_key = input.external_campaign_key
    left join public.external_lead_events projected on projected.integration_item_id = input.id
  ), valid as (
    select resolved.*,
      public.atlas_mail_priority_bucket(
        clicked, opened, bounced, complained, unsubscribed, delivered, sent
      ) as bucket
    from resolved
    where lead_id is not null
      and mail_campaign_id is not null
      and projected_item_id is null
      and semantics_valid
      and event_kind_valid
  ), grouped as (
    select campaign_id, lead_id,
      min(occurred_at) as first_seen_at,
      max(occurred_at) as last_seen_at,
      max(email_normalized) as email_normalized,
      bool_or(sent) as sent,
      bool_or(delivered) as delivered,
      bool_or(bounced) as bounced,
      bool_or(opened) as opened,
      bool_or(clicked) as clicked,
      bool_or(complained) as complained,
      bool_or(unsubscribed) as unsubscribed,
      case when bool_and(event_semantics = 'cumulative_snapshot')
        then max(sent::integer) else count(*) filter (where sent) end::integer as sent_count,
      case when bool_and(event_semantics = 'cumulative_snapshot')
        then max(delivered::integer) else count(*) filter (where delivered) end::integer as delivered_count,
      case when bool_and(event_semantics = 'cumulative_snapshot')
        then max(bounced::integer) else count(*) filter (where bounced) end::integer as bounced_count,
      case when bool_and(event_semantics = 'cumulative_snapshot')
        then max(opened::integer) else count(*) filter (where opened) end::integer as opened_count,
      case when bool_and(event_semantics = 'cumulative_snapshot')
        then max(clicked::integer) else count(*) filter (where clicked) end::integer as clicked_count,
      case when bool_and(event_semantics = 'cumulative_snapshot')
        then max(complained::integer) else count(*) filter (where complained) end::integer as complained_count,
      case when bool_and(event_semantics = 'cumulative_snapshot')
        then max(unsubscribed::integer) else count(*) filter (where unsubscribed) end::integer as unsubscribed_count,
      case when bool_and(event_semantics = 'cumulative_snapshot')
        then 'cumulative_snapshot' else 'atomic_event' end as event_semantics
    from valid
    group by campaign_id, lead_id
  ), lead_projection as (
    insert into public.lead_mail_status (
      campaign_id, lead_id, email_normalized, first_seen_at, last_seen_at,
      sent, delivered, bounced, opened, clicked, complained, unsubscribed,
      sent_count, delivered_count, bounced_count, opened_count, clicked_count,
      complained_count, unsubscribed_count, priority_bucket, priority_rank,
      priority_reason, last_event_semantics
    )
    select grouped.campaign_id, grouped.lead_id, grouped.email_normalized,
      grouped.first_seen_at, grouped.last_seen_at,
      grouped.sent, grouped.delivered, grouped.bounced, grouped.opened,
      grouped.clicked, grouped.complained, grouped.unsubscribed,
      grouped.sent_count, grouped.delivered_count, grouped.bounced_count,
      grouped.opened_count, grouped.clicked_count, grouped.complained_count,
      grouped.unsubscribed_count,
      public.atlas_mail_priority_bucket(
        grouped.clicked, grouped.opened, grouped.bounced, grouped.complained,
        grouped.unsubscribed, grouped.delivered, grouped.sent
      ),
      public.atlas_mail_priority_rank(public.atlas_mail_priority_bucket(
        grouped.clicked, grouped.opened, grouped.bounced, grouped.complained,
        grouped.unsubscribed, grouped.delivered, grouped.sent
      )),
      public.atlas_mail_priority_reason(public.atlas_mail_priority_bucket(
        grouped.clicked, grouped.opened, grouped.bounced, grouped.complained,
        grouped.unsubscribed, grouped.delivered, grouped.sent
      )),
      grouped.event_semantics
    from grouped
    on conflict (campaign_id, lead_id) do update set
      email_normalized = coalesce(excluded.email_normalized, public.lead_mail_status.email_normalized),
      first_seen_at = least(public.lead_mail_status.first_seen_at, excluded.first_seen_at),
      last_seen_at = greatest(public.lead_mail_status.last_seen_at, excluded.last_seen_at),
      sent = public.lead_mail_status.sent or excluded.sent,
      delivered = public.lead_mail_status.delivered or excluded.delivered,
      bounced = public.lead_mail_status.bounced or excluded.bounced,
      opened = public.lead_mail_status.opened or excluded.opened,
      clicked = public.lead_mail_status.clicked or excluded.clicked,
      complained = public.lead_mail_status.complained or excluded.complained,
      unsubscribed = public.lead_mail_status.unsubscribed or excluded.unsubscribed,
      sent_count = case when excluded.last_event_semantics = 'cumulative_snapshot'
        then greatest(public.lead_mail_status.sent_count, excluded.sent_count)
        else public.lead_mail_status.sent_count + excluded.sent_count end,
      delivered_count = case when excluded.last_event_semantics = 'cumulative_snapshot'
        then greatest(public.lead_mail_status.delivered_count, excluded.delivered_count)
        else public.lead_mail_status.delivered_count + excluded.delivered_count end,
      bounced_count = case when excluded.last_event_semantics = 'cumulative_snapshot'
        then greatest(public.lead_mail_status.bounced_count, excluded.bounced_count)
        else public.lead_mail_status.bounced_count + excluded.bounced_count end,
      opened_count = case when excluded.last_event_semantics = 'cumulative_snapshot'
        then greatest(public.lead_mail_status.opened_count, excluded.opened_count)
        else public.lead_mail_status.opened_count + excluded.opened_count end,
      clicked_count = case when excluded.last_event_semantics = 'cumulative_snapshot'
        then greatest(public.lead_mail_status.clicked_count, excluded.clicked_count)
        else public.lead_mail_status.clicked_count + excluded.clicked_count end,
      complained_count = case when excluded.last_event_semantics = 'cumulative_snapshot'
        then greatest(public.lead_mail_status.complained_count, excluded.complained_count)
        else public.lead_mail_status.complained_count + excluded.complained_count end,
      unsubscribed_count = case when excluded.last_event_semantics = 'cumulative_snapshot'
        then greatest(public.lead_mail_status.unsubscribed_count, excluded.unsubscribed_count)
        else public.lead_mail_status.unsubscribed_count + excluded.unsubscribed_count end,
      priority_bucket = public.atlas_mail_priority_bucket(
        public.lead_mail_status.clicked or excluded.clicked,
        public.lead_mail_status.opened or excluded.opened,
        public.lead_mail_status.bounced or excluded.bounced,
        public.lead_mail_status.complained or excluded.complained,
        public.lead_mail_status.unsubscribed or excluded.unsubscribed,
        public.lead_mail_status.delivered or excluded.delivered,
        public.lead_mail_status.sent or excluded.sent
      ),
      priority_rank = public.atlas_mail_priority_rank(public.atlas_mail_priority_bucket(
        public.lead_mail_status.clicked or excluded.clicked,
        public.lead_mail_status.opened or excluded.opened,
        public.lead_mail_status.bounced or excluded.bounced,
        public.lead_mail_status.complained or excluded.complained,
        public.lead_mail_status.unsubscribed or excluded.unsubscribed,
        public.lead_mail_status.delivered or excluded.delivered,
        public.lead_mail_status.sent or excluded.sent
      )),
      priority_reason = public.atlas_mail_priority_reason(public.atlas_mail_priority_bucket(
        public.lead_mail_status.clicked or excluded.clicked,
        public.lead_mail_status.opened or excluded.opened,
        public.lead_mail_status.bounced or excluded.bounced,
        public.lead_mail_status.complained or excluded.complained,
        public.lead_mail_status.unsubscribed or excluded.unsubscribed,
        public.lead_mail_status.delivered or excluded.delivered,
        public.lead_mail_status.sent or excluded.sent
      )),
      last_event_semantics = excluded.last_event_semantics,
      updated_at = now()
    returning campaign_id, lead_id, priority_bucket, priority_rank,
      priority_reason, last_seen_at
  ), mail_grouped as (
    select mail_campaign_id, campaign_id, lead_id,
      min(occurred_at) as first_seen_at,
      max(occurred_at) as last_seen_at,
      max(email_normalized) as email_normalized,
      bool_or(sent) as sent,
      bool_or(delivered) as delivered,
      bool_or(bounced) as bounced,
      bool_or(opened) as opened,
      bool_or(clicked) as clicked,
      bool_or(complained) as complained,
      bool_or(unsubscribed) as unsubscribed,
      case when bool_and(event_semantics = 'cumulative_snapshot')
        then max(sent::integer) else count(*) filter (where sent) end::integer as sent_count,
      case when bool_and(event_semantics = 'cumulative_snapshot')
        then max(delivered::integer) else count(*) filter (where delivered) end::integer as delivered_count,
      case when bool_and(event_semantics = 'cumulative_snapshot')
        then max(bounced::integer) else count(*) filter (where bounced) end::integer as bounced_count,
      case when bool_and(event_semantics = 'cumulative_snapshot')
        then max(opened::integer) else count(*) filter (where opened) end::integer as opened_count,
      case when bool_and(event_semantics = 'cumulative_snapshot')
        then max(clicked::integer) else count(*) filter (where clicked) end::integer as clicked_count,
      case when bool_and(event_semantics = 'cumulative_snapshot')
        then max(complained::integer) else count(*) filter (where complained) end::integer as complained_count,
      case when bool_and(event_semantics = 'cumulative_snapshot')
        then max(unsubscribed::integer) else count(*) filter (where unsubscribed) end::integer as unsubscribed_count,
      case when bool_and(event_semantics = 'cumulative_snapshot')
        then 'cumulative_snapshot' else 'atomic_event' end as event_semantics,
      (array_agg(delivery_id order by occurred_at desc, id desc)
        filter (where delivery_id is not null))[1] as delivery_id,
      (array_agg(message_id order by occurred_at desc, id desc)
        filter (where message_id is not null))[1] as message_id,
      (array_agg(message_subject order by occurred_at desc, id desc)
        filter (where message_subject is not null))[1] as message_subject,
      (array_agg(event_kind order by occurred_at desc, id desc)
        filter (where event_kind is not null))[1] as event_kind,
      (array_agg(link_url order by occurred_at desc, id desc)
        filter (where link_url is not null))[1] as link_url,
      (array_agg(provider_event_id order by occurred_at desc, id desc)
        filter (where provider_event_id is not null))[1] as provider_event_id
    from valid
    group by mail_campaign_id, campaign_id, lead_id
  ), campaign_projection as (
    insert into public.mail_campaign_lead_status (
      mail_campaign_id, campaign_id, lead_id, email_normalized, first_seen_at,
      last_seen_at, sent, delivered, bounced, opened, clicked, complained,
      unsubscribed, sent_count, delivered_count, bounced_count, opened_count,
      clicked_count, complained_count, unsubscribed_count, priority_bucket,
      priority_rank, priority_reason, last_event_semantics, last_delivery_id,
      last_message_id, last_message_subject, last_event_kind, last_link_url,
      last_provider_event_id
    )
    select grouped.mail_campaign_id, grouped.campaign_id, grouped.lead_id,
      grouped.email_normalized, grouped.first_seen_at, grouped.last_seen_at,
      grouped.sent, grouped.delivered, grouped.bounced, grouped.opened,
      grouped.clicked, grouped.complained, grouped.unsubscribed,
      grouped.sent_count, grouped.delivered_count, grouped.bounced_count,
      grouped.opened_count, grouped.clicked_count, grouped.complained_count,
      grouped.unsubscribed_count,
      public.atlas_mail_priority_bucket(
        grouped.clicked, grouped.opened, grouped.bounced, grouped.complained,
        grouped.unsubscribed, grouped.delivered, grouped.sent
      ),
      public.atlas_mail_priority_rank(public.atlas_mail_priority_bucket(
        grouped.clicked, grouped.opened, grouped.bounced, grouped.complained,
        grouped.unsubscribed, grouped.delivered, grouped.sent
      )),
      public.atlas_mail_priority_reason(public.atlas_mail_priority_bucket(
        grouped.clicked, grouped.opened, grouped.bounced, grouped.complained,
        grouped.unsubscribed, grouped.delivered, grouped.sent
      )),
      grouped.event_semantics, grouped.delivery_id, grouped.message_id,
      grouped.message_subject, grouped.event_kind, grouped.link_url,
      grouped.provider_event_id
    from mail_grouped grouped
    on conflict (mail_campaign_id, lead_id) do update set
      campaign_id = excluded.campaign_id,
      email_normalized = coalesce(excluded.email_normalized, public.mail_campaign_lead_status.email_normalized),
      first_seen_at = least(public.mail_campaign_lead_status.first_seen_at, excluded.first_seen_at),
      last_seen_at = greatest(public.mail_campaign_lead_status.last_seen_at, excluded.last_seen_at),
      sent = public.mail_campaign_lead_status.sent or excluded.sent,
      delivered = public.mail_campaign_lead_status.delivered or excluded.delivered,
      bounced = public.mail_campaign_lead_status.bounced or excluded.bounced,
      opened = public.mail_campaign_lead_status.opened or excluded.opened,
      clicked = public.mail_campaign_lead_status.clicked or excluded.clicked,
      complained = public.mail_campaign_lead_status.complained or excluded.complained,
      unsubscribed = public.mail_campaign_lead_status.unsubscribed or excluded.unsubscribed,
      sent_count = case when excluded.last_event_semantics = 'cumulative_snapshot'
        then greatest(public.mail_campaign_lead_status.sent_count, excluded.sent_count)
        else public.mail_campaign_lead_status.sent_count + excluded.sent_count end,
      delivered_count = case when excluded.last_event_semantics = 'cumulative_snapshot'
        then greatest(public.mail_campaign_lead_status.delivered_count, excluded.delivered_count)
        else public.mail_campaign_lead_status.delivered_count + excluded.delivered_count end,
      bounced_count = case when excluded.last_event_semantics = 'cumulative_snapshot'
        then greatest(public.mail_campaign_lead_status.bounced_count, excluded.bounced_count)
        else public.mail_campaign_lead_status.bounced_count + excluded.bounced_count end,
      opened_count = case when excluded.last_event_semantics = 'cumulative_snapshot'
        then greatest(public.mail_campaign_lead_status.opened_count, excluded.opened_count)
        else public.mail_campaign_lead_status.opened_count + excluded.opened_count end,
      clicked_count = case when excluded.last_event_semantics = 'cumulative_snapshot'
        then greatest(public.mail_campaign_lead_status.clicked_count, excluded.clicked_count)
        else public.mail_campaign_lead_status.clicked_count + excluded.clicked_count end,
      complained_count = case when excluded.last_event_semantics = 'cumulative_snapshot'
        then greatest(public.mail_campaign_lead_status.complained_count, excluded.complained_count)
        else public.mail_campaign_lead_status.complained_count + excluded.complained_count end,
      unsubscribed_count = case when excluded.last_event_semantics = 'cumulative_snapshot'
        then greatest(public.mail_campaign_lead_status.unsubscribed_count, excluded.unsubscribed_count)
        else public.mail_campaign_lead_status.unsubscribed_count + excluded.unsubscribed_count end,
      priority_bucket = public.atlas_mail_priority_bucket(
        public.mail_campaign_lead_status.clicked or excluded.clicked,
        public.mail_campaign_lead_status.opened or excluded.opened,
        public.mail_campaign_lead_status.bounced or excluded.bounced,
        public.mail_campaign_lead_status.complained or excluded.complained,
        public.mail_campaign_lead_status.unsubscribed or excluded.unsubscribed,
        public.mail_campaign_lead_status.delivered or excluded.delivered,
        public.mail_campaign_lead_status.sent or excluded.sent
      ),
      priority_rank = public.atlas_mail_priority_rank(public.atlas_mail_priority_bucket(
        public.mail_campaign_lead_status.clicked or excluded.clicked,
        public.mail_campaign_lead_status.opened or excluded.opened,
        public.mail_campaign_lead_status.bounced or excluded.bounced,
        public.mail_campaign_lead_status.complained or excluded.complained,
        public.mail_campaign_lead_status.unsubscribed or excluded.unsubscribed,
        public.mail_campaign_lead_status.delivered or excluded.delivered,
        public.mail_campaign_lead_status.sent or excluded.sent
      )),
      priority_reason = public.atlas_mail_priority_reason(public.atlas_mail_priority_bucket(
        public.mail_campaign_lead_status.clicked or excluded.clicked,
        public.mail_campaign_lead_status.opened or excluded.opened,
        public.mail_campaign_lead_status.bounced or excluded.bounced,
        public.mail_campaign_lead_status.complained or excluded.complained,
        public.mail_campaign_lead_status.unsubscribed or excluded.unsubscribed,
        public.mail_campaign_lead_status.delivered or excluded.delivered,
        public.mail_campaign_lead_status.sent or excluded.sent
      )),
      last_event_semantics = case
        when excluded.last_seen_at >= public.mail_campaign_lead_status.last_seen_at
          then excluded.last_event_semantics
        else public.mail_campaign_lead_status.last_event_semantics end,
      last_delivery_id = case
        when excluded.last_seen_at >= public.mail_campaign_lead_status.last_seen_at
          then coalesce(excluded.last_delivery_id, public.mail_campaign_lead_status.last_delivery_id)
        else public.mail_campaign_lead_status.last_delivery_id end,
      last_message_id = case
        when excluded.last_seen_at >= public.mail_campaign_lead_status.last_seen_at
          then coalesce(excluded.last_message_id, public.mail_campaign_lead_status.last_message_id)
        else public.mail_campaign_lead_status.last_message_id end,
      last_message_subject = case
        when excluded.last_seen_at >= public.mail_campaign_lead_status.last_seen_at
          then coalesce(excluded.last_message_subject, public.mail_campaign_lead_status.last_message_subject)
        else public.mail_campaign_lead_status.last_message_subject end,
      last_event_kind = case
        when excluded.last_seen_at >= public.mail_campaign_lead_status.last_seen_at
          then coalesce(excluded.last_event_kind, public.mail_campaign_lead_status.last_event_kind)
        else public.mail_campaign_lead_status.last_event_kind end,
      last_link_url = case
        when excluded.last_seen_at >= public.mail_campaign_lead_status.last_seen_at
          then coalesce(excluded.last_link_url, public.mail_campaign_lead_status.last_link_url)
        else public.mail_campaign_lead_status.last_link_url end,
      last_provider_event_id = case
        when excluded.last_seen_at >= public.mail_campaign_lead_status.last_seen_at
          then coalesce(excluded.last_provider_event_id, public.mail_campaign_lead_status.last_provider_event_id)
        else public.mail_campaign_lead_status.last_provider_event_id end,
      updated_at = now()
    returning mail_campaign_id, lead_id
  ), leads_updated as (
    update public.leads lead
    set mail_priority_bucket = projection.priority_bucket,
        mail_priority_rank = projection.priority_rank,
        mail_priority_reason = projection.priority_reason,
        mail_last_event_at = projection.last_seen_at,
        updated_at = now()
    from lead_projection projection
    where lead.id = projection.lead_id
      and projection.last_seen_at >= coalesce(lead.mail_last_event_at, '-infinity'::timestamptz)
    returning lead.id
  ), engagement_events as (
    insert into public.external_lead_events (
      source_id, campaign_id, lead_id, external_key, event_type, event_score,
      occurred_at, payload, integration_item_id
    )
    select valid.source_id, valid.campaign_id, valid.lead_id, valid.external_key,
      'engagement.event.v1', public.atlas_mail_priority_rank(valid.bucket),
      valid.occurred_at,
      jsonb_strip_nulls(jsonb_build_object(
        'bucket', valid.bucket,
        'external_campaign_key', valid.external_campaign_key,
        'delivery_id', valid.delivery_id,
        'message_id', valid.message_id,
        'message_subject', valid.message_subject,
        'event_kind', valid.event_kind,
        'event_semantics', valid.event_semantics,
        'link_url', valid.link_url,
        'provider_event_id', valid.provider_event_id
      )),
      valid.id
    from valid
    on conflict (integration_item_id) where integration_item_id is not null do nothing
    returning integration_item_id
  )
  select resolved.id,
    (
      resolved.projected_item_id is not null
      or (
        resolved.lead_id is not null
        and resolved.mail_campaign_id is not null
        and resolved.semantics_valid
        and resolved.event_kind_valid
      )
    ),
    case
      when resolved.projected_item_id is not null then null
      when not resolved.semantics_valid then 'invalid_engagement_semantics'
      when not resolved.event_kind_valid then 'invalid_event_kind'
      when resolved.lead_id is null then 'lead_not_found_or_ambiguous'
      when resolved.mail_campaign_id is null then 'mail_campaign_not_found'
      else null
    end
  from resolved;
end;
$function$;

revoke all on function public.apply_engagement_events_v2(text, uuid[])
  from public, anon, authenticated;
grant execute on function public.apply_engagement_events_v2(text, uuid[])
  to service_role;

-- Durable feedback to Atlas Lead is generated only from a fully typified CRM
-- management. Assignment, a dial attempt, or ended_at by itself cannot enqueue
-- anything. Identity comes from the roster ref and the native mail campaign;
-- the legacy integration_campaign_mappings table is intentionally not used.
create or replace function public.generate_atlas_lead_operation_feedback_v2(
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_source_id uuid;
  v_generated integer := 0;
  v_considered integer := 0;
begin
  if not public.request_is_service_role() then
    raise exception 'generate_atlas_lead_operation_feedback_v2 requiere service_role.';
  end if;

  select source.id into v_source_id
  from public.integration_sources source
  where source.code = 'atlas_lead'
    and source.is_active;
  if v_source_id is null then
    raise exception 'integration_v2_source_not_active';
  end if;

  with eligible as materialized (
    select call.id as call_id, call.lead_id, call.agent_id,
      call.status, call.outcome, call.reason, call.next_action_at,
      call.started_at, call.ended_at,
      lead.campaign_id, lead.assignment_status, lead.workflow_status,
      lead.managed_at, reference.external_key as source_lead_id,
      mail_campaign.external_campaign_key,
      (
        upper(coalesce(call.reason, '')) like '%NO CONTACTAR%'
        or upper(coalesce(call.reason, '')) like '%DESUSCR%'
        or upper(coalesce(call.reason, '')) like '%DAR DE BAJA%'
        or upper(coalesce(call.reason, '')) like '%DO NOT CONTACT%'
      ) as do_not_contact
    from public.calls call
    join public.leads lead on lead.id = call.lead_id
    join lateral (
      select ref.external_key, ref.source_payload
      from public.lead_external_refs ref
      where ref.source_id = v_source_id
        and ref.campaign_id = lead.campaign_id
        and ref.lead_id = lead.id
      order by ref.last_seen_at desc, ref.id
      limit 1
    ) reference on true
    join lateral (
      select mapped.external_campaign_key
      from public.mail_campaign_lead_status status
      join public.mail_campaigns mapped on mapped.id = status.mail_campaign_id
      where status.lead_id = lead.id
        and status.campaign_id = lead.campaign_id
        and mapped.source_id = v_source_id
        and (
          nullif(reference.source_payload->>'external_campaign_key', '') is null
          or mapped.external_campaign_key = reference.source_payload->>'external_campaign_key'
        )
      order by
        (mapped.external_campaign_key = reference.source_payload->>'external_campaign_key') desc,
        status.last_seen_at desc,
        mapped.id
      limit 1
    ) mail_campaign on true
    where call.ended_at is not null
      and call.discarded_reason is null
      and nullif(btrim(coalesce(call.status, '')), '') is not null
      and nullif(btrim(coalesce(call.outcome, '')), '') is not null
      and nullif(btrim(coalesce(call.reason, '')), '') is not null
      and lead.managed_at is not null
      and lead.assignment_status = 'managed'
      and not exists (
        select 1
        from public.integration_outbox_events outbox
        where outbox.destination_source_id = v_source_id
          and outbox.event_id = 'operation.feedback.v1:' || call.id::text
      )
    order by lead.managed_at, call.id
    limit least(greatest(coalesce(p_limit, 500), 1), 500)
  ), counted as (
    select count(*)::integer as count from eligible
  ), inserted as (
    insert into public.integration_outbox_events (
      destination_source_id, event_id, event_type, aggregate_type, aggregate_id,
      schema_version, payload
    )
    select v_source_id,
      'operation.feedback.v1:' || eligible.call_id::text,
      'operation.feedback.v1',
      'lead',
      eligible.source_lead_id,
      '2',
      jsonb_strip_nulls(jsonb_build_object(
        'crm_campaign_id', eligible.campaign_id,
        'external_campaign_key', eligible.external_campaign_key,
        'external_key', eligible.source_lead_id,
        'source_lead_id', eligible.source_lead_id,
        'management_completed', true,
        'response_received', eligible.status = 'connected',
        'do_not_contact', eligible.do_not_contact,
        'do_not_contact_reason', case when eligible.do_not_contact then eligible.reason end,
        'managed_at', eligible.managed_at,
        'status', eligible.status,
        'outcome', eligible.outcome,
        'reason', eligible.reason,
        'assignment_status', eligible.assignment_status,
        'workflow_status', eligible.workflow_status,
        'assigned_agent_id', eligible.agent_id,
        'next_action_at', eligible.next_action_at,
        'ended_at', eligible.ended_at,
        'duration_seconds', case when eligible.started_at is not null
          then greatest(extract(epoch from (eligible.ended_at - eligible.started_at))::integer, 0)
        end
      ))
    from eligible
    on conflict (destination_source_id, event_id) do nothing
    returning id
  )
  select counted.count, (select count(*)::integer from inserted)
  into v_considered, v_generated
  from counted;

  return jsonb_build_object(
    'destination_source_code', 'atlas_lead',
    'considered', coalesce(v_considered, 0),
    'generated', coalesce(v_generated, 0)
  );
end;
$function$;

revoke all on function public.generate_atlas_lead_operation_feedback_v2(integer)
  from public, anon, authenticated;
grant execute on function public.generate_atlas_lead_operation_feedback_v2(integer)
  to service_role;

commit;
