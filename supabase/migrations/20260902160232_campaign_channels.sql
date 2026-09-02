-- Canales habilitados por campaña.
--
-- El menú y el README ya prometían "canales habilitados por campaña", pero no
-- existía ningún modelo detrás: el puesto de atención del ejecutivo abría el
-- inbox de WhatsApp sin mirar la campaña. En la operación real es al revés
-- —Equifax lleva 31.123 llamadas y cero conversaciones de WhatsApp—, así que el
-- ejecutivo de una campaña de voz aterrizaba en una bandeja vacía.
--
-- Los valores del canal reusan el vocabulario que ya existe en la base:
-- 'phone' y 'whatsapp' son los de `leads.next_action_channel`, y 'mail' es el
-- de `inbound_mailboxes` y `mail_campaigns`.

create table public.campaign_channels (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  channel text not null check (channel in ('phone', 'whatsapp', 'mail')),
  enabled boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (campaign_id, channel)
);

-- La PK ya indexa `campaign_id` como columna líder, así que la FK queda
-- cubierta. Este índice es para la consulta inversa: "qué campañas tienen
-- WhatsApp activo".
create index campaign_channels_enabled_idx
  on public.campaign_channels(channel, campaign_id)
  where enabled;

create trigger campaign_channels_set_updated_at
  before update on public.campaign_channels
  for each row execute function public.set_updated_at();

-- Backfill desde el estado real de la operación, no desde un default alegre.
insert into public.campaign_channels (campaign_id, channel, enabled)
select signals.campaign_id, channel.name, channel.enabled
from (
  select
    c.id as campaign_id,
    exists (
      select 1 from public.calls call
      join public.leads l on l.id = call.lead_id
      where l.campaign_id = c.id
    ) as has_calls,
    exists (
      select 1 from public.leads l
      where l.campaign_id = c.id and l.phone is not null and btrim(l.phone) <> ''
    ) as has_phone_leads,
    exists (
      select 1 from public.whatsapp_conversations w where w.campaign_id = c.id
    ) or exists (
      select 1 from public.whatsapp_campaign_routes r
      where r.campaign_id = c.id and r.is_active
    ) as has_whatsapp,
    exists (
      select 1 from public.inbound_mailboxes m where m.campaign_id = c.id and m.active
    ) or exists (
      select 1 from public.mail_campaigns mc where mc.campaign_id = c.id
    ) as has_mail
  from public.campaigns c
) signals
cross join lateral (
  values
    -- Voz es el canal por defecto: si la campaña no tiene señal de ningún otro
    -- canal, queda con voz antes que sin ninguno. Una campaña sin canales no
    -- se puede atender y no habría forma de notarlo desde la interfaz.
    ('phone', signals.has_calls or signals.has_phone_leads
       or not (signals.has_whatsapp or signals.has_mail)),
    ('whatsapp', signals.has_whatsapp),
    ('mail', signals.has_mail)
) as channel(name, enabled)
on conflict (campaign_id, channel) do nothing;

alter table public.campaign_channels enable row level security;

-- Lectura abierta a cualquier autenticado, igual que `campaigns_select`: esto
-- es configuración de la operación, no datos del cliente, y el ejecutivo
-- necesita saber qué canales tiene su campaña para que se le pinte la pestaña.
create policy campaign_channels_select
on public.campaign_channels for select to authenticated
using (true);

create policy campaign_channels_admin_insert
on public.campaign_channels for insert to authenticated
with check ((select public.current_role_name()) = 'admin'::public.app_role);

create policy campaign_channels_admin_update
on public.campaign_channels for update to authenticated
using ((select public.current_role_name()) = 'admin'::public.app_role)
with check ((select public.current_role_name()) = 'admin'::public.app_role);

create policy campaign_channels_admin_delete
on public.campaign_channels for delete to authenticated
using ((select public.current_role_name()) = 'admin'::public.app_role);

comment on table public.campaign_channels is
  'Canales de atención habilitados por campaña. Gobierna qué pestañas ve el ejecutivo en su puesto de atención.';
