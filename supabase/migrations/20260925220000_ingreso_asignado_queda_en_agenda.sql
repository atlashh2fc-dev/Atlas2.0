-- Un lead ingresado fuera de base y asignado a un ejecutivo queda en su agenda.
--
-- Antes se asignaba con assign_lead(..., p_set_managed_by := false, sin
-- fecha): quedaba assigned_to = ejecutivo, pero Mi agenda filtra por
-- managed_by y next_action_at, así que el ejecutivo no lo veía nunca. Ahora
-- queda como agenda personal (callback personal por teléfono) a la hora que
-- elige el supervisor, o de inmediato.

drop function if exists public.ingresar_lead_fuera_de_base(uuid, text, text, text, text, text, uuid, uuid, text, jsonb);

create or replace function public.ingresar_lead_fuera_de_base(
  p_campaign_id uuid,
  p_full_name text,
  p_rut text,
  p_phone text default null,
  p_phone_alt text default null,
  p_email text default null,
  p_team_id uuid default null,
  p_assigned_to uuid default null,
  p_notes text default null,
  p_detalle jsonb default '{}'::jsonb,
  p_agenda_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_result jsonb;
  v_lead public.leads%rowtype;
  v_detalle jsonb;
  v_alt_digits text := public.agent_dial_digits(nullif(btrim(coalesce(p_phone_alt, '')), ''));
  -- Una hora pasada no la marcaría nadie (la ventana es de minutos): se agenda ya.
  v_agenda_at timestamptz := greatest(coalesce(p_agenda_at, now()), now());
begin
  if p_campaign_id is null then
    raise exception 'Elige la campaña a la que entra el registro.';
  end if;
  if nullif(btrim(coalesce(p_rut, '')), '') is null then
    raise exception 'Indica el RUT del registro.';
  end if;
  if nullif(btrim(coalesce(p_phone_alt, '')), '') is not null and v_alt_digits is null then
    raise exception 'El teléfono adicional no es un número chileno válido.';
  end if;

  v_result := public.create_manual_lead_record(
    p_full_name, p_rut, p_phone, p_email, p_team_id, p_campaign_id, p_assigned_to, p_notes
  );
  select * into v_lead from public.leads where id = (v_result ->> 'lead_id')::uuid;

  -- Solo claves conocidas y con texto: el formulario no escribe lo que quiera en extra.
  select coalesce(jsonb_object_agg(item.key, btrim(item.value #>> '{}')), '{}'::jsonb)
  into v_detalle
  from jsonb_each(coalesce(p_detalle, '{}'::jsonb)) item
  where item.key in ('nombre_contacto', 'comuna', 'region', 'direccion', 'rubro', 'producto', 'completado_con')
    and jsonb_typeof(item.value) = 'string'
    and btrim(item.value #>> '{}') <> '';

  -- Un registro que ya estaba en la base conserva lo que trajo la carga.
  if not coalesce((v_result ->> 'duplicate')::boolean, false) and v_detalle <> '{}'::jsonb then
    update public.leads
    set extra = coalesce(extra, '{}'::jsonb) || jsonb_build_object('ingreso_manual', v_detalle)
    where id = v_lead.id;
  end if;

  if v_alt_digits is not null
     and public.agent_dial_digits(v_lead.phone) is distinct from v_alt_digits
     and not exists (
       select 1 from public.lead_contacts contact
       where contact.lead_id = v_lead.id
         and contact.contact_type = 'phone'
         and contact.is_valid is distinct from false
         and public.agent_dial_digits(contact.value) = v_alt_digits
     ) then
    perform public.add_lead_phone(v_lead.id, p_phone_alt, 'Teléfono adicional');
  end if;

  -- Asignado a un ejecutivo = agenda personal suya, igual que un "volver a
  -- llamar" que agenda él: aparece en Mi agenda, el discador se la marca a la
  -- hora si está Disponible, y el pool predictivo no se la entrega a otro.
  if p_assigned_to is not null then
    update public.leads
    set managed_by = p_assigned_to,
        next_action_at = v_agenda_at,
        next_action_channel = 'phone',
        workflow_status = 'callback',
        callback_mode = 'personal',
        callback_attempts = 0,
        callback_last_attempt_at = null,
        updated_at = now()
    where id = v_lead.id;

    insert into public.crm_audit_events (lead_id, crm_entity_id, actor_id, event_type, payload)
    values (
      v_lead.id, v_lead.crm_entity_id, (select auth.uid()), 'lead.agenda_created',
      jsonb_build_object(
        'source', 'dashboard.leads.new',
        'managed_by', p_assigned_to,
        'next_action_at', v_agenda_at,
        'callback_mode', 'personal'
      )
    );
  end if;

  return v_result || jsonb_strip_nulls(jsonb_build_object(
    'agenda_at', case when p_assigned_to is not null then v_agenda_at end
  ));
end;
$$;

revoke all on function public.ingresar_lead_fuera_de_base(uuid, text, text, text, text, text, uuid, uuid, text, jsonb, timestamptz) from public, anon;
grant execute on function public.ingresar_lead_fuera_de_base(uuid, text, text, text, text, text, uuid, uuid, text, jsonb, timestamptz) to authenticated;
