-- Un solo buzón para la cuenta Equifax.
--
-- Las propuestas salen del buzón de la empresa con el nombre del ejecutivo
-- («Ana Pérez · Equifax» <buzón>) y las respuestas vuelven a ese mismo buzón.
-- Hasta ahora el contact center las leía pero no las ligaba a nada: quedaban
-- en inbound_emails sin registro ni dueño. Acá cada respuesta se liga al
-- registro (por el hilo del correo, o por la dirección) y se asigna:
--
--   1. registro agendado  → el dueño de la agenda (managed_by ?? assigned_to),
--   2. si no              → quien envió la propuesta que se está respondiendo,
--   3. si no              → el ejecutivo asignado al registro,
--   4. si no hay nadie    → queda sin dueño, para supervisión.
--
-- Lo que el ejecutivo contesta desde la ficha sale por el mismo buzón y queda
-- en correos_de_registro, así el hilo sigue entero dentro de Atlas.

-- ---------------------------------------------------------------------------
-- Respuestas: registro, dueño y propuesta que responden.
-- ---------------------------------------------------------------------------
alter table public.inbound_emails
  add column if not exists assigned_to uuid references public.profiles(id) on delete set null,
  add column if not exists asignacion text,
  add column if not exists asignado_at timestamptz,
  add column if not exists cotizacion_id uuid references public.equifax_cotizaciones(id) on delete set null;

alter table public.inbound_emails drop constraint if exists inbound_emails_asignacion_check;
alter table public.inbound_emails add constraint inbound_emails_asignacion_check
  check (asignacion is null or asignacion in ('agenda', 'cotizacion', 'propietario'));

comment on column public.inbound_emails.assigned_to is 'Ejecutivo que debe atender la respuesta (dueño de la agenda, autor de la propuesta o asignado del registro).';
comment on column public.inbound_emails.asignacion is 'Por qué quedó con ese dueño: agenda, cotizacion o propietario.';

create index if not exists inbound_emails_assigned_idx
  on public.inbound_emails (assigned_to, status, received_at desc) where assigned_to is not null;
create index if not exists inbound_emails_lead_idx
  on public.inbound_emails (lead_id, received_at desc) where lead_id is not null;

alter table public.equifax_cotizaciones add column if not exists respondida_at timestamptz;

-- El ejecutivo ve las respuestas que le tocan y las de sus registros.
drop policy if exists inbound_emails_asignado_select on public.inbound_emails;
create policy inbound_emails_asignado_select on public.inbound_emails
  for select to authenticated
  using (
    assigned_to = (select auth.uid())
    or exists (
      select 1 from public.leads lead
      where lead.id = inbound_emails.lead_id
        and (select auth.uid()) in (lead.assigned_to, lead.managed_by)
    )
  );

-- ---------------------------------------------------------------------------
-- Lo que se contesta desde la ficha.
-- ---------------------------------------------------------------------------
create table if not exists public.correos_de_registro (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  respuesta_a uuid references public.inbound_emails(id) on delete set null,
  agent_id uuid not null references public.profiles(id),
  remitente text not null,
  destinatario text not null check (length(btrim(destinatario)) between 3 and 320),
  asunto text not null check (length(asunto) between 1 and 500),
  cuerpo text not null check (length(cuerpo) between 1 and 20000),
  message_id text,
  in_reply_to text,
  estado text not null default 'enviando' check (estado in ('enviando', 'enviado', 'fallido')),
  error text,
  created_at timestamptz not null default now(),
  enviado_at timestamptz
);

create index if not exists correos_de_registro_lead_idx on public.correos_de_registro (lead_id, created_at desc);
create index if not exists correos_de_registro_message_idx on public.correos_de_registro (organization_id, message_id) where message_id is not null;

comment on table public.correos_de_registro is
  'Correos que el ejecutivo contesta desde la ficha por el buzón de la empresa. Los escribe el servidor.';

alter table public.correos_de_registro enable row level security;
revoke all on table public.correos_de_registro from anon;
revoke insert, update, delete on table public.correos_de_registro from authenticated;
grant select on table public.correos_de_registro to authenticated;
grant all on table public.correos_de_registro to service_role;

drop policy if exists correos_de_registro_organization_isolation on public.correos_de_registro;
create policy correos_de_registro_organization_isolation on public.correos_de_registro
  as restrictive for all to authenticated
  using (organization_id = any (public.current_org_ids()))
  with check (organization_id = any (public.current_org_ids()));

