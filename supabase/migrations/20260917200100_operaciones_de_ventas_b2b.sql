-- Operaciones del embudo B2B.
--
-- Las reglas viven acá, no en la pantalla: la empresa dueña se deduce de quien
-- opera, cada movimiento de etapa deja rastro y cerrar una oportunidad ajusta
-- estado y fecha sin que la interfaz tenga que acordarse.

create or replace function public.crear_oportunidad_b2b(
  p_company_name text,
  p_opportunity_name text,
  p_rut text default null,
  p_contact_name text default null,
  p_contact_email text default null,
  p_contact_phone text default null,
  p_product_code text default null,
  p_monthly_amount numeric default 0,
  p_one_time_amount numeric default 0,
  p_source text default null,
  p_expected_close_date date default null
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_org uuid := public.current_org_id();
  v_company uuid;
  v_contact uuid;
  v_stage uuid;
  v_product public.sales_products%rowtype;
  v_opportunity uuid;
  v_rut_normalizado text := nullif(public.normalize_lead_rut(p_rut), '');
begin
  if coalesce(public.current_role_name()::text, '') not in ('admin', 'supervisor') then
    raise exception 'Solo administración y supervisión crean oportunidades' using errcode = '42501';
  end if;
  if v_org is null then
    raise exception 'Tu cuenta no tiene empresa asignada' using errcode = '42501';
  end if;
  if btrim(coalesce(p_company_name, '')) = '' then
    raise exception 'Escribe el nombre de la empresa';
  end if;

  if v_rut_normalizado is not null then
    select id into v_company
    from public.sales_companies
    where organization_id = v_org and normalized_rut = v_rut_normalizado;
  end if;

  if v_company is null then
    select id into v_company
    from public.sales_companies
    where organization_id = v_org and lower(name) = lower(btrim(p_company_name))
    limit 1;
  end if;

  if v_company is null then
    insert into public.sales_companies (organization_id, name, rut, source, created_by, owner_id)
    values (v_org, btrim(p_company_name), nullif(btrim(coalesce(p_rut, '')), ''), p_source, (select auth.uid()), (select auth.uid()))
    returning id into v_company;
  end if;

  if btrim(coalesce(p_contact_name, '')) <> '' then
    insert into public.sales_contacts (organization_id, company_id, full_name, email, phone)
    values (v_org, v_company, btrim(p_contact_name), nullif(btrim(coalesce(p_contact_email, '')), ''), nullif(btrim(coalesce(p_contact_phone, '')), ''))
    returning id into v_contact;
  end if;

  select id into v_stage
  from public.sales_stages
  where organization_id = v_org and active and not is_won and not is_lost
  order by position
  limit 1;

  if v_stage is null then
    raise exception 'Tu empresa no tiene etapas configuradas';
  end if;

  if p_product_code is not null then
    select * into v_product
    from public.sales_products
    where organization_id = v_org and code = p_product_code and active;
  end if;

  insert into public.sales_opportunities (
    organization_id, company_id, contact_id, name, stage_id,
    monthly_amount, one_time_amount, source, expected_close_date, owner_id, created_by
  )
  values (
    v_org, v_company, v_contact, btrim(p_opportunity_name), v_stage,
    coalesce(nullif(p_monthly_amount, 0), v_product.monthly_price, 0),
    coalesce(nullif(p_one_time_amount, 0), v_product.one_time_price, 0),
    p_source, p_expected_close_date, (select auth.uid()), (select auth.uid())
  )
  returning id into v_opportunity;

  if v_product.id is not null then
    insert into public.sales_opportunity_items (organization_id, opportunity_id, product_id, description, monthly_price, one_time_price)
    values (v_org, v_opportunity, v_product.id, v_product.name, coalesce(v_product.monthly_price, 0), coalesce(v_product.one_time_price, 0));
  end if;

  insert into public.sales_activities (organization_id, opportunity_id, company_id, kind, subject, owner_id)
  values (v_org, v_opportunity, v_company, 'etapa', 'Oportunidad creada', (select auth.uid()));

  return v_opportunity;
end;
$$;

create or replace function public.mover_oportunidad_de_etapa(
  p_opportunity_id uuid,
  p_stage_key text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_oportunidad public.sales_opportunities%rowtype;
  v_etapa public.sales_stages%rowtype;
begin
  select * into v_oportunidad from public.sales_opportunities where id = p_opportunity_id;
  if v_oportunidad.id is null then
    raise exception 'La oportunidad no existe';
  end if;
  perform public.assert_org_access(v_oportunidad.organization_id);
  if coalesce(public.current_role_name()::text, '') not in ('admin', 'supervisor') then
    raise exception 'Solo administración y supervisión mueven el embudo' using errcode = '42501';
  end if;

  select * into v_etapa
  from public.sales_stages
  where organization_id = v_oportunidad.organization_id and key = p_stage_key and active;

  if v_etapa.id is null then
    raise exception 'Esa etapa no existe en tu embudo';
  end if;

  update public.sales_opportunities
     set stage_id = v_etapa.id,
         status = case when v_etapa.is_won then 'ganada' when v_etapa.is_lost then 'perdida' else 'abierta' end,
         closed_at = case when v_etapa.is_won or v_etapa.is_lost then now() else null end,
         lost_reason = case when v_etapa.is_lost then coalesce(p_note, lost_reason) else null end,
         updated_at = now()
   where id = p_opportunity_id;

  insert into public.sales_activities (organization_id, opportunity_id, company_id, kind, subject, body, owner_id)
  values (
    v_oportunidad.organization_id, p_opportunity_id, v_oportunidad.company_id, 'etapa',
    'Pasa a ' || v_etapa.name, p_note, (select auth.uid())
  );
end;
$$;

create or replace function public.registrar_actividad_b2b(
  p_opportunity_id uuid,
  p_kind text,
  p_subject text,
  p_body text default null,
  p_due_at timestamptz default null,
  p_next_action_note text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_oportunidad public.sales_opportunities%rowtype;
  v_actividad uuid;
begin
  select * into v_oportunidad from public.sales_opportunities where id = p_opportunity_id;
  if v_oportunidad.id is null then
    raise exception 'La oportunidad no existe';
  end if;
  perform public.assert_org_access(v_oportunidad.organization_id);
  if coalesce(public.current_role_name()::text, '') not in ('admin', 'supervisor') then
    raise exception 'Solo administración y supervisión registran gestiones' using errcode = '42501';
  end if;
  if p_kind not in ('llamada', 'correo', 'whatsapp', 'reunion', 'nota', 'tarea') then
    raise exception 'Tipo de gestión no válido';
  end if;

  insert into public.sales_activities (
    organization_id, opportunity_id, company_id, contact_id, kind, subject, body, due_at, done, owner_id
  )
  values (
    v_oportunidad.organization_id, p_opportunity_id, v_oportunidad.company_id, v_oportunidad.contact_id,
    p_kind, nullif(btrim(coalesce(p_subject, '')), ''), nullif(btrim(coalesce(p_body, '')), ''),
    p_due_at, p_due_at is null, (select auth.uid())
  )
  returning id into v_actividad;

  -- Una gestión con fecha futura es, además, la próxima acción del negocio.
  if p_due_at is not null then
    update public.sales_opportunities
       set next_action_at = p_due_at,
           next_action_note = coalesce(p_next_action_note, p_subject),
           updated_at = now()
     where id = p_opportunity_id;
  end if;

  return v_actividad;
end;
$$;

do $$
declare
  v_funcion text;
begin
  foreach v_funcion in array array[
    'public.crear_oportunidad_b2b(text, text, text, text, text, text, text, numeric, numeric, text, date)',
    'public.mover_oportunidad_de_etapa(uuid, text, text)',
    'public.registrar_actividad_b2b(uuid, text, text, text, timestamptz, text)'
  ] loop
    execute format('revoke all on function %s from public', v_funcion);
    execute format('revoke execute on function %s from anon', v_funcion);
    execute format('grant execute on function %s to authenticated, service_role', v_funcion);
  end loop;
end
$$;
