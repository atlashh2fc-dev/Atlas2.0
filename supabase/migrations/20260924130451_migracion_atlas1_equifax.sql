-- Migración final de Equifax desde Atlas 1 (Registro Intel, Supabase ususjzjmlaldtrnrzgbe).
--
-- Alcance acordado el 24-09-2026: solo clientes gestionados y agendas, con todo su
-- historial de llamadas hasta el corte. La base sin gestionar no se trae: el discado
-- parte limpio en Atlas 2.0.
--
-- Flujo:
--   1. scripts/migracion-atlas1-equifax.mjs extrae de Atlas 1 y llena las tablas mig_a1_*.
--   2. set session_replication_role = replica; select public.migracion_atlas1_equifax_ensayo();
--      (informe, sin escribir nada)
--   3. set session_replication_role = replica; select public.migracion_atlas1_equifax_aplicar(false);
--
-- Idempotente: los clientes se cruzan por legacy_lead_id, RUT o teléfono, y las llamadas
-- por legacy_call_id. Correrla dos veces no duplica; una segunda pasada solo agrega lo
-- que Atlas 1 haya registrado después de la primera.
--
-- Las tablas mig_a1_* son temporales: se eliminan cuando se dé de baja Atlas 1.

create table if not exists public.mig_a1_agents (
  legacy_agent_id text primary key,
  full_name text,
  email text,
  role text
);

create table if not exists public.mig_a1_leads (
  legacy_lead_id text primary key,
  legacy_campaign text not null,
  rut text,
  razon_social text,
  nombre_cliente text,
  mail text,
  direccion text,
  phone_primary text,
  tipificacion_actual text,
  observacion_actual text,
  workflow_status text,
  assignment_status text,
  managed_at timestamptz,
  managed_by_legacy text,
  assigned_legacy text,
  next_action_at timestamptz,
  attempts_count integer,
  last_call_started_at timestamptz,
  created_at timestamptz,
  mail_first_opened_at timestamptz,
  mail_last_opened_at timestamptz,
  mail_first_clicked_at timestamptz,
  mail_last_clicked_at timestamptz
);

create table if not exists public.mig_a1_phones (
  legacy_phone_id text primary key,
  legacy_lead_id text not null,
  position integer,
  label text,
  phone_raw text,
  phone_normalized text,
  is_primary boolean,
  is_callable boolean
);

create table if not exists public.mig_a1_calls (
  legacy_call_id text primary key,
  legacy_lead_id text,
  legacy_campaign text not null,
  agent_legacy text,
  callback_owner_legacy text,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz,
  status text,
  outcome text,
  reason text,
  notes text,
  next_action_at timestamptz,
  phone_number text,
  duration_seconds integer,
  custom_fields jsonb,
  products text[],
  uf numeric
);

create index if not exists mig_a1_phones_lead_idx on public.mig_a1_phones (legacy_lead_id);
create index if not exists mig_a1_calls_lead_idx on public.mig_a1_calls (legacy_lead_id);

-- Solo la llave de servicio (que salta RLS) puede leer o escribir el staging.
alter table public.mig_a1_agents enable row level security;
alter table public.mig_a1_leads enable row level security;
alter table public.mig_a1_phones enable row level security;
alter table public.mig_a1_calls enable row level security;
revoke all on public.mig_a1_agents, public.mig_a1_leads, public.mig_a1_phones, public.mig_a1_calls
  from anon, authenticated;

