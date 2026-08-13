-- Bandeja IMAP de solo lectura para Abogado Legal. Las credenciales nunca se
-- almacenan en Postgres: viven únicamente como secretos del runtime.

create table if not exists public.inbound_mailboxes (
  id uuid primary key default gen_random_uuid(),
  address text not null unique,
  label text not null,
  campaign_id uuid not null references public.campaigns(id) on delete restrict,
  last_uid bigint not null default 0,
  last_synced_at timestamptz,
  last_sync_error text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inbound_emails (
  id uuid primary key default gen_random_uuid(),
  mailbox_id uuid not null references public.inbound_mailboxes(id) on delete cascade,
  imap_uid bigint not null,
  message_id text,
  from_name text,
  from_address text not null,
  reply_to_address text,
  subject text not null default '(Sin asunto)',
  body_text text not null default '',
  preview text not null default '',
  detected_phone text,
  received_at timestamptz not null,
  status text not null default 'new' check (status in ('new', 'converted')),
  lead_id uuid references public.leads(id) on delete set null,
  converted_by uuid references public.profiles(id) on delete set null,
  converted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mailbox_id, imap_uid)
);

create unique index if not exists inbound_emails_message_id_uidx
  on public.inbound_emails (mailbox_id, message_id)
  where message_id is not null;

create index if not exists inbound_emails_received_idx
  on public.inbound_emails (mailbox_id, received_at desc);

create index if not exists inbound_emails_status_idx
  on public.inbound_emails (mailbox_id, status, received_at desc);

drop trigger if exists inbound_mailboxes_set_updated_at on public.inbound_mailboxes;
create trigger inbound_mailboxes_set_updated_at
before update on public.inbound_mailboxes
for each row execute function public.set_updated_at();

drop trigger if exists inbound_emails_set_updated_at on public.inbound_emails;
create trigger inbound_emails_set_updated_at
before update on public.inbound_emails
for each row execute function public.set_updated_at();

alter table public.inbound_mailboxes enable row level security;
alter table public.inbound_emails enable row level security;

drop policy if exists inbound_mailboxes_ops_select on public.inbound_mailboxes;
create policy inbound_mailboxes_ops_select
on public.inbound_mailboxes
for select
to authenticated
using ((select public.current_role_name()) in ('admin', 'supervisor'));

drop policy if exists inbound_emails_ops_select on public.inbound_emails;
create policy inbound_emails_ops_select
on public.inbound_emails
for select
to authenticated
using (
  (select public.current_role_name()) in ('admin', 'supervisor')
  and exists (
    select 1 from public.inbound_mailboxes mailbox
    where mailbox.id = mailbox_id and mailbox.active
  )
);

revoke all on public.inbound_mailboxes, public.inbound_emails from anon;
revoke insert, update, delete on public.inbound_mailboxes, public.inbound_emails from authenticated;
grant select on public.inbound_mailboxes, public.inbound_emails to authenticated;
grant all on public.inbound_mailboxes, public.inbound_emails to service_role;

-- El nombre operativo antiguo se normaliza al nombre que ve el negocio. El ID,
-- workflow y todas las relaciones se conservan, por lo que no se mezclan KPIs.
update public.campaigns
set name = 'Abogado Legal', updated_at = now()
where lower(name) = 'agendamiento abogados'
  and not exists (
    select 1 from public.campaigns existing
    where lower(existing.name) = 'abogado legal'
  );

insert into public.inbound_mailboxes (address, label, campaign_id)
select 'contacto@abogadolegal.cl', 'Abogado Legal', campaign.id
from public.campaigns campaign
where lower(campaign.name) = 'abogado legal'
on conflict (address) do update
set label = excluded.label,
    campaign_id = excluded.campaign_id,
    active = true,
    updated_at = now();

create or replace function public.convert_inbound_email_to_lead(
  p_email_id uuid,
  p_agent_id uuid,
  p_phone text default null,
  p_full_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_role text := coalesce((select public.current_role_name())::text, '');
  v_email public.inbound_emails%rowtype;
  v_mailbox public.inbound_mailboxes%rowtype;
  v_agent public.profiles%rowtype;
  v_lead_id uuid;
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
  v_name text;
begin
  if v_actor_id is null or v_role not in ('admin', 'supervisor') then
    raise exception 'No tienes permisos para convertir correos en registros.';
  end if;

  select * into v_email
  from public.inbound_emails
  where id = p_email_id
  for update;

  if not found then
    raise exception 'El correo no existe.';
  end if;

  if v_email.status = 'converted' and v_email.lead_id is not null then
    return jsonb_build_object('lead_id', v_email.lead_id, 'reused', true);
  end if;

  select * into v_mailbox from public.inbound_mailboxes where id = v_email.mailbox_id;
  select * into v_agent
  from public.profiles
  where id = p_agent_id and role = 'agente' and active;

  if not found then
    raise exception 'El ejecutivo seleccionado no existe o no está activo.';
  end if;

  if not exists (
    select 1 from public.campaign_agents membership
    where membership.campaign_id = v_mailbox.campaign_id
      and membership.profile_id = p_agent_id
  ) then
    raise exception 'El ejecutivo no pertenece a la campaña Abogado Legal.';
  end if;

  if v_role = 'supervisor'
    and not (v_agent.team_id = any((select public.supervised_team_ids()))) then
    raise exception 'El ejecutivo no pertenece a uno de tus equipos.';
  end if;

  v_name := coalesce(
    nullif(btrim(p_full_name), ''),
    nullif(btrim(v_email.from_name), ''),
    nullif(split_part(v_email.from_address, '@', 1), ''),
    'Contacto desde correo'
  );

  select lead.id into v_lead_id
  from public.leads lead
  where lead.campaign_id = v_mailbox.campaign_id
    and lower(btrim(coalesce(lead.email, ''))) = lower(btrim(v_email.from_address))
  order by lead.updated_at desc
  limit 1;

  if v_lead_id is null then
    insert into public.leads (
      full_name, phone, email, status, team_id, campaign_id, created_by,
      assignment_status, workflow_status, extra
    )
    values (
      v_name, v_phone, lower(btrim(v_email.from_address)), 'nuevo', v_agent.team_id,
      v_mailbox.campaign_id, v_actor_id, 'unassigned', 'pending',
      jsonb_build_object(
        'source', 'inbound_email',
        'inbound_email_id', v_email.id,
        'mailbox', v_mailbox.address,
        'subject', v_email.subject
      )
    )
    returning id into v_lead_id;
  else
    update public.leads
    set phone = coalesce(phone, v_phone),
        full_name = case when full_name is null or btrim(full_name) = '' then v_name else full_name end,
        updated_at = now()
    where id = v_lead_id;
  end if;

  perform public.assign_lead(
    v_lead_id,
    p_agent_id,
    'Contacto convertido desde correo recibido en contacto@abogadolegal.cl',
    'inbound_email',
    false,
    null
  );

  update public.inbound_emails
  set status = 'converted',
      lead_id = v_lead_id,
      converted_by = v_actor_id,
      converted_at = now(),
      detected_phone = coalesce(v_phone, detected_phone),
      updated_at = now()
  where id = p_email_id;

  return jsonb_build_object('lead_id', v_lead_id, 'reused', false);
end;
$function$;

revoke all on function public.convert_inbound_email_to_lead(uuid, uuid, text, text) from public, anon;
grant execute on function public.convert_inbound_email_to_lead(uuid, uuid, text, text) to authenticated;
