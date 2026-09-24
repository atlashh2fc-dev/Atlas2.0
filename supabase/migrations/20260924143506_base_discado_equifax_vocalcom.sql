-- Base de discado progresivo de Equifax, exportada desde Vocalcom el 24-09-2026.
--
-- Flujo:
--   1. scripts/cargar-base-discado-equifax.mjs lee el CSV, completa la razón social
--      desde Bigdata y llena mig_vc_base.
--   2. select public.base_discado_equifax_aplicar(true);   -- informe, sin escribir
--   3. select public.base_discado_equifax_aplicar(false);
--
-- Un RUT que ya existe en la campaña se completa, nunca se duplica ni se le pisa la
-- gestión: su tipificación y su estado siguen siendo los de Atlas. Cada lead de la base
-- recibe external_priority_rank para que el discador lo marque antes que el resto.

create table if not exists public.mig_vc_base (
  rut_norm text primary key,
  rut text not null,
  razon_social text,
  actividad text,
  rubro text,
  subrubro text,
  comuna text,
  region text,
  trabajadores text,
  tramo_ventas text,
  phone_primary text not null,
  phones jsonb not null default '[]'::jsonb,
  vc_indice integer,
  vc_called_at timestamptz,
  vc_agent_name text,
  vc_status_group text,
  vc_status_code text,
  vc_status_text text,
  vc_duration_seconds integer,
  vc_comments text
);

alter table public.mig_vc_base enable row level security;
revoke all on public.mig_vc_base from anon, authenticated;