create or replace function public.migracion_atlas1_equifax_aplicar(p_ensayo boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org constant uuid := 'e64a8fa5-2f38-4460-97d8-f6b19634dccd';
  v_team constant uuid := '5034eefb-fb15-4291-b36a-aef6cf2ab7e1';
  v_source constant text := 'equifax_crm_legado';
  v_sentinel uuid;
  v_report jsonb := '{}'::jsonb;
  v_count integer;
begin
  -- El historial no debe disparar validaciones de cierre, reparaciones de llamadas abiertas
  -- ni el recálculo de reportes fila a fila; los reportes se recalculan al final por rango.
  -- Una función no puede apagar los triggers: lo hace la sesión que la llama.
  if current_setting('session_replication_role') <> 'replica' then
    raise exception 'Corre antes: set session_replication_role = replica;';
  end if;

  select id into v_sentinel from public.profiles where email = 'migracion-historica@system.local';
  if v_sentinel is null then
    raise exception 'Falta el perfil centinela migracion-historica@system.local';
  end if;

  -- 1. Campañas de Atlas 1 → campañas de Atlas 2.0.
  drop table if exists _mig_camp;
  create temp table _mig_camp (legacy_campaign text primary key, campaign_id uuid not null, workflow_id uuid) on commit drop;
  insert into _mig_camp values
    ('Equifax', '318cf37a-da42-4cbd-934d-bdc47753d7bd', 'c62a0bf7-7669-4646-b5ce-7765d08fd546'),
    ('Dicom OT', '318cf37a-da42-4cbd-934d-bdc47753d7bd', 'c62a0bf7-7669-4646-b5ce-7765d08fd546'),
    ('Equifax Cyber', '6564f137-d2c9-461a-a71b-bc74e046fd88', null),
    ('Equifax 15% descuento - Mora Control Informes Portfolio Junio 2026', '559a276a-5ecb-4890-839c-d84396dc2297', null),
    ('Reportes Interactivos Equifax - Flash Junio 2026', 'e3e156dc-436d-487e-b11e-a14622650529', null);

  -- 2. Ejecutivos: todo ejecutivo legado queda como agente histórico; se vincula a su
  --    perfil de Atlas 2.0 solo por correo exacto. El resto lo activa un admin.
  insert into public.historical_agents (full_name, legacy_system, legacy_executive_id, organization_id)
  select coalesce(nullif(btrim(a.full_name), ''), a.email, 'Ejecutivo legado'), v_source, a.legacy_agent_id, v_org
  from public.mig_a1_agents a
  on conflict (legacy_system, legacy_executive_id) do nothing;
  get diagnostics v_count = row_count;
  v_report := v_report || jsonb_build_object('agentes_historicos_nuevos', v_count);

  update public.historical_agents h
  set linked_profile_id = p.id
  from public.mig_a1_agents a
  join public.profiles p on lower(p.email) = lower(btrim(a.email))
  where h.legacy_system = v_source
    and h.legacy_executive_id = a.legacy_agent_id
    and h.linked_profile_id is null
    and p.id <> v_sentinel
    and p.organization_id = v_org;
  get diagnostics v_count = row_count;
  v_report := v_report || jsonb_build_object('agentes_vinculados_por_correo', v_count);

  -- Lo ya migrado de un ejecutivo recién vinculado pasa a su perfil, como en «Activar ejecutivo histórico».
  update public.calls c set agent_id = h.linked_profile_id
  from public.historical_agents h
  where c.historical_agent_id = h.id and h.linked_profile_id is not null and c.agent_id = v_sentinel;
  get diagnostics v_count = row_count;
  v_report := v_report || jsonb_build_object('llamadas_previas_reasignadas', v_count);

  update public.interactions i set agent_id = h.linked_profile_id
  from public.historical_agents h
  where i.historical_agent_id = h.id and h.linked_profile_id is not null and i.agent_id = v_sentinel;

  drop table if exists _mig_ag;
  create temp table _mig_ag on commit drop as
  select h.legacy_executive_id as legacy_agent_id, h.id as historical_agent_id, h.linked_profile_id as profile_id, h.full_name
  from public.historical_agents h
  where h.legacy_system = v_source;
  create unique index on _mig_ag (legacy_agent_id);

  -- 3. Clientes. Atlas 1 tiene el mismo RUT repetido en varias filas: se agrupan por
  --    campaña destino + RUT (o teléfono si no hay RUT) y cada grupo es un solo lead.
  drop table if exists _mig_sl;
  create temp table _mig_sl on commit drop as
  select s.*,
    c.campaign_id,
    c.workflow_id,
    -- Sin ceros a la izquierda: Atlas 1 tiene el mismo RUT como 76124965-7 y 076124965-7.
    nullif(ltrim(public.normalize_lead_rut(s.rut), '0'), '') as rut_norm,
    nullif(public.normalize_lead_contact('phone', s.phone_primary), '') as phone_norm,
    nullif(public.normalize_lead_contact('email', split_part(regexp_replace(coalesce(s.mail, ''), '[;,|[:space:]]+', ' ', 'g'), ' ', 1)), '') as email_first
  from public.mig_a1_leads s
  join _mig_camp c on c.legacy_campaign = s.legacy_campaign;

  alter table _mig_sl add column grp text;
  update _mig_sl set grp = campaign_id::text || ':' || coalesce('R' || rut_norm, 'P' || phone_norm, 'L' || legacy_lead_id);
  create index on _mig_sl (legacy_lead_id);
  create index on _mig_sl (grp);
  analyze _mig_sl;

  select count(*) into v_count from public.mig_a1_leads s where not exists (select 1 from _mig_camp c where c.legacy_campaign = s.legacy_campaign);
  v_report := v_report || jsonb_build_object(
    'clientes_extraidos', (select count(*) from public.mig_a1_leads),
    'clientes_campana_sin_destino', v_count,
    'clientes_unicos', (select count(distinct grp) from _mig_sl)
  );

  -- Cruce contra Atlas 2.0, en orden de confianza: legacy_lead_id, RUT, teléfono.
  drop table if exists _mig_match;
  create temp table _mig_match (grp text primary key, lead_id uuid not null, match_by text not null) on commit drop;

  insert into _mig_match
  select distinct on (s.grp) s.grp, l.id, 'legacy_id'
  from _mig_sl s join public.leads l on l.legacy_lead_id = s.legacy_lead_id
  order by s.grp, l.created_at;

  insert into _mig_match
  select distinct on (s.grp) s.grp, l.id, 'rut'
  from _mig_sl s
  join public.leads l
    on coalesce(l.campaign_id, '00000000-0000-0000-0000-000000000000'::uuid) = s.campaign_id
   and ltrim(upper(regexp_replace(l.rut, '[^0-9kK]', '', 'g')), '0') = s.rut_norm
  where s.rut_norm is not null and l.rut is not null and btrim(l.rut) <> ''
  order by s.grp, l.created_at
  on conflict (grp) do nothing;

  insert into _mig_match
  select distinct on (s.grp) s.grp, l.id, 'telefono'
  from _mig_sl s
  join public.leads l
    on coalesce(l.campaign_id, '00000000-0000-0000-0000-000000000000'::uuid) = s.campaign_id
   and regexp_replace(l.phone, '[^0-9]', '', 'g') = s.phone_norm
  where s.rut_norm is null and s.phone_norm is not null
    and (l.rut is null or btrim(l.rut) = '')
  order by s.grp, l.created_at
  on conflict (grp) do nothing;

  v_report := v_report || jsonb_build_object(
    'cruce_por_legacy_id', (select count(*) from _mig_match where match_by = 'legacy_id'),
    'cruce_por_rut', (select count(*) from _mig_match where match_by = 'rut'),
    'cruce_por_telefono', (select count(*) from _mig_match where match_by = 'telefono')
  );

  -- Grupos sin par: se crean. La fila canónica es la más recientemente gestionada.
  drop table if exists _mig_new;
  create temp table _mig_new on commit drop as
  select distinct on (s.grp) s.*
  from _mig_sl s
  where not exists (select 1 from _mig_match m where m.grp = s.grp)
  order by s.grp, s.managed_at desc nulls last, s.last_call_started_at desc nulls last, s.legacy_lead_id;

  insert into public.leads (
    rut, phone, full_name, email, status, team_id, workflow_id, campaign_id, organization_id,
    legacy_lead_id, callback_mode, extra, created_at, updated_at
  )
  select
    case
      when n.rut_norm ~ '^[0-9]{6,9}[0-9K]$' then
        replace(to_char(left(n.rut_norm, -1)::bigint, 'FM999G999G999'), ',', '.') || '-' || right(n.rut_norm, 1)
      else nullif(btrim(n.rut), '')
    end,
    n.phone_primary,
    coalesce(nullif(btrim(n.razon_social), ''), nullif(btrim(n.nombre_cliente), ''), 'Cliente Equifax'),
    n.email_first,
    'Prospecto disponible',
    v_team,
    n.workflow_id,
    n.campaign_id,
    v_org,
    n.legacy_lead_id,
    'personal',
    jsonb_build_object('origen', 'atlas1_equifax_2026_09'),
    coalesce(n.created_at, now()),
    now()
  from _mig_new n;
  get diagnostics v_count = row_count;
  v_report := v_report || jsonb_build_object('clientes_nuevos', v_count);

  insert into _mig_match
  select n.grp, l.id, 'nuevo'
  from _mig_new n join public.leads l on l.legacy_lead_id = n.legacy_lead_id;

  -- Mapa final: toda fila de Atlas 1 → su lead en Atlas 2.0.
  drop table if exists _mig_lm;
  create temp table _mig_lm on commit drop as
  select s.legacy_lead_id, m.lead_id
  from _mig_sl s join _mig_match m on m.grp = s.grp;
  create unique index on _mig_lm (legacy_lead_id);
  create index on _mig_lm (lead_id);
  analyze _mig_lm;

  -- 4. Estado actual del cliente: gana Atlas 1, salvo que Atlas 2.0 tenga una gestión
  --    propia más reciente que la última de Atlas 1.
  --    Dueño: en Atlas 1 la agenda es de quien la agendó (está en la llamada, no en el
  --    cliente); sin agenda, de quien gestionó el cliente o del último que lo llamó.
  drop table if exists _mig_last_call;
  create temp table _mig_last_call on commit drop as
  select distinct on (legacy_lead_id) legacy_lead_id, agent_legacy
  from public.mig_a1_calls
  where legacy_lead_id is not null
  order by legacy_lead_id, started_at desc nulls last;
  create unique index on _mig_last_call (legacy_lead_id);

  drop table if exists _mig_agenda_call;
  create temp table _mig_agenda_call on commit drop as
  select distinct on (legacy_lead_id) legacy_lead_id, coalesce(callback_owner_legacy, agent_legacy) as owner_legacy
  from public.mig_a1_calls
  where legacy_lead_id is not null and next_action_at is not null
  order by legacy_lead_id, started_at desc nulls last;
  create unique index on _mig_agenda_call (legacy_lead_id);

  drop table if exists _mig_state;
  create temp table _mig_state on commit drop as
  select distinct on (lm.lead_id)
    lm.lead_id, s.*,
    case when s.next_action_at is not null
      then coalesce(ac.owner_legacy, s.managed_by_legacy, s.assigned_legacy, lc.agent_legacy)
      else coalesce(s.managed_by_legacy, s.assigned_legacy, lc.agent_legacy)
    end as owner_legacy
  from _mig_lm lm
  join _mig_sl s on s.legacy_lead_id = lm.legacy_lead_id
  left join _mig_agenda_call ac on ac.legacy_lead_id = s.legacy_lead_id
  left join _mig_last_call lc on lc.legacy_lead_id = s.legacy_lead_id
  order by lm.lead_id, s.managed_at desc nulls last, s.last_call_started_at desc nulls last, s.legacy_lead_id;

  alter table _mig_state add column atlas2_mas_reciente boolean;
  update _mig_state st set atlas2_mas_reciente = exists (
    select 1 from public.calls c
    where c.lead_id = st.lead_id
      and c.legacy_call_id is null
      and c.started_at > coalesce(st.last_call_started_at, st.managed_at, '-infinity'::timestamptz)
  );

  update public.leads l set
    tipificacion_actual = coalesce(st.tipificacion_actual, l.tipificacion_actual),
    observacion_actual = coalesce(st.observacion_actual, l.observacion_actual),
    workflow_status = case st.workflow_status when 'active' then 'managed' else st.workflow_status end,
    assignment_status = case st.assignment_status when 'in_progress' then 'managed' else st.assignment_status end,
    managed_at = st.managed_at,
    managed_by = ag.profile_id,
    next_action_at = st.next_action_at,
    next_action_channel = case when st.next_action_at is not null then 'phone' else l.next_action_channel end,
    callback_mode = 'personal',
    updated_at = now()
  from _mig_state st
  left join _mig_ag ag on ag.legacy_agent_id = st.owner_legacy
  where l.id = st.lead_id and not st.atlas2_mas_reciente;
  get diagnostics v_count = row_count;
  v_report := v_report || jsonb_build_object(
    'clientes_estado_actualizado', v_count,
    'clientes_con_gestion_mas_nueva_en_atlas2', (select count(*) from _mig_state where atlas2_mas_reciente)
  );

  -- Datos de contacto y huella de Atlas 1: se completan siempre, nunca se pisan.
  update public.leads l set
    email = coalesce(nullif(btrim(l.email), ''), st.email_first),
    phone = coalesce(nullif(btrim(l.phone), ''), st.phone_primary),
    full_name = coalesce(nullif(btrim(l.full_name), ''), nullif(btrim(st.razon_social), ''), nullif(btrim(st.nombre_cliente), '')),
    legacy_lead_id = coalesce(l.legacy_lead_id, case
      when not exists (select 1 from public.leads o where o.legacy_lead_id = st.legacy_lead_id) then st.legacy_lead_id
    end),
    extra = coalesce(l.extra, '{}'::jsonb) || jsonb_build_object('atlas1', jsonb_strip_nulls(jsonb_build_object(
      'legacy_lead_ids', (select jsonb_agg(lm.legacy_lead_id order by lm.legacy_lead_id) from _mig_lm lm where lm.lead_id = st.lead_id),
      'campana', st.legacy_campaign,
      'nombre_cliente', nullif(btrim(st.nombre_cliente), ''),
      'direccion', nullif(btrim(st.direccion), ''),
      'intentos', st.attempts_count,
      'correo_primera_apertura', st.mail_first_opened_at,
      'correo_ultima_apertura', st.mail_last_opened_at,
      'correo_primer_clic', st.mail_first_clicked_at,
      'correo_ultimo_clic', st.mail_last_clicked_at
    )))
  from _mig_state st
  where l.id = st.lead_id;

  -- 5. Todos los teléfonos y correos de Atlas 1 quedan como contactos del lead.
  insert into public.lead_contacts (lead_id, contact_type, value, normalized_value, label, is_primary, is_valid, source, metadata)
  select distinct on (lm.lead_id, public.normalize_lead_contact('phone', coalesce(p.phone_normalized, p.phone_raw)))
    lm.lead_id, 'phone', coalesce(nullif(btrim(p.phone_raw), ''), p.phone_normalized),
    public.normalize_lead_contact('phone', coalesce(p.phone_normalized, p.phone_raw)),
    p.label, coalesce(p.is_primary, false), coalesce(p.is_callable, true), 'atlas1',
    jsonb_build_object('legacy_lead_id', p.legacy_lead_id, 'legacy_phone_id', p.legacy_phone_id)
  from public.mig_a1_phones p
  join _mig_lm lm on lm.legacy_lead_id = p.legacy_lead_id
  where public.normalize_lead_contact('phone', coalesce(p.phone_normalized, p.phone_raw)) <> ''
    and btrim(coalesce(nullif(btrim(p.phone_raw), ''), p.phone_normalized, '')) <> ''
  order by lm.lead_id, public.normalize_lead_contact('phone', coalesce(p.phone_normalized, p.phone_raw)), p.is_primary desc nulls last, p.position
  on conflict (lead_id, contact_type, normalized_value) do nothing;
  get diagnostics v_count = row_count;
  v_report := v_report || jsonb_build_object('telefonos_agregados', v_count);

  insert into public.lead_contacts (lead_id, contact_type, value, normalized_value, is_primary, is_valid, source, metadata)
  select distinct on (lm.lead_id, public.normalize_lead_contact('email', e.email))
    lm.lead_id, 'email', btrim(e.email), public.normalize_lead_contact('email', e.email), false, true, 'atlas1',
    jsonb_build_object('legacy_lead_id', s.legacy_lead_id)
  from _mig_sl s
  join _mig_lm lm on lm.legacy_lead_id = s.legacy_lead_id
  cross join lateral regexp_split_to_table(coalesce(s.mail, ''), '[;,|[:space:]]+') as e(email)
  where e.email like '%_@_%.__%'
  order by lm.lead_id, public.normalize_lead_contact('email', e.email)
  on conflict (lead_id, contact_type, normalized_value) do nothing;
  get diagnostics v_count = row_count;
  v_report := v_report || jsonb_build_object('correos_agregados', v_count);

  -- 6. Llamadas. Ya existen si su id está cargado tal cual (junio) o con prefijo
  --    (importación de correo de julio: 'equifax_crm_legado:<call>:<lead>').
  drop table if exists _mig_existing;
  create temp table _mig_existing on commit drop as
  select case when legacy_call_id like v_source || ':%' then split_part(legacy_call_id, ':', 2) else legacy_call_id end as legacy_call_id
  from public.calls where legacy_call_id is not null;
  create index on _mig_existing (legacy_call_id);
  analyze _mig_existing;

  drop table if exists _mig_nc;
  create temp table _mig_nc on commit drop as
  select s.*, lm.lead_id, ag.historical_agent_id, coalesce(ag.profile_id, v_sentinel) as agent_id, cb.profile_id as callback_profile_id
  from public.mig_a1_calls s
  join _mig_lm lm on lm.legacy_lead_id = s.legacy_lead_id
  left join _mig_ag ag on ag.legacy_agent_id = s.agent_legacy
  left join _mig_ag cb on cb.legacy_agent_id = s.callback_owner_legacy
  where not exists (select 1 from _mig_existing e where e.legacy_call_id = s.legacy_call_id);

  v_report := v_report || jsonb_build_object(
    'llamadas_extraidas', (select count(*) from public.mig_a1_calls),
    'llamadas_ya_en_atlas2', (select count(*) from public.mig_a1_calls s where exists (select 1 from _mig_existing e where e.legacy_call_id = s.legacy_call_id)),
    'llamadas_sin_cliente', (select count(*) from public.mig_a1_calls s where not exists (select 1 from _mig_lm lm where lm.legacy_lead_id = s.legacy_lead_id))
  );

  insert into public.calls (
    lead_id, agent_id, historical_agent_id, legacy_call_id, status, outcome, reason, notes,
    next_action_at, callback_owner_user_id, equifax_products, equifax_uf_amount,
    started_at, ended_at, discarded_reason, created_at, updated_at
  )
  select
    n.lead_id, n.agent_id, n.historical_agent_id, n.legacy_call_id, n.status, n.outcome, n.reason, n.notes,
    n.next_action_at, n.callback_profile_id, n.products, n.uf,
    coalesce(n.started_at, n.created_at),
    coalesce(n.ended_at, n.started_at, n.created_at),
    case when n.ended_at is null and n.outcome is null and nullif(btrim(n.reason), '') is null
      then 'Llamada abierta sin tipificar en Atlas 1 (migración)' end,
    coalesce(n.created_at, n.started_at),
    coalesce(n.ended_at, n.started_at, n.created_at)
  from _mig_nc n;
  get diagnostics v_count = row_count;
  v_report := v_report || jsonb_build_object('llamadas_nuevas', v_count);

  -- Cada llamada también va a la línea de tiempo del cliente, con la ficha Equifax completa.
  insert into public.interactions (lead_id, agent_id, historical_agent_id, result, notes, legacy_source, created_at, metadata)
  select
    n.lead_id, n.agent_id, n.historical_agent_id,
    coalesce(nullif(btrim(n.reason), ''), n.outcome, n.status, 'Gestión legado'),
    n.notes, v_source,
    coalesce(n.ended_at, n.started_at, n.created_at),
    jsonb_strip_nulls(jsonb_build_object(
      'source', 'atlas1_equifax_2026_09',
      'call_id', c.id,
      'legacy_call_id', n.legacy_call_id,
      'legacy_lead_id', n.legacy_lead_id,
      'legacy_campaign', n.legacy_campaign,
      'status', n.status,
      'outcome', n.outcome,
      'next_action_at', n.next_action_at,
      'phone_number', n.phone_number,
      'duration_seconds', n.duration_seconds,
      'equifax', nullif(jsonb_strip_nulls(coalesce(n.custom_fields, '{}'::jsonb)), '{}'::jsonb)
    ))
  from _mig_nc n
  join public.calls c on c.legacy_call_id = n.legacy_call_id;
  get diagnostics v_count = row_count;
  v_report := v_report || jsonb_build_object('interacciones_nuevas', v_count);

  -- 7. Agendas: cuántas quedan visibles para su ejecutivo y cuántas esperan que se active.
  v_report := v_report || jsonb_build_object(
    'agendas_futuras', (select count(*) from _mig_state where next_action_at > now()),
    'agendas_vencidas', (select count(*) from _mig_state where next_action_at <= now() and workflow_status = 'callback'),
    'agendas_con_dueno_en_atlas2', (
      select count(*) from _mig_state st join _mig_ag ag on ag.legacy_agent_id = st.owner_legacy
      where st.next_action_at > now() and ag.profile_id is not null),
    'agendas_esperando_activar_ejecutivo', (
      select coalesce(jsonb_object_agg(x.nombre, x.n), '{}'::jsonb) from (
        select coalesce(ag.full_name, st.owner_legacy, 'sin ejecutivo') as nombre, count(*) as n
        from _mig_state st left join _mig_ag ag on ag.legacy_agent_id = st.owner_legacy
        where st.next_action_at > now() and ag.profile_id is null
        group by 1) x),
    'llamadas_por_ejecutivo_sin_perfil', (
      select coalesce(jsonb_object_agg(x.nombre, x.n), '{}'::jsonb) from (
        select coalesce(ag.full_name, n.agent_legacy, 'sin ejecutivo') as nombre, count(*) as n
        from _mig_nc n left join _mig_ag ag on ag.legacy_agent_id = n.agent_legacy
        where n.agent_id = v_sentinel
        group by 1) x)
  );

  if p_ensayo then
    -- Deshace todo lo anterior; el envoltorio de ensayo recoge el informe.
    raise exception using errcode = 'MA001', message = v_report::text;
  end if;

  return v_report;
end;
$$;

create or replace function public.migracion_atlas1_equifax_ensayo()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.migracion_atlas1_equifax_aplicar(true);
  return null;
exception when sqlstate 'MA001' then
  return sqlerrm::jsonb;
end;
$$;

revoke all on function public.migracion_atlas1_equifax_aplicar(boolean) from public, anon, authenticated;
revoke all on function public.migracion_atlas1_equifax_ensayo() from public, anon, authenticated;
grant execute on function public.migracion_atlas1_equifax_aplicar(boolean) to service_role;
grant execute on function public.migracion_atlas1_equifax_ensayo() to service_role;
