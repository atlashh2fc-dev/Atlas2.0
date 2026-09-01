begin;

-- Keep Atlas Lead roster materialization aligned with CRM's existing
-- campaign-level email and phone identity rules.
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

commit;
