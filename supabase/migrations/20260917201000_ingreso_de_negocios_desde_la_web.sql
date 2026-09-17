-- La web de Altius entra al embudo.
--
-- Cuando alguien agenda una reunión, pide un plan de Atlas Pulso o escribe por
-- el formulario, ese contacto tiene que existir en el CRM con su próxima acción,
-- no solo en un correo. Esta función es la puerta: la usa el servicio, nunca un
-- visitante, y siempre escribe en la empresa que se le indique por slug.
--
-- Es idempotente por `p_external_id`: si la web reintenta el envío, no duplica.

create or replace function public.ingresar_negocio_desde_web(
  p_organization_slug text,
  p_external_id text,
  p_kind text,
  p_company_name text,
  p_contact_name text default null,
  p_contact_email text default null,
  p_contact_phone text default null,
  p_message text default null,
  p_product_code text default null,
  p_monthly_amount numeric default null,
  p_meeting_at timestamptz default null,
  p_website text default null,
  p_source text default 'web'
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_org uuid := public.organization_id_by_slug(p_organization_slug);
  v_company uuid;
  v_contact uuid;
  v_stage uuid;
  v_product public.sales_products%rowtype;
  v_opportunity uuid;
  v_existing uuid;
  v_nombre text := nullif(btrim(coalesce(p_company_name, '')), '');
  v_email text := lower(nullif(btrim(coalesce(p_contact_email, '')), ''));
begin
  if v_org is null then
    raise exception 'La empresa % no existe', p_organization_slug;
  end if;
  if p_kind not in ('reunion', 'plan', 'diagnostico', 'contacto') then
    raise exception 'Tipo de ingreso no válido: %', p_kind;
  end if;

  -- Reintento del mismo envío: se responde el negocio ya creado.
  select opportunity_id into v_existing
  from public.sales_activities
  where organization_id = v_org
    and metadata->>'external_id' = p_external_id
  limit 1;

  if v_existing is not null then
    return jsonb_build_object('opportunity_id', v_existing, 'duplicado', true);
  end if;

  if v_nombre is null then
    v_nombre := coalesce(nullif(btrim(coalesce(p_contact_name, '')), ''), split_part(coalesce(v_email, 'sin nombre'), '@', 1));
  end if;

  -- Una empresa que ya escribió antes no se duplica: se busca por correo y nombre.
  select company_id into v_company
  from public.sales_contacts
  where organization_id = v_org and v_email is not null and lower(email) = v_email
  limit 1;

  if v_company is null then
    select id into v_company
    from public.sales_companies
    where organization_id = v_org and lower(name) = lower(v_nombre)
    limit 1;
  end if;

  if v_company is null then
    insert into public.sales_companies (organization_id, name, website, source, email, phone)
    values (v_org, v_nombre, nullif(btrim(coalesce(p_website, '')), ''), p_source, v_email, nullif(btrim(coalesce(p_contact_phone, '')), ''))
    returning id into v_company;
  end if;

  if nullif(btrim(coalesce(p_contact_name, '')), '') is not null or v_email is not null then
    select id into v_contact
    from public.sales_contacts
    where organization_id = v_org and company_id = v_company
      and (v_email is not null and lower(email) = v_email)
    limit 1;

    if v_contact is null then
      insert into public.sales_contacts (organization_id, company_id, full_name, email, phone)
      values (
        v_org, v_company,
        coalesce(nullif(btrim(coalesce(p_contact_name, '')), ''), v_email, 'Contacto web'),
        v_email, nullif(btrim(coalesce(p_contact_phone, '')), '')
      )
      returning id into v_contact;
    end if;
  end if;

  if p_product_code is not null then
    select * into v_product
    from public.sales_products
    where organization_id = v_org and code = p_product_code and active;
  end if;

  -- Quien agenda entra directo a "Reunión agendada"; el resto, al inicio.
  select id into v_stage
  from public.sales_stages
  where organization_id = v_org and active
    and key = case when p_kind = 'reunion' then 'reunion' else 'contactado' end
  limit 1;

  if v_stage is null then
    select id into v_stage
    from public.sales_stages
    where organization_id = v_org and active and not is_won and not is_lost
    order by position limit 1;
  end if;

  -- Un negocio abierto de la misma empresa se reutiliza en vez de duplicarse.
  select id into v_opportunity
  from public.sales_opportunities
  where organization_id = v_org and company_id = v_company and status = 'abierta'
  order by created_at desc
  limit 1;

  if v_opportunity is null then
    insert into public.sales_opportunities (
      organization_id, company_id, contact_id, name, stage_id,
      monthly_amount, source, next_action_at, next_action_note
    )
    values (
      v_org, v_company, v_contact,
      case
        when p_kind = 'plan' then coalesce(v_product.name, 'Atlas Pulso')
        when p_kind = 'reunion' then 'Reunión desde la web'
        when p_kind = 'diagnostico' then 'Diagnóstico web gratis'
        else 'Contacto desde la web'
      end,
      v_stage,
      coalesce(p_monthly_amount, v_product.monthly_price, 0),
      p_source,
      p_meeting_at,
      case when p_meeting_at is not null then 'Reunión agendada desde la web' else 'Responder el contacto' end
    )
    returning id into v_opportunity;
  else
    update public.sales_opportunities
       set contact_id = coalesce(contact_id, v_contact),
           stage_id = case when p_kind = 'reunion' then v_stage else stage_id end,
           monthly_amount = case when monthly_amount = 0 then coalesce(p_monthly_amount, v_product.monthly_price, 0) else monthly_amount end,
           next_action_at = coalesce(p_meeting_at, next_action_at),
           next_action_note = case when p_meeting_at is not null then 'Reunión agendada desde la web' else next_action_note end,
           updated_at = now()
     where id = v_opportunity;
  end if;

  if v_product.id is not null and not exists (
    select 1 from public.sales_opportunity_items
    where opportunity_id = v_opportunity and product_id = v_product.id
  ) then
    insert into public.sales_opportunity_items (organization_id, opportunity_id, product_id, description, monthly_price)
    values (v_org, v_opportunity, v_product.id, v_product.name, coalesce(v_product.monthly_price, 0));
  end if;

  insert into public.sales_activities (
    organization_id, opportunity_id, company_id, contact_id, kind, subject, body, occurred_at, due_at, done, metadata
  )
  values (
    v_org, v_opportunity, v_company, v_contact,
    case when p_kind = 'reunion' then 'reunion' else 'nota' end,
    case
      when p_kind = 'reunion' then 'Agendó una reunión en la web'
      when p_kind = 'plan' then 'Pidió ' || coalesce(v_product.name, 'un plan') || ' en la web'
      when p_kind = 'diagnostico' then 'Pidió el diagnóstico gratis'
      else 'Escribió por el formulario'
    end,
    nullif(btrim(coalesce(p_message, '')), ''),
    now(), p_meeting_at, p_meeting_at is null,
    jsonb_build_object('external_id', p_external_id, 'origen', p_source, 'tipo', p_kind)
  );

  return jsonb_build_object('opportunity_id', v_opportunity, 'duplicado', false);
end;
$$;

revoke all on function public.ingresar_negocio_desde_web(text, text, text, text, text, text, text, text, text, numeric, timestamptz, text, text) from public;
revoke execute on function public.ingresar_negocio_desde_web(text, text, text, text, text, text, text, text, text, numeric, timestamptz, text, text) from anon, authenticated;
grant execute on function public.ingresar_negocio_desde_web(text, text, text, text, text, text, text, text, text, numeric, timestamptz, text, text) to service_role;

create index if not exists sales_activities_external_id_idx
  on public.sales_activities ((metadata->>'external_id'))
  where metadata ? 'external_id';
