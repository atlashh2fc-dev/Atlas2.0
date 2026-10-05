-- Base Equifax de octubre 2026 con prioridad del score IA de Equifax.
--
-- Fuente: Proceso_Octubre_Equifax_FINAL_AUDITADO.xlsx (hojas 02 certificados y 03 no
-- certificados), cruzada con Atlas y con Bigdata (mdata) para completar la ficha.
-- Ya vienen fuera: CARTERA, rechazos previos, gestiones en curso, clientes molestos,
-- carterizados, quiebras, término de giro y teléfonos suprimidos o compartidos.
--
-- Flujo:
--   1. scripts/cargar-base-equifax-octubre.mjs sube el CSV a mig_eq_oct_base.
--   2. select public.base_equifax_octubre_ensayo();          -- informe, sin escribir
--   3. select public.base_equifax_octubre_aplicar(false);     -- aplica
--
-- Reglas:
--   * Un RUT que ya existe en la campaña nunca se duplica ni se le borra la gestión:
--     tipificación y observaciones quedan como están.
--   * El discador marca solo leads.phone. Si Equifax trae teléfono nuevo, pasa a ser el
--     principal y el anterior queda guardado en lead_contacts ('telefono_anterior').
--   * Un lead cerrado por no contacto (no conecta, no contesta, buzón, número erróneo,
--     fuera de servicio, tercero) se reabre con ciclo nuevo para que los intentos del
--     número viejo no lo topen. Nunca se reabre un rechazo, una agenda ni un cliente.
--   * external_priority_rank = orden Equifax (1 = primero). Con p_desplazar_anterior,
--     el resto de la base Vocalcom 24-09 pasa detrás (+100000) sin perder su orden.

create table if not exists public.mig_eq_oct_base (
  rut_norm text primary key,
  rut text not null,
  razon_social text,
  actividad text,
  rubro text,
  subrubro text,
  region text,
  comuna text,
  direccion text,
  trabajadores text,
  tramo_ventas text,
  tamano_empresa text,
  tendencia_ventas text,
  email text,
  email_fuente text,
  contacto_nombre text,
  contacto_cargo text,
  contacto_email text,
  contacto_fuente text,
  phone_primary text,
  phones jsonb not null default '[]'::jsonb,
  n_tel_nuevos integer,
  rank integer not null,
  hoja_equifax text,
  orden_equifax integer,
  score_ia_principal numeric,
  score_ia_independiente numeric,
  prioridad_comercial text,
  confianza_modelo text,
  contactabilidad text,
  accion_carga text,
  atlas_ult_tipif text
);

alter table public.mig_eq_oct_base enable row level security;
revoke all on public.mig_eq_oct_base from anon, authenticated;

create or replace function public.base_equifax_octubre_aplicar(
  p_ensayo boolean default true,
  p_desplazar_anterior boolean default true
)
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
  v_base constant text := 'equifax_ia_2026_10';
  v_reason constant text := 'Base Equifax Octubre 2026 (score IA Equifax)';
  v_reason_anterior constant text := 'Base de discado Equifax (Vocalcom 24-09-2026)';
  v_desplazamiento constant integer := 100000;
  -- Tipificaciones de no contacto: con teléfono nuevo vale la pena volver a marcar.
  v_reabrible constant text[] := array[
    'NO CONECTA', 'NO CONTESTA', 'BUZON DE VOZ', 'NO COMUNICA', 'NUMERO ERRONEO / NO CORRESPONDE',
    'NUMERO ERRONEO', 'TELEFONO FUERA DE SERVICIO', 'FUERA DE SERVICIO', 'OCUPADO', 'TELEFONO OCUPADO',
    'CORTA LLAMADA', 'TERCERO NO ENTREGA INFORMACION', 'CONTACTO CON TERCERO', 'DISPONIBLE_BUSQUEDA'
  ];
  v_report jsonb := '{}'::jsonb;
  v_count integer;
