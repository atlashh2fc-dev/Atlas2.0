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
set search_path = public
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_role text := coalesce((select public.current_role_name())::text, '');
  v_source_id uuid;
  v_campaign_id uuid := p_campaign_id;
  v_mail_campaign_id uuid;
  v_umbrella text := lower(btrim(coalesce(p_umbrella_key, '')));
  v_external_key text := nullif(btrim(coalesce(p_external_campaign_key, '')), '');
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
begin
  -- service_role calls arrive without auth.uid(); anon cannot execute this RPC
  -- because execute is revoked from public/anon and granted only to service_role/authenticated.
  if v_actor_id is not null and v_role <> 'admin' then
    raise exception 'Solo admin o service_role puede sincronizar campanas Atlas Lead.';
  end if;

  if v_external_key is null then
    raise exception 'external_campaign_key es obligatorio.';
  end if;

  if v_name is null then
    raise exception 'El nombre de campana Atlas Lead es obligatorio.';
  end if;

  if v_umbrella <> 'equifax' then
    return jsonb_build_object(
      'synced', false,
      'reason', 'umbrella_not_supported',
      'umbrella_key', v_umbrella,
      'external_campaign_key', v_external_key
    );
  end if;

  insert into public.integration_sources (code, name, source_kind, provider)
  values (lower(btrim(p_source_code)), 'Atlas Lead', 'mail_platform', 'atlas_lead')
  on conflict (code) do update
  set source_kind = 'mail_platform',
      provider = 'atlas_lead',
      is_active = true,
      updated_at = now()
  returning id into v_source_id;

  if v_campaign_id is null then
    select mc.campaign_id
    into v_campaign_id
    from public.mail_campaigns mc
    where mc.source_id = v_source_id
      and mc.external_campaign_key = v_external_key
    limit 1;
  end if;

  if v_campaign_id is null then
    insert into public.campaigns (name, description, created_by)
    values (
      v_name,
      coalesce(nullif(btrim(p_description), ''), 'Campana mail sincronizada desde Atlas Lead.'),
      v_actor_id
    )
    on conflict (name) do update
    set description = coalesce(excluded.description, public.campaigns.description),
        updated_at = now()
    returning id into v_campaign_id;
  end if;

  insert into public.mail_campaigns (
    campaign_id,
    source_id,
    external_campaign_key,
    name,
    umbrella_key,
    status,
    metadata,
    created_by
  )
  values (
    v_campaign_id,
    v_source_id,
    v_external_key,
    v_name,
    v_umbrella,
    'active',
    coalesce(p_metadata, '{}'::jsonb),
    v_actor_id
  )
  on conflict (source_id, external_campaign_key)
  do update set
    campaign_id = excluded.campaign_id,
    name = excluded.name,
    umbrella_key = excluded.umbrella_key,
    status = case when public.mail_campaigns.status = 'archived' then 'active' else public.mail_campaigns.status end,
    metadata = public.mail_campaigns.metadata || excluded.metadata,
    updated_at = now()
  returning id into v_mail_campaign_id;

  return jsonb_build_object(
    'synced', true,
    'campaign_id', v_campaign_id,
    'mail_campaign_id', v_mail_campaign_id,
    'source_id', v_source_id,
    'external_campaign_key', v_external_key,
    'umbrella_key', v_umbrella
  );
end;
$function$;

revoke all on function public.sync_atlas_lead_mail_campaign(text, text, text, text, text, uuid, jsonb) from public, anon;
grant execute on function public.sync_atlas_lead_mail_campaign(text, text, text, text, text, uuid, jsonb) to authenticated, service_role;
