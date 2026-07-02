-- Atlas external integrations foundation.
-- Goal: keep leads as the single CRM work item, and attach external BigData
-- and mail-platform signals through small, scoped integration tables.

alter table public.leads
  add column if not exists external_last_source_code text,
  add column if not exists external_last_seen_at timestamptz,
  add column if not exists external_priority_rank integer,
  add column if not exists external_priority_reason text,
  add column if not exists mail_priority_bucket text,
  add column if not exists mail_priority_rank integer,
  add column if not exists mail_priority_reason text,
  add column if not exists mail_last_event_at timestamptz;

create index if not exists leads_external_last_seen_idx
  on public.leads (external_last_seen_at desc)
  where external_last_seen_at is not null;

create index if not exists leads_mail_priority_idx
  on public.leads (campaign_id, mail_priority_rank, mail_last_event_at desc)
  where mail_priority_rank is not null;

create index if not exists leads_campaign_email_norm_idx
  on public.leads (campaign_id, lower(email))
  where email is not null;

create table if not exists public.integration_sources (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  source_kind text not null check (source_kind in ('bigdata', 'mail_platform', 'dialer', 'other')),
  provider text,
  config jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_sources_code_not_blank check (btrim(code) <> ''),
  constraint integration_sources_name_not_blank check (btrim(name) <> '')
);

drop trigger if exists integration_sources_set_updated_at on public.integration_sources;
create trigger integration_sources_set_updated_at
before update on public.integration_sources
for each row execute function public.set_updated_at();

