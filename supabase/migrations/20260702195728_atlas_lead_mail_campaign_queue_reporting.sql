-- Atlas Lead mail campaign sync, supervisor queue, and reporting.

create or replace function public.request_is_service_role()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role';
$$;

create table if not exists public.mail_campaigns (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  source_id uuid references public.integration_sources(id) on delete set null,
  external_campaign_key text not null,
  name text not null,
  umbrella_key text not null,
  status text not null default 'active' check (status in ('draft', 'active', 'paused', 'completed', 'archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mail_campaigns_external_key_not_blank check (btrim(external_campaign_key) <> ''),
  constraint mail_campaigns_name_not_blank check (btrim(name) <> ''),
  constraint mail_campaigns_umbrella_not_blank check (btrim(umbrella_key) <> '')
);

drop trigger if exists mail_campaigns_set_updated_at on public.mail_campaigns;
create trigger mail_campaigns_set_updated_at
before update on public.mail_campaigns
for each row execute function public.set_updated_at();

create unique index if not exists mail_campaigns_source_external_uidx
  on public.mail_campaigns (source_id, external_campaign_key);

create index if not exists mail_campaigns_campaign_status_idx
  on public.mail_campaigns (campaign_id, status, updated_at desc);

create index if not exists mail_campaigns_umbrella_idx
  on public.mail_campaigns (umbrella_key, status, updated_at desc);

alter table public.mail_result_batches
  add column if not exists mail_campaign_id uuid references public.mail_campaigns(id) on delete set null;

create index if not exists mail_result_batches_mail_campaign_idx
  on public.mail_result_batches (mail_campaign_id, report_date desc, created_at desc)
  where mail_campaign_id is not null;

create or replace function public.can_manage_campaign(p_campaign_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.request_is_service_role()
    or (select public.current_role_name()) = 'admin'::public.app_role
    or (
      (select public.current_role_name()) = 'supervisor'::public.app_role
      and (
        exists (
          select 1
          from public.campaign_agents ca
          where ca.campaign_id = p_campaign_id
            and ca.profile_id = (select auth.uid())
        )
        or exists (
          select 1
          from public.leads l
          where l.campaign_id = p_campaign_id
            and l.team_id = (select public.current_team_id())
        )
      )
    );
$$;

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
  v_is_service boolean := public.request_is_service_role();
  v_role text := coalesce((select public.current_role_name())::text, '');
  v_source_id uuid;
  v_campaign_id uuid := p_campaign_id;
  v_mail_campaign_id uuid;
  v_umbrella text := lower(btrim(coalesce(p_umbrella_key, '')));
  v_external_key text := nullif(btrim(coalesce(p_external_campaign_key, '')), '');
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
begin
  if not v_is_service and (v_actor_id is null or v_role <> 'admin') then
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

create or replace function public.apply_atlas_lead_mail_result_batch(
  p_external_campaign_key text,
  p_campaign_name text,
  p_rows jsonb,
  p_umbrella_key text default 'equifax',
  p_report_date date default current_date,
  p_report_period text default 'manual',
  p_file_name text default null,
  p_checksum text default null,
  p_source_label text default null,
  p_source_code text default 'atlas_lead',
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_sync jsonb;
  v_campaign_id uuid;
  v_mail_campaign_id uuid;
  v_source_id uuid;
  v_batch_id uuid;
  v_total integer := coalesce(jsonb_array_length(coalesce(p_rows, '[]'::jsonb)), 0);
  v_processed integer := 0;
  v_matched integer := 0;
  v_unmatched integer := 0;
  v_row jsonb;
  v_email text;
  v_lead_id uuid;
  v_sent boolean;
  v_delivered boolean;
  v_bounced boolean;
  v_opened boolean;
  v_clicked boolean;
  v_complained boolean;
  v_unsubscribed boolean;
  v_bucket text;
  v_rank integer;
  v_reason text;
  v_event_score integer;
begin
  v_sync := public.sync_atlas_lead_mail_campaign(
    p_external_campaign_key,
    p_campaign_name,
    p_umbrella_key,
    null,
    p_source_code,
    null,
    p_metadata
  );

  if coalesce((v_sync->>'synced')::boolean, false) is false then
    return v_sync || jsonb_build_object('processed', 0, 'matched', 0, 'unmatched', 0);
  end if;

  v_campaign_id := (v_sync->>'campaign_id')::uuid;
  v_mail_campaign_id := (v_sync->>'mail_campaign_id')::uuid;

  if v_total = 0 then
    raise exception 'No hay filas mail para procesar.';
  end if;

  if v_total > 50000 then
    raise exception 'El lote excede el maximo de 50000 filas.';
  end if;

  select source_id
  into v_source_id
  from public.mail_campaigns
  where id = v_mail_campaign_id;

  insert into public.mail_result_batches (
    campaign_id,
    source_id,
    mail_campaign_id,
    report_date,
    report_period,
    external_campaign_key,
    source_label,
    file_name,
    checksum,
    rows_total,
    uploaded_by
  )
  values (
    v_campaign_id,
    v_source_id,
    v_mail_campaign_id,
    coalesce(p_report_date, current_date),
    coalesce(nullif(btrim(p_report_period), ''), 'manual'),
    nullif(btrim(p_external_campaign_key), ''),
    nullif(btrim(coalesce(p_source_label, '')), ''),
    nullif(btrim(coalesce(p_file_name, '')), ''),
    nullif(btrim(coalesce(p_checksum, '')), ''),
    v_total,
    (select auth.uid())
  )
  returning id into v_batch_id;

  for v_row in
    select value
    from jsonb_array_elements(p_rows)
  loop
    v_processed := v_processed + 1;
    v_email := public.atlas_normalize_email(coalesce(v_row->>'email', v_row->>'mail', v_row->>'correo'));
    v_lead_id := null;

    v_sent := public.atlas_boolish(v_row->>'sent') or public.atlas_boolish(v_row->>'enviado');
    v_delivered := public.atlas_boolish(v_row->>'delivered') or public.atlas_boolish(v_row->>'entregado');
    v_bounced := public.atlas_boolish(v_row->>'bounced') or public.atlas_boolish(v_row->>'rebote');
    v_opened := public.atlas_boolish(v_row->>'opened') or public.atlas_boolish(v_row->>'abierto') or public.atlas_boolish(v_row->>'open');
    v_clicked := public.atlas_boolish(v_row->>'clicked') or public.atlas_boolish(v_row->>'click');
    v_complained := public.atlas_boolish(v_row->>'complained') or public.atlas_boolish(v_row->>'queja');
    v_unsubscribed := public.atlas_boolish(v_row->>'unsubscribed') or public.atlas_boolish(v_row->>'desuscrito');

    if v_email is not null then
      select l.id
      into v_lead_id
      from public.leads l
      where l.campaign_id = v_campaign_id
        and public.atlas_normalize_email(l.email) = v_email
      order by l.updated_at desc
      limit 1;
    end if;

    v_bucket := public.atlas_mail_priority_bucket(
      v_clicked,
      v_opened,
      v_bounced,
      v_complained,
      v_unsubscribed,
      v_delivered,
      v_sent
    );
    v_rank := public.atlas_mail_priority_rank(v_bucket);
    v_reason := public.atlas_mail_priority_reason(v_bucket);
    v_event_score := case
      when v_bucket = 'p0_discard' then -100
      when v_bucket = 'p1_click' then 100
      when v_bucket = 'p2_open' then 80
      when v_bucket = 'p3_delivered' then 50
      when v_bucket = 'p4_sent' then 25
      else 0
    end;

    insert into public.mail_result_contacts (
      batch_id,
      campaign_id,
      lead_id,
      email,
      email_normalized,
      full_name,
      sent,
      delivered,
      bounced,
      opened,
      clicked,
      complained,
      unsubscribed,
      event_score,
      matched_by,
      raw
    )
    values (
      v_batch_id,
      v_campaign_id,
      v_lead_id,
      coalesce(v_row->>'email', v_row->>'mail', v_row->>'correo'),
      v_email,
      coalesce(v_row->>'full_name', v_row->>'name', v_row->>'nombre'),
      v_sent,
      v_delivered,
      v_bounced,
      v_opened,
      v_clicked,
      v_complained,
      v_unsubscribed,
      v_event_score,
      case when v_lead_id is not null then 'email' else null end,
      v_row
    );

    if v_lead_id is null then
      v_unmatched := v_unmatched + 1;
      continue;
    end if;

    v_matched := v_matched + 1;

    insert into public.lead_mail_status (
      campaign_id,
      lead_id,
      email_normalized,
      first_seen_at,
      last_seen_at,
      last_batch_id,
      sent,
      delivered,
      bounced,
      opened,
      clicked,
      complained,
      unsubscribed,
      sent_count,
      delivered_count,
      bounced_count,
      opened_count,
      clicked_count,
      complained_count,
      unsubscribed_count,
      priority_bucket,
      priority_rank,
      priority_reason
    )
    values (
      v_campaign_id,
      v_lead_id,
      v_email,
      now(),
      now(),
      v_batch_id,
      v_sent,
      v_delivered,
      v_bounced,
      v_opened,
      v_clicked,
      v_complained,
      v_unsubscribed,
      case when v_sent then 1 else 0 end,
      case when v_delivered then 1 else 0 end,
      case when v_bounced then 1 else 0 end,
      case when v_opened then 1 else 0 end,
      case when v_clicked then 1 else 0 end,
      case when v_complained then 1 else 0 end,
      case when v_unsubscribed then 1 else 0 end,
      v_bucket,
      v_rank,
      v_reason
    )
    on conflict (campaign_id, lead_id)
    do update set
      email_normalized = coalesce(excluded.email_normalized, lead_mail_status.email_normalized),
      last_seen_at = now(),
      last_batch_id = excluded.last_batch_id,
      sent = lead_mail_status.sent or excluded.sent,
      delivered = lead_mail_status.delivered or excluded.delivered,
      bounced = lead_mail_status.bounced or excluded.bounced,
      opened = lead_mail_status.opened or excluded.opened,
      clicked = lead_mail_status.clicked or excluded.clicked,
      complained = lead_mail_status.complained or excluded.complained,
      unsubscribed = lead_mail_status.unsubscribed or excluded.unsubscribed,
      sent_count = lead_mail_status.sent_count + excluded.sent_count,
      delivered_count = lead_mail_status.delivered_count + excluded.delivered_count,
      bounced_count = lead_mail_status.bounced_count + excluded.bounced_count,
      opened_count = lead_mail_status.opened_count + excluded.opened_count,
      clicked_count = lead_mail_status.clicked_count + excluded.clicked_count,
      complained_count = lead_mail_status.complained_count + excluded.complained_count,
      unsubscribed_count = lead_mail_status.unsubscribed_count + excluded.unsubscribed_count,
      priority_bucket = public.atlas_mail_priority_bucket(
        lead_mail_status.clicked or excluded.clicked,
        lead_mail_status.opened or excluded.opened,
        lead_mail_status.bounced or excluded.bounced,
        lead_mail_status.complained or excluded.complained,
        lead_mail_status.unsubscribed or excluded.unsubscribed,
        lead_mail_status.delivered or excluded.delivered,
        lead_mail_status.sent or excluded.sent
      ),
      priority_rank = public.atlas_mail_priority_rank(public.atlas_mail_priority_bucket(
        lead_mail_status.clicked or excluded.clicked,
        lead_mail_status.opened or excluded.opened,
        lead_mail_status.bounced or excluded.bounced,
        lead_mail_status.complained or excluded.complained,
        lead_mail_status.unsubscribed or excluded.unsubscribed,
        lead_mail_status.delivered or excluded.delivered,
        lead_mail_status.sent or excluded.sent
      )),
      priority_reason = public.atlas_mail_priority_reason(public.atlas_mail_priority_bucket(
        lead_mail_status.clicked or excluded.clicked,
        lead_mail_status.opened or excluded.opened,
        lead_mail_status.bounced or excluded.bounced,
        lead_mail_status.complained or excluded.complained,
        lead_mail_status.unsubscribed or excluded.unsubscribed,
        lead_mail_status.delivered or excluded.delivered,
        lead_mail_status.sent or excluded.sent
      )),
      updated_at = now();

    update public.leads l
    set
      mail_priority_bucket = s.priority_bucket,
      mail_priority_rank = s.priority_rank,
      mail_priority_reason = s.priority_reason,
      mail_last_event_at = s.last_seen_at,
      external_priority_rank = s.priority_rank,
      external_priority_reason = s.priority_reason,
      external_last_source_code = lower(btrim(p_source_code)),
      external_last_seen_at = s.last_seen_at
    from public.lead_mail_status s
    where s.campaign_id = v_campaign_id
      and s.lead_id = v_lead_id
      and l.id = s.lead_id;
  end loop;

  update public.mail_result_batches
  set rows_processed = v_processed,
      rows_matched = v_matched,
      rows_unmatched = v_unmatched,
      processed_at = now()
  where id = v_batch_id;

  return jsonb_build_object(
    'synced', true,
    'campaign_id', v_campaign_id,
    'mail_campaign_id', v_mail_campaign_id,
    'batch_id', v_batch_id,
    'source_id', v_source_id,
    'rows_total', v_total,
    'processed', v_processed,
    'matched', v_matched,
    'unmatched', v_unmatched
  );
end;
$function$;

create or replace function public.get_mail_engagement_queue(
  p_mail_campaign_id uuid default null,
  p_campaign_id uuid default null,
  p_limit integer default 200
)
returns table (
  mail_campaign_id uuid,
  mail_campaign_name text,
  campaign_id uuid,
  campaign_name text,
  lead_id uuid,
  full_name text,
  rut text,
  phone text,
  email text,
  assigned_to uuid,
  assigned_to_name text,
  team_id uuid,
  opened boolean,
  clicked boolean,
  last_event_at timestamptz,
  priority_rank integer,
  priority_reason text
)
language sql
security invoker
set search_path = public
as $$
  with engagement as (
    select
      b.mail_campaign_id,
      b.campaign_id,
      r.lead_id,
      bool_or(r.opened) as opened,
      bool_or(r.clicked) as clicked,
      max(r.created_at) as last_event_at,
      min(case when r.clicked then 10 when r.opened then 20 else 70 end) as priority_rank
    from public.mail_result_contacts r
    join public.mail_result_batches b on b.id = r.batch_id
    where r.lead_id is not null
      and (r.opened or r.clicked)
      and (p_mail_campaign_id is null or b.mail_campaign_id = p_mail_campaign_id)
      and (p_campaign_id is null or b.campaign_id = p_campaign_id)
    group by b.mail_campaign_id, b.campaign_id, r.lead_id
  )
  select
    e.mail_campaign_id,
    coalesce(mc.name, c.name) as mail_campaign_name,
    e.campaign_id,
    c.name as campaign_name,
    l.id as lead_id,
    l.full_name,
    l.rut,
    l.phone,
    l.email,
    l.assigned_to,
    p.full_name as assigned_to_name,
    l.team_id,
    e.opened,
    e.clicked,
    e.last_event_at,
    e.priority_rank,
    case
      when e.clicked then 'Click detectado en campana mail'
      when e.opened then 'Apertura detectada en campana mail'
      else 'Senal mail'
    end as priority_reason
  from engagement e
  join public.leads l on l.id = e.lead_id
  join public.campaigns c on c.id = e.campaign_id
  left join public.mail_campaigns mc on mc.id = e.mail_campaign_id
  left join public.profiles p on p.id = l.assigned_to
  order by e.priority_rank asc, e.last_event_at desc, l.full_name
  limit least(greatest(coalesce(p_limit, 200), 1), 500);
$$;

create or replace function public.get_mail_engagement_report(
  p_mail_campaign_id uuid default null,
  p_campaign_id uuid default null
)
returns table (
  mail_campaign_id uuid,
  mail_campaign_name text,
  campaign_id uuid,
  campaign_name text,
  sent_leads integer,
  delivered_leads integer,
  opened_leads integer,
  clicked_leads integer,
  hot_leads integer,
  assigned_hot_leads integer,
  managed_hot_leads integer,
  last_event_at timestamptz
)
language sql
security invoker
set search_path = public
as $$
  with per_lead as (
    select
      b.mail_campaign_id,
      b.campaign_id,
      r.lead_id,
      bool_or(r.sent) as sent,
      bool_or(r.delivered) as delivered,
      bool_or(r.opened) as opened,
      bool_or(r.clicked) as clicked,
      max(r.created_at) as last_event_at
    from public.mail_result_contacts r
    join public.mail_result_batches b on b.id = r.batch_id
    where r.lead_id is not null
      and (p_mail_campaign_id is null or b.mail_campaign_id = p_mail_campaign_id)
      and (p_campaign_id is null or b.campaign_id = p_campaign_id)
    group by b.mail_campaign_id, b.campaign_id, r.lead_id
  )
  select
    pl.mail_campaign_id,
    coalesce(mc.name, c.name) as mail_campaign_name,
    pl.campaign_id,
    c.name as campaign_name,
    count(*) filter (where pl.sent)::integer as sent_leads,
    count(*) filter (where pl.delivered)::integer as delivered_leads,
    count(*) filter (where pl.opened)::integer as opened_leads,
    count(*) filter (where pl.clicked)::integer as clicked_leads,
    count(*) filter (where pl.opened or pl.clicked)::integer as hot_leads,
    count(*) filter (where (pl.opened or pl.clicked) and l.assigned_to is not null)::integer as assigned_hot_leads,
    count(*) filter (
      where (pl.opened or pl.clicked)
        and (l.assignment_status = 'managed' or l.workflow_status = 'managed')
    )::integer as managed_hot_leads,
    max(pl.last_event_at) as last_event_at
  from per_lead pl
  join public.leads l on l.id = pl.lead_id
  join public.campaigns c on c.id = pl.campaign_id
  left join public.mail_campaigns mc on mc.id = pl.mail_campaign_id
  group by pl.mail_campaign_id, coalesce(mc.name, c.name), pl.campaign_id, c.name
  order by max(pl.last_event_at) desc nulls last, coalesce(mc.name, c.name);
$$;

alter table public.mail_campaigns enable row level security;

drop policy if exists mail_campaigns_select on public.mail_campaigns;
create policy mail_campaigns_select
on public.mail_campaigns
for select
to authenticated
using (public.can_manage_campaign(campaign_id));

drop policy if exists mail_campaigns_admin_write on public.mail_campaigns;
create policy mail_campaigns_admin_write
on public.mail_campaigns
for all
to authenticated
using ((select public.current_role_name()) = 'admin')
with check ((select public.current_role_name()) = 'admin');

grant select on public.mail_campaigns to authenticated;
grant select, insert, update, delete on public.mail_campaigns to service_role;

revoke all on function public.request_is_service_role() from public, anon;
grant execute on function public.request_is_service_role() to authenticated, service_role;

revoke all on function public.sync_atlas_lead_mail_campaign(text, text, text, text, text, uuid, jsonb) from public, anon;
grant execute on function public.sync_atlas_lead_mail_campaign(text, text, text, text, text, uuid, jsonb) to authenticated, service_role;

revoke all on function public.apply_atlas_lead_mail_result_batch(text, text, jsonb, text, date, text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.apply_atlas_lead_mail_result_batch(text, text, jsonb, text, date, text, text, text, text, text, jsonb) to authenticated, service_role;

revoke all on function public.get_mail_engagement_queue(uuid, uuid, integer) from public, anon;
grant execute on function public.get_mail_engagement_queue(uuid, uuid, integer) to authenticated;

revoke all on function public.get_mail_engagement_report(uuid, uuid) from public, anon;
grant execute on function public.get_mail_engagement_report(uuid, uuid) to authenticated;