begin
  drop table if exists _eq;
  create temp table _eq on commit drop as select b.* from public.mig_eq_oct_base b;
  create unique index on _eq (rut_norm);
  analyze _eq;

  drop table if exists _eq_match;
  create temp table _eq_match on commit drop as
  select distinct on (v.rut_norm) v.rut_norm, l.id as lead_id
  from _eq v
  join public.leads l
    on l.campaign_id = v_campaign
   and ltrim(upper(regexp_replace(l.rut, '[^0-9kK]', '', 'g')), '0') = v.rut_norm
  where l.rut is not null and btrim(l.rut) <> ''
  order by v.rut_norm, l.created_at;
  create unique index on _eq_match (rut_norm);

  v_report := v_report || jsonb_build_object(
    'filas_base', (select count(*) from _eq),
    'ya_existian', (select count(*) from _eq_match),
    'nuevos_sin_telefono_omitidos', (select count(*) from _eq v
      where v.phone_primary is null and not exists (select 1 from _eq_match m where m.rut_norm = v.rut_norm))
  );

  -- 1. Leads nuevos.
  insert into public.leads (
    rut, phone, full_name, email, status, workflow_status, assignment_status, team_id, workflow_id,
    campaign_id, organization_id, callback_mode, external_last_source_code, external_last_seen_at,
    extra, created_at, updated_at
  )
  select
    case when v.rut_norm ~ '^[0-9]{6,9}[0-9K]$'
      then replace(to_char(left(v.rut_norm, -1)::bigint, 'FM999G999G999'), ',', '.') || '-' || right(v.rut_norm, 1)
      else v.rut end,
    v.phone_primary,
    coalesce(v.razon_social, 'Empresa RUT ' || v.rut),
    v.email,
    'Prospecto disponible', 'pending', 'pending', v_team, v_workflow, v_campaign, v_org, 'personal',
    'equifax_ia', now(),
    jsonb_build_object('origen', v_base),
    now(), now()
  from _eq v
  where v.phone_primary is not null
    and not exists (select 1 from _eq_match m where m.rut_norm = v.rut_norm);
  get diagnostics v_count = row_count;
  v_report := v_report || jsonb_build_object('leads_nuevos', v_count);

  drop table if exists _eq_new;
  create temp table _eq_new on commit drop as
  select distinct on (v.rut_norm) v.rut_norm, l.id as lead_id
  from _eq v
  join public.leads l
    on l.campaign_id = v_campaign
   and ltrim(upper(regexp_replace(l.rut, '[^0-9kK]', '', 'g')), '0') = v.rut_norm
  where not exists (select 1 from _eq_match m where m.rut_norm = v.rut_norm)
    and l.extra->>'origen' = v_base
  order by v.rut_norm, l.created_at desc;
  insert into _eq_match select rut_norm, lead_id from _eq_new;

  -- 2. Qué se hace con cada lead existente.
  drop table if exists _eq_plan;
  create temp table _eq_plan on commit drop as
  select
    m.lead_id, v.rut_norm,
    exists (select 1 from _eq_new n where n.lead_id = m.lead_id) as es_nuevo,
    l.phone as phone_anterior,
    v.phone_primary is not null
      and public.normalize_lead_contact('phone', coalesce(l.phone, '')) <> public.normalize_lead_contact('phone', v.phone_primary)
      and l.next_action_at is null
      and coalesce(l.workflow_status, 'pending') <> 'callback'
      and (coalesce(l.workflow_status, 'pending') = 'pending'
           or upper(btrim(coalesce(l.tipificacion_actual, ''))) = any(v_reabrible)
           or nullif(btrim(l.tipificacion_actual), '') is null) as cambia_fono,
    v.phone_primary is not null
      and l.next_action_at is null
      and coalesce(l.workflow_status, 'pending') in ('managed', 'exception')
      and (upper(btrim(coalesce(l.tipificacion_actual, ''))) = any(v_reabrible)
           or nullif(btrim(l.tipificacion_actual), '') is null) as reabre
  from _eq_match m
  join _eq v on v.rut_norm = m.rut_norm
  join public.leads l on l.id = m.lead_id;
  create unique index on _eq_plan (lead_id);

  v_report := v_report || jsonb_build_object(
    'existentes_con_telefono_nuevo_principal', (select count(*) from _eq_plan where cambia_fono and not es_nuevo),
    'existentes_reabiertos', (select count(*) from _eq_plan where reabre and not es_nuevo),
    'existentes_solo_prioridad_y_ficha', (select count(*) from _eq_plan where not cambia_fono and not reabre and not es_nuevo)
  );

  -- 3. Guardar el teléfono anterior antes de reemplazarlo.
  insert into public.lead_contacts (lead_id, contact_type, value, normalized_value, label, is_primary, is_valid, source, metadata)
  select p.lead_id, 'phone', p.phone_anterior, public.normalize_lead_contact('phone', p.phone_anterior),
    'telefono_anterior', false, true, v_base, jsonb_build_object('reemplazado_el', current_date)
  from _eq_plan p
  where p.cambia_fono and nullif(btrim(p.phone_anterior), '') is not null
    and public.normalize_lead_contact('phone', p.phone_anterior) <> ''
  on conflict (lead_id, contact_type, normalized_value) do nothing;

  update public.lead_contacts lc set is_primary = false, updated_at = now()
  from _eq_plan p
  where lc.lead_id = p.lead_id and p.cambia_fono and lc.contact_type = 'phone' and lc.is_primary;

  -- 4. Ficha, prioridad, teléfono principal y reapertura.
  update public.leads l set
    full_name = case
      when nullif(btrim(l.full_name), '') is null or l.full_name like 'Empresa RUT %' or l.full_name = 'Cliente Equifax'
      then coalesce(v.razon_social, l.full_name, 'Empresa RUT ' || v.rut)
      else l.full_name end,
    phone = case when p.cambia_fono then v.phone_primary else coalesce(nullif(btrim(l.phone), ''), v.phone_primary) end,
    email = coalesce(nullif(btrim(l.email), ''), v.email),
    workflow_status = case when p.reabre then 'pending' else l.workflow_status end,
    assignment_status = case when p.reabre then 'pending' else l.assignment_status end,
    dialer_cycle_started_at = case when p.reabre or p.cambia_fono then now() else l.dialer_cycle_started_at end,
    external_priority_rank = v.rank,
    external_priority_reason = v_reason,
    external_last_source_code = 'equifax_ia',
    external_last_seen_at = now(),
    extra = coalesce(l.extra, '{}'::jsonb)
      || jsonb_build_object('base_discado', coalesce(l.extra->'base_discado', '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
        'base', v_base,
        'actividad', v.actividad,
        'rubro', v.rubro,
        'subrubro', v.subrubro,
        'region', v.region,
        'comuna', v.comuna,
        'direccion', v.direccion,
        'trabajadores', v.trabajadores,
        'tramo_ventas', v.tramo_ventas,
        'tamano_empresa', v.tamano_empresa,
        'tendencia_ventas', v.tendencia_ventas,
        'equifax_prioridad', v.prioridad_comercial,
        'equifax_score_ia', v.score_ia_principal,
        'equifax_score_challenger', v.score_ia_independiente,
        'equifax_confianza_modelo', v.confianza_modelo,
        'equifax_contactabilidad', v.contactabilidad,
        'equifax_orden', v.orden_equifax,
        'equifax_grupo', v.hoja_equifax
      )))
      || case when l.extra ? 'contacto' or v.contacto_nombre is null then '{}'::jsonb
         else jsonb_build_object('contacto', jsonb_strip_nulls(jsonb_build_object(
           'nombre', v.contacto_nombre,
           'cargo', v.contacto_cargo,
           'email', v.contacto_email,
           'fuente', 'bigdata',
           'origen_dato', v.contacto_fuente,
           'cargado', current_date
         ))) end,
    updated_at = now()
  from _eq_plan p
  join _eq v on v.rut_norm = p.rut_norm
  where l.id = p.lead_id;
  get diagnostics v_count = row_count;
  v_report := v_report || jsonb_build_object('leads_actualizados', v_count);

  -- 5. Teléfonos y correo de la base.
  insert into public.lead_contacts (lead_id, contact_type, value, normalized_value, label, is_primary, is_valid, source, metadata)
  select distinct on (m.lead_id, public.normalize_lead_contact('phone', ph->>'value'))
    m.lead_id, 'phone', ph->>'value', public.normalize_lead_contact('phone', ph->>'value'), ph->>'source',
    (ph->>'value') = l.phone, true, v_base,
    jsonb_strip_nulls(jsonb_build_object('tipo', ph->>'tipo', 'estado', ph->>'estado', 'base', v_base))
  from _eq_match m
  join _eq v on v.rut_norm = m.rut_norm
  join public.leads l on l.id = m.lead_id
  cross join lateral jsonb_array_elements(v.phones) as ph
  where public.normalize_lead_contact('phone', ph->>'value') <> ''
  order by m.lead_id, public.normalize_lead_contact('phone', ph->>'value')
  on conflict (lead_id, contact_type, normalized_value) do update
    set is_primary = excluded.is_primary or public.lead_contacts.is_primary, updated_at = now();
  get diagnostics v_count = row_count;
  v_report := v_report || jsonb_build_object('telefonos_agregados', v_count);

  insert into public.lead_contacts (lead_id, contact_type, value, normalized_value, label, is_primary, is_valid, source, metadata)
  select m.lead_id, 'email', v.email, public.normalize_lead_contact('email', v.email), 'email_bigdata',
    false, true, v_base, jsonb_build_object('fuente', v.email_fuente)
  from _eq_match m
  join _eq v on v.rut_norm = m.rut_norm
  where nullif(btrim(v.email), '') is not null
  on conflict (lead_id, contact_type, normalized_value) do nothing;
  get diagnostics v_count = row_count;
  v_report := v_report || jsonb_build_object('emails_agregados', v_count);

  -- 6. El resto de la base del 24-09 queda detrás de la base nueva, sin perder su orden.
  if p_desplazar_anterior then
    update public.leads l set
      external_priority_rank = l.external_priority_rank + v_desplazamiento,
      updated_at = now()
    where l.campaign_id = v_campaign
      and l.external_priority_reason = v_reason_anterior
      and l.external_priority_rank < v_desplazamiento
      and not exists (select 1 from _eq_match m where m.lead_id = l.id);
    get diagnostics v_count = row_count;
    v_report := v_report || jsonb_build_object('base_anterior_desplazada', v_count);
  end if;

  -- 7. Cuántos de la base quedan de verdad en la cola (mismas reglas que claim_next_dial_targets).
  v_report := v_report || (
    select jsonb_build_object(
      'en_cola_de_discado', count(*) filter (where
        l.phone is not null and btrim(l.phone) <> '' and l.next_action_at is null
        and coalesce(l.assignment_status, 'pending') not in ('managed', 'exception')
        and coalesce(l.workflow_status, 'pending') not in ('managed', 'exception', 'callback')),
      'en_cola_pero_en_espera', count(*) filter (where
        l.phone is not null and l.next_action_at is null
        and coalesce(l.assignment_status, 'pending') not in ('managed', 'exception')
        and coalesce(l.workflow_status, 'pending') not in ('managed', 'exception', 'callback')
        and l.dialer_retry_at > now()),
      'fuera_por_gestion_cerrada', count(*) filter (where
        coalesce(l.assignment_status, 'pending') in ('managed', 'exception')
        or coalesce(l.workflow_status, 'pending') in ('managed', 'exception')),
      'con_agenda', count(*) filter (where l.next_action_at is not null)
    )
    from _eq_match m join public.leads l on l.id = m.lead_id
  );

  if p_ensayo then
    raise exception using errcode = 'MA002', message = v_report::text;
  end if;
  return v_report;
end;
$$;

create or replace function public.base_equifax_octubre_ensayo()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.base_equifax_octubre_aplicar(true, true);
  return null;
exception when sqlstate 'MA002' then
  return sqlerrm::jsonb;
end;
$$;

revoke all on function public.base_equifax_octubre_aplicar(boolean, boolean) from public, anon, authenticated;
revoke all on function public.base_equifax_octubre_ensayo() from public, anon, authenticated;
grant execute on function public.base_equifax_octubre_aplicar(boolean, boolean) to service_role;
grant execute on function public.base_equifax_octubre_ensayo() to service_role;