create table if not exists public.external_import_batches (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.integration_sources(id) on delete restrict,
  campaign_id uuid references public.campaigns(id) on delete set null,
  batch_type text not null default 'lead_import'
    check (batch_type in ('lead_import', 'lead_event', 'mail_base', 'mail_result', 'campaign_sync', 'other')),
  external_campaign_key text,
  source_batch_key text,
  file_name text,
  checksum text,
  rows_total integer not null default 0,
  rows_inserted integer not null default 0,
  rows_matched integer not null default 0,
  rows_unmatched integer not null default 0,
  duplicate_count integer not null default 0,
  status text not null default 'received' check (status in ('received', 'processing', 'succeeded', 'failed')),
  error text,
  metadata jsonb not null default '{}'::jsonb,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists external_import_batches_campaign_idx
  on public.external_import_batches (campaign_id, created_at desc);

create index if not exists external_import_batches_source_idx
  on public.external_import_batches (source_id, batch_type, created_at desc);

create unique index if not exists external_import_batches_source_key_uidx
  on public.external_import_batches (source_id, source_batch_key)
  where source_batch_key is not null;

create table if not exists public.lead_external_refs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.integration_sources(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  external_key text not null,
  source_payload jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_batch_id uuid references public.external_import_batches(id) on delete set null,
  constraint lead_external_refs_external_key_not_blank check (btrim(external_key) <> ''),
  unique (source_id, campaign_id, external_key)
);

create index if not exists lead_external_refs_lead_idx
  on public.lead_external_refs (lead_id, last_seen_at desc);

create table if not exists public.external_lead_events (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.integration_sources(id) on delete cascade,
  import_batch_id uuid references public.external_import_batches(id) on delete set null,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  external_key text,
  event_type text not null,
  event_score integer not null default 0,
  occurred_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint external_lead_events_event_type_not_blank check (btrim(event_type) <> '')
);

create index if not exists external_lead_events_lead_idx
  on public.external_lead_events (lead_id, created_at desc)
  where lead_id is not null;

create index if not exists external_lead_events_campaign_idx
  on public.external_lead_events (campaign_id, source_id, created_at desc);

create table if not exists public.mail_campaign_bases (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  source_id uuid references public.integration_sources(id) on delete set null,
  external_campaign_key text,
  base_name text not null,
  source_file_name text,
  base_fingerprint text,
  contacts_total integer not null default 0,
  contacts_with_email integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint mail_campaign_bases_base_name_not_blank check (btrim(base_name) <> '')
);

drop trigger if exists mail_campaign_bases_set_updated_at on public.mail_campaign_bases;
create trigger mail_campaign_bases_set_updated_at
before update on public.mail_campaign_bases
for each row execute function public.set_updated_at();

create unique index if not exists mail_campaign_bases_campaign_fingerprint_uidx
  on public.mail_campaign_bases (campaign_id, base_fingerprint)
  where base_fingerprint is not null and archived_at is null;

create index if not exists mail_campaign_bases_campaign_idx
  on public.mail_campaign_bases (campaign_id, created_at desc)
  where archived_at is null;

create table if not exists public.mail_campaign_base_recipients (
  base_id uuid not null references public.mail_campaign_bases(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  email text,
  email_normalized text not null,
  full_name text,
  phone text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (base_id, email_normalized)
);

create index if not exists mail_campaign_base_recipients_campaign_email_idx
  on public.mail_campaign_base_recipients (campaign_id, email_normalized);

create table if not exists public.mail_result_batches (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  source_id uuid references public.integration_sources(id) on delete set null,
  base_id uuid references public.mail_campaign_bases(id) on delete set null,
  report_date date not null,
  report_period text not null default 'manual' check (report_period in ('am', 'pm', 'manual')),
  external_campaign_key text,
  source_label text,
  file_name text,
  checksum text,
  rows_total integer not null default 0,
  rows_processed integer not null default 0,
  rows_matched integer not null default 0,
  rows_unmatched integer not null default 0,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists mail_result_batches_campaign_date_idx
  on public.mail_result_batches (campaign_id, report_date desc, created_at desc);

create unique index if not exists mail_result_batches_campaign_period_checksum_uidx
  on public.mail_result_batches (campaign_id, report_date, report_period, checksum)
  where checksum is not null;

create table if not exists public.mail_result_contacts (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.mail_result_batches(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  email text,
  email_normalized text,
  full_name text,
  sent boolean not null default false,
  delivered boolean not null default false,
  bounced boolean not null default false,
  opened boolean not null default false,
  clicked boolean not null default false,
  complained boolean not null default false,
  unsubscribed boolean not null default false,
  event_score integer not null default 0,
  matched_by text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists mail_result_contacts_batch_idx
  on public.mail_result_contacts (batch_id, created_at desc);

create index if not exists mail_result_contacts_campaign_email_idx
  on public.mail_result_contacts (campaign_id, email_normalized);

create index if not exists mail_result_contacts_lead_idx
  on public.mail_result_contacts (lead_id, created_at desc)
  where lead_id is not null;

create table if not exists public.lead_mail_status (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  email_normalized text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_batch_id uuid references public.mail_result_batches(id) on delete set null,
  sent boolean not null default false,
  delivered boolean not null default false,
  bounced boolean not null default false,
  opened boolean not null default false,
  clicked boolean not null default false,
  complained boolean not null default false,
  unsubscribed boolean not null default false,
  sent_count integer not null default 0,
  delivered_count integer not null default 0,
  bounced_count integer not null default 0,
  opened_count integer not null default 0,
  clicked_count integer not null default 0,
  complained_count integer not null default 0,
  unsubscribed_count integer not null default 0,
  priority_bucket text not null default 'p5_other',
  priority_rank integer not null default 70,
  priority_reason text,
  updated_at timestamptz not null default now(),
  primary key (campaign_id, lead_id)
);

create index if not exists lead_mail_status_priority_idx
  on public.lead_mail_status (campaign_id, priority_rank, last_seen_at desc);

create or replace function public.atlas_normalize_email(p_email text)
returns text
language sql
immutable
as $$
  select nullif(lower(btrim(coalesce(p_email, ''))), '');
$$;

create or replace function public.atlas_normalize_rut(p_rut text)
returns text
language sql
immutable
as $$
  select nullif(upper(regexp_replace(coalesce(p_rut, ''), '[^0-9kK]', '', 'g')), '');
$$;

create or replace function public.atlas_normalize_phone(p_phone text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '');
$$;

create or replace function public.atlas_boolish(p_value text)
returns boolean
language sql
immutable
as $$
  select lower(btrim(coalesce(p_value, ''))) in ('1', 'true', 't', 'yes', 'y', 'si', 's', 'x');
$$;

create or replace function public.atlas_mail_priority_bucket(
  p_clicked boolean,
  p_opened boolean,
  p_bounced boolean,
  p_complained boolean,
  p_unsubscribed boolean,
  p_delivered boolean,
  p_sent boolean
)
returns text
language sql
immutable
as $$
  select case
    when coalesce(p_unsubscribed, false) or coalesce(p_complained, false) or coalesce(p_bounced, false) then 'p0_discard'
    when coalesce(p_clicked, false) then 'p1_click'
    when coalesce(p_opened, false) then 'p2_open'
    when coalesce(p_delivered, false) then 'p3_delivered'
    when coalesce(p_sent, false) then 'p4_sent'
    else 'p5_other'
  end;
$$;

create or replace function public.atlas_mail_priority_rank(p_bucket text)
returns integer
language sql
immutable
as $$
  select case p_bucket
    when 'p1_click' then 10
    when 'p2_open' then 20
    when 'p3_delivered' then 40
    when 'p4_sent' then 55
    when 'p0_discard' then 99
    else 70
  end;
$$;

create or replace function public.atlas_mail_priority_reason(p_bucket text)
returns text
language sql
immutable
as $$
  select case p_bucket
    when 'p0_discard' then 'Senal de descarte en plataforma mail'
    when 'p1_click' then 'Click detectado en campana mail'
    when 'p2_open' then 'Apertura detectada en campana mail'
    when 'p3_delivered' then 'Correo entregado sin apertura'
    when 'p4_sent' then 'Correo enviado sin interaccion'
    else 'Sin senal mail relevante'
  end;
$$;

create or replace function public.can_manage_campaign(p_campaign_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    (select public.current_role_name()) = 'admin'::public.app_role
    or (
      (select public.current_role_name()) = 'supervisor'::public.app_role
      and exists (
        select 1
        from public.campaign_agents ca
        where ca.campaign_id = p_campaign_id
          and ca.profile_id = (select auth.uid())
      )
    );
$$;

create or replace function public.upsert_external_leads(
  p_source_code text,
  p_campaign_id uuid,
  p_rows jsonb,
  p_batch_type text default 'lead_import',
  p_file_name text default null,
  p_checksum text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_actor_role text := coalesce((select public.current_role_name())::text, '');
  v_actor_team_id uuid := (select public.current_team_id());
  v_source_id uuid;
  v_campaign_workflow_id uuid;
  v_batch_id uuid;
  v_total integer := coalesce(jsonb_array_length(coalesce(p_rows, '[]'::jsonb)), 0);
  v_inserted integer := 0;
  v_matched integer := 0;
  v_unmatched integer := 0;
  v_duplicates integer := 0;
  v_row jsonb;
  v_external_key text;
  v_full_name text;
  v_rut text;
  v_phone text;
  v_email text;
  v_status text;
  v_team_id uuid;
  v_lead_id uuid;
  v_existing_ref uuid;
  v_row_number integer;
  v_created_lead boolean;
begin
  if v_actor_id is null then
    raise exception 'No autenticado.';
  end if;

  if nullif(btrim(coalesce(p_source_code, '')), '') is null then
    raise exception 'El codigo de fuente externa es obligatorio.';
  end if;

  if p_campaign_id is null then
    raise exception 'La campana es obligatoria para ingestiones externas.';
  end if;

  if v_actor_role not in ('admin', 'supervisor') or not public.can_manage_campaign(p_campaign_id) then
    raise exception 'No tienes permisos para ingerir registros externos en esta campana.';
  end if;

  if v_total = 0 then
    raise exception 'No hay filas para procesar.';
  end if;

  if v_total > 50000 then
    raise exception 'El lote excede el maximo de 50000 filas.';
  end if;

  select workflow_id
  into v_campaign_workflow_id
  from public.campaigns
  where id = p_campaign_id;

  if not found then
    raise exception 'La campana no existe.';
  end if;

  insert into public.integration_sources (code, name, source_kind)
  values (lower(btrim(p_source_code)), p_source_code, 'bigdata')
  on conflict (code) do update
  set is_active = true,
      updated_at = now()
  returning id into v_source_id;

  insert into public.external_import_batches (
    source_id,
    campaign_id,
    batch_type,
    file_name,
    checksum,
    rows_total,
    status,
    uploaded_by
  )
  values (
    v_source_id,
    p_campaign_id,
    coalesce(nullif(btrim(p_batch_type), ''), 'lead_import'),
    nullif(btrim(coalesce(p_file_name, '')), ''),
    nullif(btrim(coalesce(p_checksum, '')), ''),
    v_total,
    'processing',
    v_actor_id
  )
  returning id into v_batch_id;

  for v_row, v_row_number in
    select value, ordinality::integer
    from jsonb_array_elements(p_rows) with ordinality
  loop
    v_external_key := nullif(btrim(coalesce(v_row->>'external_key', v_row->>'id', v_row->>'key', '')), '');
    v_full_name := nullif(btrim(coalesce(v_row->>'full_name', v_row->>'name', v_row->>'razon_social', v_row->>'nombre', '')), '');
    v_rut := nullif(btrim(coalesce(v_row->>'rut', v_row->>'rut_empresa', v_row->>'tax_id', '')), '');
    v_phone := nullif(btrim(coalesce(v_row->>'phone', v_row->>'telefono', v_row->>'mobile', '')), '');
    v_email := public.atlas_normalize_email(coalesce(v_row->>'email', v_row->>'mail', v_row->>'correo'));
    v_status := coalesce(nullif(btrim(v_row->>'status'), ''), 'nuevo');
    v_team_id := coalesce(nullif(v_row->>'team_id', '')::uuid, v_actor_team_id);
    v_lead_id := null;
    v_existing_ref := null;
    v_created_lead := false;

    if v_full_name is null then
      v_full_name := coalesce(v_email, v_phone, v_rut, v_external_key, 'Lead externo');
    end if;

    if v_external_key is not null then
      select r.id, r.lead_id
      into v_existing_ref, v_lead_id
      from public.lead_external_refs r
      where r.source_id = v_source_id
        and r.campaign_id = p_campaign_id
        and r.external_key = v_external_key
      limit 1;
    end if;

    if v_lead_id is null and v_rut is not null then
      select l.id
      into v_lead_id
      from public.leads l
      where l.campaign_id = p_campaign_id
        and public.atlas_normalize_rut(l.rut) = public.atlas_normalize_rut(v_rut)
      order by l.updated_at desc
      limit 1;
    end if;

    if v_lead_id is null and v_phone is not null then
      select l.id
      into v_lead_id
      from public.leads l
      where l.campaign_id = p_campaign_id
        and public.atlas_normalize_phone(l.phone) = public.atlas_normalize_phone(v_phone)
      order by l.updated_at desc
      limit 1;
    end if;

    if v_lead_id is null and v_email is not null then
      select l.id
      into v_lead_id
      from public.leads l
      where l.campaign_id = p_campaign_id
        and public.atlas_normalize_email(l.email) = v_email
      order by l.updated_at desc
      limit 1;
    end if;

    if v_lead_id is null and (v_rut is not null or v_phone is not null or v_email is not null or v_external_key is not null) then
      insert into public.leads (
        full_name,
        rut,
        phone,
        email,
        status,
        team_id,
        workflow_id,
        campaign_id,
        created_by,
        assignment_status,
        workflow_status,
        external_last_source_code,
        external_last_seen_at,
        extra
      )
      values (
        v_full_name,
        v_rut,
        v_phone,
        v_email,
        v_status,
        v_team_id,
        v_campaign_workflow_id,
        p_campaign_id,
        v_actor_id,
        'unassigned',
        'pending',
        lower(btrim(p_source_code)),
        now(),
        jsonb_build_object('external_source', lower(btrim(p_source_code)), 'external_payload', v_row)
      )
      on conflict do nothing
      returning id into v_lead_id;

      if v_lead_id is null then
        v_duplicates := v_duplicates + 1;
        if v_rut is not null then
          select l.id
          into v_lead_id
          from public.leads l
          where l.campaign_id = p_campaign_id
            and public.atlas_normalize_rut(l.rut) = public.atlas_normalize_rut(v_rut)
          order by l.updated_at desc
          limit 1;
        elsif v_phone is not null then
          select l.id
          into v_lead_id
          from public.leads l
          where l.campaign_id = p_campaign_id
            and public.atlas_normalize_phone(l.phone) = public.atlas_normalize_phone(v_phone)
          order by l.updated_at desc
          limit 1;
        end if;
      else
        v_inserted := v_inserted + 1;
        v_created_lead := true;
      end if;
    end if;

    if v_lead_id is null then
      v_unmatched := v_unmatched + 1;
      insert into public.external_lead_events (
        source_id,
        import_batch_id,
        campaign_id,
        external_key,
        event_type,
        payload
      )
      values (v_source_id, v_batch_id, p_campaign_id, v_external_key, 'lead.unmatched', v_row);
      continue;
    end if;

    if not v_created_lead then
      v_matched := v_matched + 1;
    end if;

    update public.leads
    set
      rut = coalesce(nullif(rut, ''), v_rut),
      phone = coalesce(nullif(phone, ''), v_phone),
      email = coalesce(public.atlas_normalize_email(email), v_email),
      external_last_source_code = lower(btrim(p_source_code)),
      external_last_seen_at = now(),
      extra = coalesce(extra, '{}'::jsonb) || jsonb_build_object('last_external_payload', v_row)
    where id = v_lead_id;

    if v_external_key is not null then
      insert into public.lead_external_refs (
        source_id,
        campaign_id,
        lead_id,
        external_key,
        source_payload,
        last_batch_id
      )
      values (
        v_source_id,
        p_campaign_id,
        v_lead_id,
        v_external_key,
        v_row,
        v_batch_id
      )
      on conflict (source_id, campaign_id, external_key)
      do update set
        lead_id = excluded.lead_id,
        source_payload = excluded.source_payload,
        last_seen_at = now(),
        last_batch_id = excluded.last_batch_id;
    end if;

    insert into public.external_lead_events (
      source_id,
      import_batch_id,
      campaign_id,
      lead_id,
      external_key,
      event_type,
      occurred_at,
      payload
    )
    values (
      v_source_id,
      v_batch_id,
      p_campaign_id,
      v_lead_id,
      v_external_key,
      coalesce(nullif(v_row->>'event_type', ''), 'lead.upserted'),
      nullif(v_row->>'occurred_at', '')::timestamptz,
      v_row || jsonb_build_object('row_number', v_row_number)
    );
  end loop;

  update public.external_import_batches
  set
    rows_inserted = v_inserted,
    rows_matched = v_matched,
    rows_unmatched = v_unmatched,
    duplicate_count = v_duplicates,
    status = 'succeeded',
    processed_at = now()
  where id = v_batch_id;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'source_id', v_source_id,
    'rows_total', v_total,
    'inserted', v_inserted,
    'matched', v_matched,
    'unmatched', v_unmatched,
    'duplicates', v_duplicates
  );
exception
  when others then
    if v_batch_id is not null then
      update public.external_import_batches
      set status = 'failed',
          error = sqlerrm,
          processed_at = now()
      where id = v_batch_id;
    end if;
    raise;
end;
$function$;

create or replace function public.apply_mail_result_batch(
  p_source_code text,
  p_campaign_id uuid,
  p_rows jsonb,
  p_report_date date default current_date,
  p_report_period text default 'manual',
  p_base_id uuid default null,
  p_file_name text default null,
  p_checksum text default null,
  p_source_label text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_actor_role text := coalesce((select public.current_role_name())::text, '');
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
  if v_actor_id is null then
    raise exception 'No autenticado.';
  end if;

  if nullif(btrim(coalesce(p_source_code, '')), '') is null then
    raise exception 'El codigo de plataforma mail es obligatorio.';
  end if;

  if p_campaign_id is null then
    raise exception 'La campana es obligatoria para resultados mail.';
  end if;

  if v_actor_role not in ('admin', 'supervisor') or not public.can_manage_campaign(p_campaign_id) then
    raise exception 'No tienes permisos para cargar resultados mail en esta campana.';
  end if;

  if v_total = 0 then
    raise exception 'No hay filas mail para procesar.';
  end if;

  if v_total > 50000 then
    raise exception 'El lote excede el maximo de 50000 filas.';
  end if;

  insert into public.integration_sources (code, name, source_kind)
  values (lower(btrim(p_source_code)), p_source_code, 'mail_platform')
  on conflict (code) do update
  set source_kind = case
        when public.integration_sources.source_kind = 'bigdata' then public.integration_sources.source_kind
        else 'mail_platform'
      end,
      is_active = true,
      updated_at = now()
  returning id into v_source_id;

  insert into public.mail_result_batches (
    campaign_id,
    source_id,
    base_id,
    report_date,
    report_period,
    source_label,
    file_name,
    checksum,
    rows_total,
    uploaded_by
  )
  values (
    p_campaign_id,
    v_source_id,
    p_base_id,
    coalesce(p_report_date, current_date),
    coalesce(nullif(btrim(p_report_period), ''), 'manual'),
    nullif(btrim(coalesce(p_source_label, '')), ''),
    nullif(btrim(coalesce(p_file_name, '')), ''),
    nullif(btrim(coalesce(p_checksum, '')), ''),
    v_total,
    v_actor_id
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
      where l.campaign_id = p_campaign_id
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
      p_campaign_id,
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
      p_campaign_id,
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
    where s.campaign_id = p_campaign_id
      and s.lead_id = v_lead_id
      and l.id = s.lead_id;
  end loop;

  update public.mail_result_batches
  set
    rows_processed = v_processed,
    rows_matched = v_matched,
    rows_unmatched = v_unmatched,
    processed_at = now()
  where id = v_batch_id;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'source_id', v_source_id,
    'rows_total', v_total,
    'processed', v_processed,
    'matched', v_matched,
    'unmatched', v_unmatched
  );
end;
$function$;

alter table public.integration_sources enable row level security;
alter table public.external_import_batches enable row level security;
alter table public.lead_external_refs enable row level security;
alter table public.external_lead_events enable row level security;
alter table public.mail_campaign_bases enable row level security;
alter table public.mail_campaign_base_recipients enable row level security;
alter table public.mail_result_batches enable row level security;
alter table public.mail_result_contacts enable row level security;
alter table public.lead_mail_status enable row level security;

create policy integration_sources_select
on public.integration_sources
for select
to authenticated
using (true);

create policy integration_sources_admin_write
on public.integration_sources
for all
to authenticated
using ((select public.current_role_name()) = 'admin')
with check ((select public.current_role_name()) = 'admin');

create policy external_import_batches_select
on public.external_import_batches
for select
to authenticated
using (
  (select public.current_role_name()) = 'admin'
  or public.can_manage_campaign(campaign_id)
);

create policy lead_external_refs_select
on public.lead_external_refs
for select
to authenticated
using (
  exists (
    select 1
    from public.leads l
    where l.id = lead_external_refs.lead_id
  )
);

create policy external_lead_events_select
on public.external_lead_events
for select
to authenticated
using (
  (lead_id is not null and exists (
    select 1
    from public.leads l
    where l.id = external_lead_events.lead_id
  ))
  or (lead_id is null and public.can_manage_campaign(campaign_id))
);

create policy mail_campaign_bases_select
on public.mail_campaign_bases
for select
to authenticated
using (public.can_manage_campaign(campaign_id));

create policy mail_campaign_bases_manage
on public.mail_campaign_bases
for all
to authenticated
using (public.can_manage_campaign(campaign_id))
with check (public.can_manage_campaign(campaign_id));

create policy mail_campaign_base_recipients_select
on public.mail_campaign_base_recipients
for select
to authenticated
using (public.can_manage_campaign(campaign_id));

create policy mail_result_batches_select
on public.mail_result_batches
for select
to authenticated
using (public.can_manage_campaign(campaign_id));

create policy mail_result_contacts_select
on public.mail_result_contacts
for select
to authenticated
using (
  public.can_manage_campaign(campaign_id)
  or (
    lead_id is not null
    and exists (
      select 1
      from public.leads l
      where l.id = mail_result_contacts.lead_id
    )
  )
);

create policy lead_mail_status_select
on public.lead_mail_status
for select
to authenticated
using (
  public.can_manage_campaign(campaign_id)
  or exists (
    select 1
    from public.leads l
    where l.id = lead_mail_status.lead_id
  )
);

grant select, insert, update, delete on public.integration_sources to authenticated;
grant select on public.external_import_batches to authenticated;
grant select on public.lead_external_refs to authenticated;
grant select on public.external_lead_events to authenticated;
grant select, insert, update, delete on public.mail_campaign_bases to authenticated;
grant select on public.mail_campaign_base_recipients to authenticated;
grant select on public.mail_result_batches to authenticated;
grant select on public.mail_result_contacts to authenticated;
grant select on public.lead_mail_status to authenticated;

revoke insert, update, delete on public.external_import_batches from anon, authenticated;
revoke insert, update, delete on public.lead_external_refs from anon, authenticated;
revoke insert, update, delete on public.external_lead_events from anon, authenticated;
revoke insert, update, delete on public.mail_campaign_base_recipients from anon, authenticated;
revoke insert, update, delete on public.mail_result_batches from anon, authenticated;
revoke insert, update, delete on public.mail_result_contacts from anon, authenticated;
revoke insert, update, delete on public.lead_mail_status from anon, authenticated;

revoke all on function public.upsert_external_leads(text, uuid, jsonb, text, text, text) from public, anon;
grant execute on function public.upsert_external_leads(text, uuid, jsonb, text, text, text) to authenticated;

revoke all on function public.apply_mail_result_batch(text, uuid, jsonb, date, text, uuid, text, text, text) from public, anon;
grant execute on function public.apply_mail_result_batch(text, uuid, jsonb, date, text, uuid, text, text, text) to authenticated;

revoke all on function public.can_manage_campaign(uuid) from public, anon;
grant execute on function public.can_manage_campaign(uuid) to authenticated;