create or replace function public.base_discado_equifax_aplicar(p_ensayo boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_campaign constant uuid := '318cf37a-da42-4cbd-934d-bdc47753d7bd';
  v_workflow constant uuid := 'c62a0bf7-7669-4646-b5ce-7765d08fd546';
  v_team constant uuid := '5034eefb-fb15-4291-b36a-aef6cf2ab7e1';
  v_org constant uuid := 'e64a8fa5-2f38-4460-97d8-f6b19634dccd';
  v_base constant text := 'vocalcom_2026_09_24';
  v_report jsonb := '{}'::jsonb;
  v_count integer;
begin
  -- Orden de discado: primero lo que Vocalcom nunca marcó, luego lo menos reciente.
  drop table if exists _vc;
  create temp table _vc on commit drop as
  select b.*, row_number() over (order by b.vc_called_at asc nulls first, b.vc_indice) as rank
  from public.mig_vc_base b;
  create unique index on _vc (rut_norm);
  analyze _vc;

  drop table if exists _vc_match;
  create temp table _vc_match on commit drop as
  select distinct on (v.rut_norm) v.rut_norm, l.id as lead_id
  from _vc v
  join public.leads l
    on l.campaign_id = v_campaign
   and ltrim(upper(regexp_replace(l.rut, '[^0-9kK]', '', 'g')), '0') = v.rut_norm
  where l.rut is not null and btrim(l.rut) <> ''
  order by v.rut_norm, l.created_at;
  create unique index on _vc_match (rut_norm);

  v_report := v_report || jsonb_build_object(
    'filas_base', (select count(*) from _vc),
    'ya_existian', (select count(*) from _vc_match),
    'con_razon_social', (select count(*) from _vc where razon_social is not null)
  );

  insert into public.leads (
    rut, phone, full_name, status, workflow_status, assignment_status, team_id, workflow_id,
    campaign_id, organization_id, callback_mode, external_last_source_code, external_last_seen_at,
    extra, created_at, updated_at
  )
  select
    case when v.rut_norm ~ '^[0-9]{6,9}[0-9K]$'
      then replace(to_char(left(v.rut_norm, -1)::bigint, 'FM999G999G999'), ',', '.') || '-' || right(v.rut_norm, 1)
      else v.rut end,
    v.phone_primary,
    coalesce(v.razon_social, 'Empresa RUT ' || v.rut),
    'Prospecto disponible', 'pending', 'pending', v_team, v_workflow, v_campaign, v_org, 'personal',
    'vocalcom', now(),
    jsonb_build_object('origen', v_base),
    now(), now()
  from _vc v
  where not exists (select 1 from _vc_match m where m.rut_norm = v.rut_norm);
  get diagnostics v_count = row_count;
  v_report := v_report || jsonb_build_object('leads_nuevos', v_count);

  insert into _vc_match
  select v.rut_norm, l.id
  from _vc v
  join public.leads l
    on l.campaign_id = v_campaign
   and ltrim(upper(regexp_replace(l.rut, '[^0-9kK]', '', 'g')), '0') = v.rut_norm
  where not exists (select 1 from _vc_match m where m.rut_norm = v.rut_norm)
    and l.extra->>'origen' = v_base;

  -- Ficha y último intento de Vocalcom: se completan sin pisar lo que Atlas ya sabe.
  update public.leads l set
    full_name = case
      when nullif(btrim(l.full_name), '') is null or l.full_name like 'Empresa RUT %' or l.full_name = 'Cliente Equifax'
      then coalesce(v.razon_social, l.full_name, 'Empresa RUT ' || v.rut)
      else l.full_name end,
    phone = coalesce(nullif(btrim(l.phone), ''), v.phone_primary),
    external_priority_rank = v.rank,
    external_priority_reason = 'Base de discado Equifax (Vocalcom 24-09-2026)',
    vocalcom_last_touched_at = case
      when v.vc_called_at is not null and v.vc_called_at > coalesce(l.vocalcom_last_touched_at, '-infinity'::timestamptz)
      then v.vc_called_at else l.vocalcom_last_touched_at end,
    vocalcom_last_connection_status = case
      when v.vc_called_at is not null and v.vc_called_at > coalesce(l.vocalcom_last_touched_at, '-infinity'::timestamptz)
      then v.vc_status_text else l.vocalcom_last_connection_status end,
    vocalcom_last_duration_seconds = case
      when v.vc_called_at is not null and v.vc_called_at > coalesce(l.vocalcom_last_touched_at, '-infinity'::timestamptz)
      then v.vc_duration_seconds else l.vocalcom_last_duration_seconds end,
    extra = coalesce(l.extra, '{}'::jsonb) || jsonb_build_object('base_discado', jsonb_strip_nulls(jsonb_build_object(
      'base', v_base,
      'actividad', v.actividad,
      'rubro', v.rubro,
      'subrubro', v.subrubro,
      'comuna', v.comuna,
      'region', v.region,
      'trabajadores', v.trabajadores,
      'tramo_ventas', v.tramo_ventas,
      'vocalcom_ultimo_intento', v.vc_called_at,
      'vocalcom_ejecutivo', v.vc_agent_name,
      'vocalcom_resultado', v.vc_status_text,
      'vocalcom_codigo', v.vc_status_code,
      'vocalcom_duracion', v.vc_duration_seconds,
      'vocalcom_comentario', v.vc_comments
    ))),
    updated_at = now()
  from _vc_match m
  join _vc v on v.rut_norm = m.rut_norm
  where l.id = m.lead_id;
  get diagnostics v_count = row_count;
  v_report := v_report || jsonb_build_object('leads_actualizados', v_count);

  insert into public.lead_contacts (lead_id, contact_type, value, normalized_value, label, is_primary, is_valid, source, metadata)
  select distinct on (m.lead_id, public.normalize_lead_contact('phone', p->>'value'))
    m.lead_id, 'phone', p->>'value', public.normalize_lead_contact('phone', p->>'value'), p->>'source',
    (p->>'value') = v.phone_primary, true, v_base, jsonb_build_object('columna', p->>'source')
  from _vc_match m
  join _vc v on v.rut_norm = m.rut_norm
  cross join lateral jsonb_array_elements(v.phones) as p
  where public.normalize_lead_contact('phone', p->>'value') <> ''
  order by m.lead_id, public.normalize_lead_contact('phone', p->>'value'), ((p->>'value') = v.phone_primary) desc
  on conflict (lead_id, contact_type, normalized_value) do nothing;
  get diagnostics v_count = row_count;
  v_report := v_report || jsonb_build_object('telefonos_agregados', v_count);

  -- Cuántos quedan de verdad en la cola del progresivo (mismas reglas que claim_next_dial_targets).
  v_report := v_report || (
    select jsonb_build_object(
      'en_cola_de_discado', count(*) filter (where
        l.phone is not null and btrim(l.phone) <> '' and l.next_action_at is null
        and coalesce(l.assignment_status, 'pending') not in ('managed', 'exception')
        and coalesce(l.workflow_status, 'pending') not in ('managed', 'exception', 'callback')),
      'fuera_por_gestion_cerrada', count(*) filter (where
        coalesce(l.assignment_status, 'pending') in ('managed', 'exception')
        or coalesce(l.workflow_status, 'pending') in ('managed', 'exception')),
      'con_agenda', count(*) filter (where l.next_action_at is not null)
    )
    from _vc_match m join public.leads l on l.id = m.lead_id
  );

  if p_ensayo then
    raise exception using errcode = 'MA002', message = v_report::text;
  end if;
  return v_report;
end;
$$;

create or replace function public.base_discado_equifax_ensayo()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.base_discado_equifax_aplicar(true);
  return null;
exception when sqlstate 'MA002' then
  return sqlerrm::jsonb;
end;
$$;

revoke all on function public.base_discado_equifax_aplicar(boolean) from public, anon, authenticated;
revoke all on function public.base_discado_equifax_ensayo() from public, anon, authenticated;
grant execute on function public.base_discado_equifax_aplicar(boolean) to service_role;
grant execute on function public.base_discado_equifax_ensayo() to service_role;
