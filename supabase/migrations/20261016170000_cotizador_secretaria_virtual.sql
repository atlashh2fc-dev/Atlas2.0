-- Cotizador de Secretaria Virtual en la ficha.
--
-- La propuesta comercial de SV («Servicio de Ejecutiva Virtual», Plan Base
-- 2 UF + IVA) se armaba en un Word. Ahora la ejecutiva la simula y la envía
-- desde la ficha, igual que el cotizador Equifax, y queda en el registro con
-- su número de propuesta (N.º AAAAMM + correlativo del mes, como el Word).
--
--  * `campaigns.cotizador`: qué cotizador usa la campaña. Las hijas heredan el
--    de su madre, así que Secretaria Virtual lo tiene por voz, Inbound y
--    WhatsApp sin repetirlo.
--  * `cotizaciones_sv`: cada propuesta enviada. La crea registrar_cotizacion_sv;
--    el servidor cierra el estado del correo.
--  * ligar_respuesta_a_registro reconoce también la respuesta a una propuesta
--    SV y se la asigna a la ejecutiva que la envió.

alter table public.campaigns add column if not exists cotizador text;
alter table public.campaigns drop constraint if exists campaigns_cotizador_check;
alter table public.campaigns
  add constraint campaigns_cotizador_check check (cotizador is null or cotizador in ('secretaria_virtual'));

comment on column public.campaigns.cotizador is
  'Cotizador de la ficha para esta campaña (secretaria_virtual). Vacío: la hija usa el de su madre.';

update public.campaigns campana
   set cotizador = 'secretaria_virtual'
 where campana.cotizador is null
   and campana.parent_campaign_id is null
   and campana.name = 'Secretaria Virtual'
   and campana.organization_id in (select id from public.organizations where name = 'Geimser');

create or replace function public.campaign_cotizador(p_campaign_id uuid)
returns text
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select coalesce(campana.cotizador, madre.cotizador)
    from public.campaigns campana
    left join public.campaigns madre on madre.id = campana.parent_campaign_id
   where campana.id = p_campaign_id;
$$;

revoke all on function public.campaign_cotizador(uuid) from public, anon;
grant execute on function public.campaign_cotizador(uuid) to authenticated, service_role;

create table if not exists public.cotizaciones_sv (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  call_id uuid references public.calls(id) on delete set null,
  agent_id uuid not null references public.profiles(id),
  folio text not null,
  canal text not null check (canal in ('correo', 'whatsapp')),
  destinatario text not null,
  asunto text,
  plan text not null default 'base',
  uf_mensual numeric(10, 2) not null check (uf_mensual > 0),
  plazo_meses integer not null check (plazo_meses in (3, 6, 12)),
  valor_uf numeric(12, 2),
  condiciones jsonb not null default '{}'::jsonb,
  estado text not null check (estado in ('enviando', 'enviada', 'fallida', 'whatsapp_abierto')),
  proveedor_id text,
  error text,
  created_at timestamptz not null default now(),
  enviada_at timestamptz,
  respondida_at timestamptz,
  constraint cotizaciones_sv_folio_unico unique (organization_id, folio)
);

create index if not exists cotizaciones_sv_lead_idx on public.cotizaciones_sv (lead_id, created_at desc);
create index if not exists cotizaciones_sv_agent_idx on public.cotizaciones_sv (agent_id, created_at desc);

comment on table public.cotizaciones_sv is
  'Propuestas de Secretaria Virtual enviadas desde la ficha (correo por el buzón de la empresa o WhatsApp). Las crea registrar_cotizacion_sv.';

alter table public.cotizaciones_sv enable row level security;
revoke all on table public.cotizaciones_sv from anon;
revoke insert, update, delete on table public.cotizaciones_sv from authenticated;
grant select on table public.cotizaciones_sv to authenticated;

drop policy if exists cotizaciones_sv_organization_isolation on public.cotizaciones_sv;
create policy cotizaciones_sv_organization_isolation on public.cotizaciones_sv
  as restrictive for all to authenticated
  using (organization_id = any (public.current_org_ids()))
  with check (organization_id = any (public.current_org_ids()));

