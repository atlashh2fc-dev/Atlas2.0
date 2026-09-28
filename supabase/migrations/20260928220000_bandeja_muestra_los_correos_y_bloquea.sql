-- Pegar en Supabase > proyecto atlas-crm (lxdclavsycdidmzlbaid) > SQL Editor > Run.
--
-- La bandeja de prospección dice qué correo leyó cada prospecto, y deja
-- marcar a quien no se debe contactar.
--
-- 28-09-2026. Antes de escribir por WhatsApp había que adivinar de qué se le
-- habló: la bandeja solo decía "Abrió el correo". Ahora cada fila trae los
-- correos de la secuencia (asunto, cuándo salió, si lo abrió una persona y
-- cuándo), y el mensaje se arma sobre el correo que leyó.
--
-- Ese mismo día apareció que el 21-09 Atlas Lead mandó 12 correos de Altius
-- con asunto "alternativa para bajar cuentas de luz y gas" y, como cuerpo, la
-- instrucción interna para la IA. Cuatro de ellos estaban en la bandeja como
-- "por contactar". A esa gente no se le escribe: leads.extra->>'no_contactar'
-- guarda el motivo, la fila se queda a la vista con la marca y sin acciones, y
-- no cuenta como pendiente (el vigilante cuenta solo estado 'nuevo').

drop function if exists public.bandeja_de_prospeccion(integer);
drop function if exists public.prospeccion_de_empresa(uuid, integer);

create function public.prospeccion_de_empresa(p_org uuid, p_dias integer default 14)
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
    select m.lead_id, min(m.occurred_at) as primera, max(m.occurred_at) as ultima
    from public.lead_mail_messages m
    join public.leads l on l.id = m.lead_id and l.organization_id = p_org
    where m.direction = 'inbound'
      and m.occurred_at > (select desde from ventana)
    group by m.lead_id
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

revoke all on function public.prospeccion_de_empresa(uuid, integer) from public;
revoke execute on function public.prospeccion_de_empresa(uuid, integer) from anon, authenticated;
grant execute on function public.prospeccion_de_empresa(uuid, integer) to service_role;

create function public.bandeja_de_prospeccion(p_dias integer default 14)
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
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  if (select public.current_role_name()) not in ('admin'::public.app_role, 'supervisor'::public.app_role)
     and not public.is_platform_owner() then
    raise exception 'Solo el equipo comercial ve la bandeja' using errcode = '42501';
  end if;
  return query select * from public.prospeccion_de_empresa(public.current_org_id(), p_dias);
end;
$function$;

revoke all on function public.bandeja_de_prospeccion(integer) from public;
revoke execute on function public.bandeja_de_prospeccion(integer) from anon;
grant execute on function public.bandeja_de_prospeccion(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Los 12 que recibieron el correo con la instrucción de la IA. El asunto llega
-- cortado a external_lead_events (Improfor: "alternativa para b"), así que se
-- identifican por su id en Atlas Lead: los outreach_messages del 21-09 cuyo
-- cuerpo empieza con "Escribe a una pyme".

update public.leads l
set extra = coalesce(l.extra, '{}'::jsonb) || jsonb_build_object(
  'no_contactar', 'El 21-09 recibió un correo con error (asunto «luz y gas» y la instrucción de la IA como texto). No escribirle.',
  'no_contactar_at', now()
)
where l.organization_id = public.organization_id_by_slug('altius')
  and coalesce(l.extra->>'atlas_lead_external_key', l.extra->>'source_lead_id') in (
    '0a2657a8-7f3b-41de-ac50-b5e2ec908891', '1114dd8d-1346-4e78-a97e-9cb7d3dd90e7',
    '12183b2d-e808-4ddb-ab4e-6e15f791ee04', '1576afd6-3a0a-48d2-a18e-162ccbbacaa1',
    '1aa731be-32df-49b6-8081-bb2602680df8', '1b07c6e1-19ac-46c0-a3d3-9ab7d8f94d64',
    '27401f9d-3420-4189-9065-e37e3b392be0', '27dfd946-a225-41da-9f64-a413cb35b571',
    '29744672-60d1-4092-9291-106d1bff41e5', '3649e172-9cfa-4ea1-9909-2c4b2dba946c',
    '583af542-08d7-411b-9adc-3eca9e71d70f', 'b5bc5160-aa18-47db-8df6-e3cf55cc8892'
  )
  and nullif(btrim(l.extra->>'no_contactar'), '') is null;