drop policy if exists correos_de_registro_select on public.correos_de_registro;
create policy correos_de_registro_select on public.correos_de_registro
  for select to authenticated
  using (
    (select public.current_role_name()) = any (array['admin'::public.app_role, 'supervisor'::public.app_role])
    or agent_id = (select auth.uid())
    or public.is_platform_owner()
    or exists (
      select 1 from public.leads lead
      where lead.id = correos_de_registro.lead_id
        and (select auth.uid()) in (lead.assigned_to, lead.managed_by)
    )
  );

-- ---------------------------------------------------------------------------
-- Ligar una respuesta del buzón de la empresa a su registro y asignarla.
-- ---------------------------------------------------------------------------
create or replace function public.ligar_respuesta_a_registro(p_email uuid)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_email public.inbound_emails%rowtype;
  v_org uuid;
  v_ref text;
  v_cotizacion public.equifax_cotizaciones%rowtype;
  v_lead public.leads%rowtype;
  v_lead_id uuid;
  v_dueno uuid;
  v_motivo text;
begin
  select * into v_email from public.inbound_emails where id = p_email;
  if not found or v_email.lead_id is not null then
    return v_email.lead_id;
  end if;

  -- Solo el buzón de empresa del contact center; las clínicas tienen su propia liga.
  select mailbox.organization_id into v_org
    from public.inbound_mailboxes mailbox
    join public.organizations organizacion on organizacion.id = mailbox.organization_id
   where mailbox.id = v_email.mailbox_id
     and mailbox.campaign_id is null
     and organizacion.edicion = 'center';
  if v_org is null then return null; end if;

  -- 1. Por el hilo: el In-Reply-To es el Message-ID de la propuesta o de una
  --    respuesta que se mandó desde la ficha.
  v_ref := nullif(lower(btrim(coalesce(v_email.in_reply_to, ''), '<> ')), '');
  if v_ref is not null then
    select * into v_cotizacion from public.equifax_cotizaciones cotizacion
     where cotizacion.organization_id = v_org and cotizacion.canal = 'correo'
       and lower(btrim(coalesce(cotizacion.proveedor_id, ''), '<> ')) = v_ref
     limit 1;
    if v_cotizacion.id is not null then
      v_lead_id := v_cotizacion.lead_id;
    else
      select correo.lead_id into v_lead_id from public.correos_de_registro correo
       where correo.organization_id = v_org
         and lower(btrim(coalesce(correo.message_id, ''), '<> ')) = v_ref
       limit 1;
    end if;
  end if;

  -- 2. Por la dirección: la última propuesta enviada a ese correo.
  if v_lead_id is null then
    select * into v_cotizacion from public.equifax_cotizaciones cotizacion
     where cotizacion.organization_id = v_org and cotizacion.canal = 'correo'
       and lower(btrim(cotizacion.destinatario)) = v_email.from_address
       and cotizacion.created_at >= now() - interval '180 days'
     order by cotizacion.created_at desc
     limit 1;
    v_lead_id := v_cotizacion.lead_id;
  end if;

  -- 3. Un registro de la empresa con ese correo.
  if v_lead_id is null then
    select lead.id into v_lead_id from public.leads lead
     where lead.organization_id = v_org
       and lower(btrim(coalesce(lead.email, ''))) = v_email.from_address
     order by lead.updated_at desc
     limit 1;
  end if;

  if v_lead_id is null then return null; end if;
  select * into v_lead from public.leads where id = v_lead_id;

  -- Si llegó por la dirección o por una respuesta de la ficha, la propuesta de
  -- referencia es la última enviada al registro.
  if v_cotizacion.id is null then
    select * into v_cotizacion from public.equifax_cotizaciones cotizacion
     where cotizacion.lead_id = v_lead_id and cotizacion.canal = 'correo'
     order by cotizacion.created_at desc
     limit 1;
  end if;

  -- El dueño: agenda, propuesta, asignado. Solo ejecutivos activos.
  if v_lead.next_action_at is not null and v_lead.callback_mode = 'personal' then
    select profile.id into v_dueno from public.profiles profile
     where profile.id = coalesce(v_lead.managed_by, v_lead.assigned_to) and profile.active and profile.role = 'agente';
    if v_dueno is not null then v_motivo := 'agenda'; end if;
  end if;
  if v_dueno is null and v_cotizacion.id is not null then
    select profile.id into v_dueno from public.profiles profile
     where profile.id = v_cotizacion.agent_id and profile.active and profile.role = 'agente';
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
  end if;

  return v_lead_id;
end;
$$;

revoke all on function public.ligar_respuesta_a_registro(uuid) from public, anon, authenticated;
grant execute on function public.ligar_respuesta_a_registro(uuid) to service_role;
