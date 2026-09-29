-- Lo que un prospecto contesta por WhatsApp cuenta en Por contactar.
--
-- Con el número conectado en coexistencia, lo que llega al teléfono llega
-- también a Atlas. Para la bandeja basta saber que respondió (el mensaje se lee
-- en el teléfono): sube al primer lugar como «Respondió» y vuelve a aparecer
-- aunque estuviera esperando seguimiento, igual que una respuesta por correo.
-- Se guarda solo lo que cruza con un prospecto de campaña, no toda la
-- mensajería de la empresa.

-- De paso: cuándo vence el token de Meta de cada canal. La configuración actual
-- del registro da 60 días; Integraciones avisa antes de que el canal se corte.
alter table public.whatsapp_channels
  add column if not exists token_vence_at timestamptz;

create table if not exists public.prospeccion_whatsapp (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  lead_id uuid not null references public.leads(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  wamid text not null,
  texto text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (lead_id, wamid)
);

create index if not exists prospeccion_whatsapp_org_idx
  on public.prospeccion_whatsapp (organization_id, direction, occurred_at desc);

alter table public.prospeccion_whatsapp enable row level security;

drop policy if exists prospeccion_whatsapp_lectura on public.prospeccion_whatsapp;
create policy prospeccion_whatsapp_lectura
on public.prospeccion_whatsapp
for select
to authenticated
-- Lo lee el equipo comercial, como la bandeja: los ejecutivos no ven prospección.
using (
  public.is_platform_owner()
  or (organization_id = any (public.current_org_ids())
      and (select public.current_role_name()) in ('admin'::public.app_role, 'supervisor'::public.app_role))
);

create or replace function public.registrar_whatsapp_de_prospecto(
  p_organization_id uuid,
  p_telefono text,
  p_direction text,
  p_wamid text,
  p_texto text default null,
  p_at timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_ultimos text := right(regexp_replace(coalesce(p_telefono, ''), '[^0-9]', '', 'g'), 9);
  v_guardados integer := 0;
begin
  if p_organization_id is null or length(v_ultimos) < 8 or nullif(btrim(coalesce(p_wamid, '')), '') is null
     or p_direction not in ('inbound', 'outbound') then
    return 0;
  end if;

  insert into public.prospeccion_whatsapp (organization_id, lead_id, direction, wamid, texto, occurred_at)
  select p_organization_id, l.id, p_direction, p_wamid, left(p_texto, 2000), least(coalesce(p_at, now()), now())
  from public.leads l
  where l.organization_id = p_organization_id
    and right(regexp_replace(l.phone, '[^0-9]', '', 'g'), 9) = v_ultimos
    -- Solo prospectos de campaña: el resto de la mensajería ya vive en sus conversaciones.
    and exists (select 1 from public.external_lead_events e where e.lead_id = l.id)
  limit 5
  on conflict (lead_id, wamid) do nothing;

  get diagnostics v_guardados = row_count;
  return v_guardados;
end;
$function$;

revoke all on function public.registrar_whatsapp_de_prospecto(uuid, text, text, text, text, timestamptz) from public;
revoke execute on function public.registrar_whatsapp_de_prospecto(uuid, text, text, text, text, timestamptz) from anon, authenticated;
grant execute on function public.registrar_whatsapp_de_prospecto(uuid, text, text, text, text, timestamptz) to service_role;

create or replace function public.prospeccion_de_empresa(p_org uuid, p_dias integer default 14)
returns table (
  lead_id uuid,
  empresa text,
  contacto text,
  email text,
  telefono text,
  campana text,
  clic boolean,
  aperturas integer,
  respondio boolean,
  primera_senal_at timestamptz,
  ultima_senal_at timestamptz,
  ultimo_resultado text,
  ultimo_toque_at timestamptz,
  seguir_at timestamptz,
  toques integer,
  estado text,
  prioridad integer,
  correos jsonb,
  no_contactar text
)
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
  with ventana as (
    select now() - make_interval(days => greatest(1, least(coalesce(p_dias, 14), 60))) as desde
  ),
  senales as (
    select e.lead_id,
           bool_or(e.payload->>'event_kind' = 'clicked') as clic,
           count(*) filter (where e.payload->>'event_kind' = 'opened')::int as aperturas,
           min(e.occurred_at) as primera,
           max(e.occurred_at) as ultima
    from public.external_lead_events e
    join public.leads l on l.id = e.lead_id and l.organization_id = p_org
    where e.payload->>'event_kind' in ('opened', 'clicked')
      and e.occurred_at > (select desde from ventana)
      -- A segundos del envío es un escáner, no una persona.
      and e.occurred_at >= coalesce((
        select min(s.occurred_at)
        from public.external_lead_events s
        where s.lead_id = e.lead_id
          and s.payload->>'event_kind' = 'sent'
          and s.payload->>'message_id' = e.payload->>'message_id'
      ), '-infinity'::timestamptz) + interval '60 seconds'
    group by e.lead_id
  ),
  respuestas as (
    select x.lead_id, min(x.occurred_at) as primera, max(x.occurred_at) as ultima
    from (
      select m.lead_id, m.occurred_at
      from public.lead_mail_messages m
      join public.leads l on l.id = m.lead_id and l.organization_id = p_org
      where m.direction = 'inbound'
        and m.occurred_at > (select desde from ventana)
      union all
      -- Contestar por WhatsApp es responder igual que por correo.
      select w.lead_id, w.occurred_at
      from public.prospeccion_whatsapp w
      where w.organization_id = p_org
        and w.direction = 'inbound'
        and w.occurred_at > (select desde from ventana)
    ) x
    group by x.lead_id
  ),
  interes as (
    select coalesce(s.lead_id, r.lead_id) as lead_id,
           coalesce(s.clic, false) as clic,
           coalesce(s.aperturas, 0) as aperturas,
           r.lead_id is not null as respondio,
           least(s.primera, r.primera) as primera,
           greatest(s.ultima, r.ultima) as ultima
    from senales s
    full join respuestas r on r.lead_id = s.lead_id
  ),
  -- Cada correo de la secuencia, sin ventana: para escribirle hay que saber
  -- todo lo que se le mandó, no solo lo de estas dos semanas.
  eventos as (
    select e.lead_id,
           e.payload->>'message_id' as mensaje,
           e.payload->>'event_kind' as tipo,
           e.payload->>'message_subject' as asunto,
           e.occurred_at
    from public.external_lead_events e
    where e.lead_id in (select i.lead_id from interes i)
      and e.payload->>'event_kind' in ('sent', 'opened', 'clicked')
      and e.payload->>'message_id' is not null
  ),
  enviados as (
    select ev.lead_id, ev.mensaje, max(ev.asunto) as asunto,
           min(ev.occurred_at) filter (where ev.tipo = 'sent') as enviado_at
    from eventos ev
    group by ev.lead_id, ev.mensaje
  ),
  mensajes as (
    select d.lead_id,
           jsonb_agg(jsonb_build_object(
             'asunto', d.asunto,
             'enviado_at', d.enviado_at,
             'abierto_at', a.abierto_at,
             'clic', coalesce(a.clic, false)
           ) order by d.enviado_at nulls last) as lista
    from enviados d
    left join lateral (
      select min(ev.occurred_at) as abierto_at,
             bool_or(ev.tipo = 'clicked') as clic
      from eventos ev
      where ev.lead_id = d.lead_id
        and ev.mensaje = d.mensaje
        and ev.tipo in ('opened', 'clicked')
        and ev.occurred_at >= coalesce(d.enviado_at, '-infinity'::timestamptz) + interval '60 seconds'
    ) a on true
    group by d.lead_id
  ),
  toques as (
    select distinct on (t.lead_id)
           t.lead_id, t.resultado, t.created_at, t.seguir_at,
           count(*) over (partition by t.lead_id)::int as cuantos
    from public.prospeccion_toques t
    where t.organization_id = p_org
    order by t.lead_id, t.created_at desc
  ),
  cola as (
    select i.*, l.full_name, l.email, l.phone, l.extra, l.campaign_id,
           nullif(btrim(l.extra->>'no_contactar'), '') as no_contactar,
           u.resultado, u.created_at as toque_at, u.seguir_at, coalesce(u.cuantos, 0) as cuantos,
           case
             when nullif(btrim(l.extra->>'no_contactar'), '') is not null then 'no_contactar'
             when u.lead_id is null then 'nuevo'
             when i.ultima > u.created_at then 'volvio'
             when u.seguir_at <= now() then 'seguimiento'
             else 'esperando'
           end as estado
    from interes i
    join public.leads l on l.id = i.lead_id
    left join toques u on u.lead_id = i.lead_id
    where not exists (
        select 1 from public.lead_mail_status lms
        where lms.lead_id = l.id and (lms.unsubscribed or lms.complained)
      )
      -- Si ya es negocio, se trabaja en el pipeline.
      and not exists (
        select 1 from public.sales_opportunities o
        where o.organization_id = p_org and o.lead_id = l.id
      )
      and coalesce(u.resultado, '') not in ('interesado', 'no_interesa', 'numero_malo')
  )
  select c.lead_id,
         public.nombre_presentable(coalesce(
           nullif(btrim(c.extra->>'company_name'), ''),
           nullif(btrim(c.extra->>'company'), ''),
           nullif(btrim(c.full_name), ''),
           split_part(c.email, '@', 1)
         )),
         public.nombre_presentable(coalesce(nullif(btrim(c.extra->>'contact_name'), ''), nullif(btrim(c.full_name), ''))),
         c.email,
         nullif(btrim(c.phone), ''),
         ca.name,
         c.clic,
         c.aperturas,
         c.respondio,
         c.primera,
         c.ultima,
         c.resultado,
         c.toque_at,
         c.seguir_at,
         c.cuantos,
         c.estado,
         case
           when c.no_contactar is not null then 9
           when c.respondio then 0
           when c.clic then 1
           when c.estado = 'volvio' then 2
           when c.estado = 'nuevo' and c.aperturas > 1 then 3
           when c.estado = 'nuevo' then 4
           else 5
         end,
         coalesce(m.lista, '[]'::jsonb),
         c.no_contactar
  from cola c
  left join public.campaigns ca on ca.id = c.campaign_id
  left join mensajes m on m.lead_id = c.lead_id
  where c.estado <> 'esperando'
  order by 17, c.ultima desc nulls last;
$function$;