-- Mismo criterio que Equifax: supervisión y admin ven todas; la ejecutiva, las
-- suyas y las de los registros a su nombre.
drop policy if exists cotizaciones_sv_select on public.cotizaciones_sv;
create policy cotizaciones_sv_select on public.cotizaciones_sv
  for select to authenticated
  using (
    (select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
    or agent_id = (select auth.uid())
    or public.is_platform_owner()
    or exists (
      select 1 from public.leads lead
      where lead.id = cotizaciones_sv.lead_id
        and (select auth.uid()) in (lead.assigned_to, lead.managed_by)
    )
  );

create or replace function public.registrar_cotizacion_sv(
  p_lead_id uuid,
  p_call_id uuid,
  p_canal text,
  p_destinatario text,
  p_uf_mensual numeric,
  p_plazo_meses integer,
  p_valor_uf numeric,
  p_condiciones jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_role public.app_role;
  v_lead public.leads%rowtype;
  v_call public.calls%rowtype;
  v_prefijo text;
  v_correlativo integer;
  v_folio text;
  v_id uuid;
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null then
    raise exception 'No autenticado.';
  end if;
  select role into v_role from public.profiles where id = v_actor and active;
  if v_role is null then
    raise exception 'Tu usuario no está activo.';
  end if;
  if p_canal not in ('correo', 'whatsapp') then
    raise exception 'La propuesta sale por correo o por WhatsApp.';
  end if;
  if p_plazo_meses not in (3, 6, 12) then
    raise exception 'El plazo es de 3, 6 o 12 meses.';
  end if;
  if p_uf_mensual is null or p_uf_mensual <= 0 then
    raise exception 'Falta el valor mensual del plan.';
  end if;

  select * into v_lead from public.leads where id = p_lead_id;
  if not found then
    raise exception 'El registro no existe.';
  end if;
  perform public.assert_org_access(v_lead.organization_id);

  if public.campaign_cotizador(v_lead.campaign_id) is distinct from 'secretaria_virtual' then
    raise exception 'La campaña de este registro no es de Secretaria Virtual.';
  end if;

  if p_call_id is not null then
    select * into v_call from public.calls where id = p_call_id and lead_id = p_lead_id;
    if not found then
      raise exception 'La gestión no corresponde a este registro.';
    end if;
  end if;

  if v_role = 'agente' then
    if v_call.id is not null then
      if v_call.agent_id is distinct from v_actor or v_call.ended_at is not null then
        raise exception 'Esa gestión ya no está abierta a tu nombre.';
      end if;
    elsif v_actor is distinct from v_lead.assigned_to and v_actor is distinct from v_lead.managed_by then
      raise exception 'Este registro no está a tu nombre. Pide a tu supervisor que te lo asigne.';
    end if;
  end if;

  -- N.º de propuesta como en el Word: año y mes de Chile y el correlativo del
  -- mes en la empresa (20261001, 20261002…). El candado evita dos iguales.
  perform pg_advisory_xact_lock(hashtext('cotizaciones_sv:' || v_lead.organization_id::text));
  v_prefijo := to_char(v_now at time zone 'America/Santiago', 'YYYYMM');
  select coalesce(max(substring(folio from 7)::integer), 0) + 1 into v_correlativo
    from public.cotizaciones_sv
   where organization_id = v_lead.organization_id
     and folio like v_prefijo || '%';
  v_folio := v_prefijo || lpad(v_correlativo::text, 2, '0');

  insert into public.cotizaciones_sv (
    organization_id, lead_id, campaign_id, call_id, agent_id, folio, canal, destinatario,
    uf_mensual, plazo_meses, valor_uf, condiciones, estado, enviada_at
  )
  values (
    v_lead.organization_id, p_lead_id, v_lead.campaign_id, p_call_id, v_actor, v_folio, p_canal,
    left(btrim(p_destinatario), 320),
    p_uf_mensual, p_plazo_meses, p_valor_uf, coalesce(p_condiciones, '{}'::jsonb),
    case when p_canal = 'whatsapp' then 'whatsapp_abierto' else 'enviando' end,
    case when p_canal = 'whatsapp' then v_now end
  )
  returning id into v_id;

  insert into public.crm_audit_events (lead_id, crm_entity_id, actor_id, event_type, payload)
  values (
    p_lead_id, v_lead.crm_entity_id, v_actor, 'lead.sv_quote_sent',
    jsonb_build_object(
      'cotizacion_id', v_id,
      'folio', v_folio,
      'call_id', p_call_id,
      'canal', p_canal,
      'uf_mensual', p_uf_mensual,
      'plazo_meses', p_plazo_meses
    )
  );

  return jsonb_build_object('id', v_id, 'folio', v_folio);
end;
$function$;

revoke all on function public.registrar_cotizacion_sv(uuid, uuid, text, text, numeric, integer, numeric, jsonb) from public, anon;
grant execute on function public.registrar_cotizacion_sv(uuid, uuid, text, text, numeric, integer, numeric, jsonb) to authenticated;

-- La respuesta a una propuesta SV vuelve al buzón de la empresa: se liga por
-- In-Reply-To, por asunto o por la dirección a la que se envió, y queda
-- asignada a la ejecutiva que la mandó. Lo de Equifax no cambia.
create or replace function public.ligar_respuesta_a_registro(p_email uuid)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_email public.inbound_emails%rowtype;
  v_org uuid;
  v_campanas uuid[];
  v_ref text;
  v_asunto text;
  v_cotizacion public.equifax_cotizaciones%rowtype;
  v_sv public.cotizaciones_sv%rowtype;
  v_lead public.leads%rowtype;
  v_lead_id uuid;
  v_dueno uuid;
  v_motivo text;
begin
  select * into v_email from public.inbound_emails where id = p_email;
  if not found or v_email.lead_id is not null then
    return v_email.lead_id;
  end if;

  select mailbox.organization_id into v_org
    from public.inbound_mailboxes mailbox
    join public.organizations organizacion on organizacion.id = mailbox.organization_id
   where mailbox.id = v_email.mailbox_id
     and mailbox.campaign_id is null
     and organizacion.edicion = 'center';
  if v_org is null then return null; end if;

  select nullif(array_agg(campaign_id), '{}') into v_campanas from public.buzon_campanas where mailbox_id = v_email.mailbox_id;

  v_ref := nullif(lower(btrim(coalesce(v_email.in_reply_to, ''), '<> ')), '');
  if v_ref is not null then
    select * into v_cotizacion from public.equifax_cotizaciones cotizacion
     where cotizacion.organization_id = v_org and cotizacion.canal = 'correo'
       and lower(btrim(coalesce(cotizacion.proveedor_id, ''), '<> ')) = v_ref
     limit 1;
    if v_cotizacion.id is not null then
      v_lead_id := v_cotizacion.lead_id;
    else
      select * into v_sv from public.cotizaciones_sv cotizacion
       where cotizacion.organization_id = v_org and cotizacion.canal = 'correo'
         and lower(btrim(coalesce(cotizacion.proveedor_id, ''), '<> ')) = v_ref
       limit 1;
      v_lead_id := v_sv.lead_id;
    end if;
    if v_lead_id is null then
      select correo.lead_id into v_lead_id from public.correos_de_registro correo
       where correo.organization_id = v_org
         and lower(btrim(coalesce(correo.message_id, ''), '<> ')) = v_ref
       limit 1;
    end if;
  end if;

  if v_lead_id is null then
    v_asunto := nullif(btrim(regexp_replace(coalesce(v_email.subject, ''),
      '^\s*((re|rv|fw|fwd|aw)\s*:\s*|acepto la propuesta\s*[—–-]\s*)+', '', 'i')), '');
    if v_asunto is not null then
      select * into v_cotizacion from public.equifax_cotizaciones cotizacion
       where cotizacion.organization_id = v_org and cotizacion.canal = 'correo'
         and cotizacion.asunto = v_asunto
         and cotizacion.created_at >= now() - interval '180 days'
         and (v_campanas is null or cotizacion.campaign_id = any (v_campanas))
       order by cotizacion.created_at desc
       limit 1;
      v_lead_id := v_cotizacion.lead_id;
      if v_lead_id is null then
        select * into v_sv from public.cotizaciones_sv cotizacion
         where cotizacion.organization_id = v_org and cotizacion.canal = 'correo'
           and cotizacion.asunto = v_asunto
           and cotizacion.created_at >= now() - interval '180 days'
           and (v_campanas is null or cotizacion.campaign_id = any (v_campanas))
         order by cotizacion.created_at desc
         limit 1;
        v_lead_id := v_sv.lead_id;
      end if;
    end if;
  end if;

  if v_lead_id is null then
    select * into v_cotizacion from public.equifax_cotizaciones cotizacion
     where cotizacion.organization_id = v_org and cotizacion.canal = 'correo'
       and lower(btrim(cotizacion.destinatario)) = v_email.from_address
       and cotizacion.created_at >= now() - interval '180 days'
       and (v_campanas is null or cotizacion.campaign_id = any (v_campanas))
     order by cotizacion.created_at desc
     limit 1;
    v_lead_id := v_cotizacion.lead_id;
  end if;

  if v_lead_id is null then
    select * into v_sv from public.cotizaciones_sv cotizacion
     where cotizacion.organization_id = v_org and cotizacion.canal = 'correo'
       and lower(btrim(cotizacion.destinatario)) = v_email.from_address
       and cotizacion.created_at >= now() - interval '180 days'
       and (v_campanas is null or cotizacion.campaign_id = any (v_campanas))
     order by cotizacion.created_at desc
     limit 1;
    v_lead_id := v_sv.lead_id;
  end if;

  if v_lead_id is null then
    select lead.id into v_lead_id from public.leads lead
     where lead.organization_id = v_org
       and lower(btrim(coalesce(lead.email, ''))) = v_email.from_address
       and (v_campanas is null or lead.campaign_id = any (v_campanas))
     order by lead.updated_at desc
     limit 1;
  end if;

  if v_lead_id is null then return null; end if;
  select * into v_lead from public.leads where id = v_lead_id;

  if v_cotizacion.id is null and v_sv.id is null then
    select * into v_cotizacion from public.equifax_cotizaciones cotizacion
     where cotizacion.lead_id = v_lead_id and cotizacion.canal = 'correo'
     order by cotizacion.created_at desc
     limit 1;
    if v_cotizacion.id is null then
      select * into v_sv from public.cotizaciones_sv cotizacion
       where cotizacion.lead_id = v_lead_id and cotizacion.canal = 'correo'
       order by cotizacion.created_at desc
       limit 1;
    end if;
  end if;

  if v_lead.next_action_at is not null and v_lead.callback_mode = 'personal' then
    select profile.id into v_dueno from public.profiles profile
     where profile.id = coalesce(v_lead.managed_by, v_lead.assigned_to) and profile.active and profile.role = 'agente';
    if v_dueno is not null then v_motivo := 'agenda'; end if;
  end if;
  if v_dueno is null and coalesce(v_cotizacion.agent_id, v_sv.agent_id) is not null then
    select profile.id into v_dueno from public.profiles profile
     where profile.id = coalesce(v_cotizacion.agent_id, v_sv.agent_id) and profile.active and profile.role = 'agente';
    if v_dueno is not null then v_motivo := 'cotizacion'; end if;
  end if;
  if v_dueno is null and v_lead.assigned_to is not null then
    select profile.id into v_dueno from public.profiles profile
     where profile.id = v_lead.assigned_to and profile.active and profile.role = 'agente';
    if v_dueno is not null then v_motivo := 'propietario'; end if;
  end if;

  update public.inbound_emails
     set lead_id = v_lead_id,
         organization_id = v_org,
         cotizacion_id = v_cotizacion.id,
         assigned_to = v_dueno,
         asignacion = v_motivo,
         asignado_at = case when v_dueno is not null then now() end,
         updated_at = now()
   where id = p_email;

  if v_cotizacion.id is not null then
    update public.equifax_cotizaciones
       set respondida_at = coalesce(respondida_at, v_email.received_at)
     where id = v_cotizacion.id;
  elsif v_sv.id is not null then
    update public.cotizaciones_sv
       set respondida_at = coalesce(respondida_at, v_email.received_at)
     where id = v_sv.id;
  end if;

  return v_lead_id;
end;
$function$;
