-- Atlas le escribe por WhatsApp a quien mostró interés en la campaña.
--
-- Hasta hoy el primer WhatsApp a quien abrió o hizo clic se mandaba a mano
-- desde el teléfono. Con el número conectado a Atlas, lo manda el agente
-- (src/lib/prospeccion-whatsapp.ts) con una plantilla aprobada por Meta, y la
-- conversación sigue en el teléfono.
--
-- 1. El interruptor vive con la correa del agente vendedor: apagado por
--    defecto, con tope diario, y con el motivo si Atlas lo pausó solo (por
--    ejemplo, porque Meta bajó la calidad del número).
-- 2. Lo que Atlas envía queda en prospeccion_whatsapp marcado como
--    automático, con su estado de entrega (el webhook lo actualiza).
-- 3. Dos funciones de servicio anotan en la bandeja lo que hizo el agente: el
--    envío (vuelve en unos días si no contesta) y los cierres (pidió la baja,
--    el número no tiene WhatsApp, el mensaje no se entregó).

alter table public.sales_agent_configs
  add column if not exists whatsapp_automatico boolean not null default false,
  add column if not exists whatsapp_por_dia integer not null default 15,
  add column if not exists whatsapp_pausa text,
  add column if not exists whatsapp_cambiado_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'sales_agent_configs_whatsapp_por_dia_check'
      and conrelid = 'public.sales_agent_configs'::regclass
  ) then
    alter table public.sales_agent_configs
      add constraint sales_agent_configs_whatsapp_por_dia_check check (whatsapp_por_dia between 1 and 60);
  end if;
end;
$$;

comment on column public.sales_agent_configs.whatsapp_automatico is
  'Atlas le escribe solo por WhatsApp a quien abrió o hizo clic en la campaña (pregunta y un seguimiento).';
comment on column public.sales_agent_configs.whatsapp_pausa is
  'Por qué Atlas apagó solo el WhatsApp automático (calidad del número, límite de Meta). Se limpia al encenderlo.';

alter table public.prospeccion_whatsapp
  add column if not exists automatico boolean not null default false,
  add column if not exists estado text,
  add column if not exists error text,
  add column if not exists revisado_at timestamptz;

create index if not exists prospeccion_whatsapp_wamid_idx
  on public.prospeccion_whatsapp (wamid);

create index if not exists prospeccion_whatsapp_automatico_idx
  on public.prospeccion_whatsapp (organization_id, occurred_at desc)
  where automatico;

create or replace function public.anotar_whatsapp_automatico(
  p_org uuid,
  p_lead uuid,
  p_wamid text,
  p_texto text,
  p_nota text,
  p_dias integer
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  if not exists (select 1 from public.leads l where l.id = p_lead and l.organization_id = p_org) then
    raise exception 'El prospecto no es de esta empresa.';
  end if;

  insert into public.prospeccion_whatsapp (organization_id, lead_id, direction, wamid, texto, occurred_at, automatico, estado)
  values (p_org, p_lead, 'outbound', p_wamid, p_texto, now(), true, 'accepted')
  on conflict (lead_id, wamid) do nothing;

  insert into public.prospeccion_toques (organization_id, lead_id, resultado, nota, seguir_at, hecho_por)
  values (p_org, p_lead, 'whatsapp', p_nota, now() + make_interval(days => greatest(1, least(coalesce(p_dias, 3), 30))), null);
end;
$function$;

revoke all on function public.anotar_whatsapp_automatico(uuid, uuid, text, text, text, integer) from public;
revoke execute on function public.anotar_whatsapp_automatico(uuid, uuid, text, text, text, integer) from anon, authenticated;
grant execute on function public.anotar_whatsapp_automatico(uuid, uuid, text, text, text, integer) to service_role;

create or replace function public.cerrar_prospecto_desde_whatsapp(
  p_org uuid,
  p_lead uuid,
  p_resultado text,
  p_nota text,
  p_dias integer default null
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  if p_resultado not in ('posponer', 'no_interesa', 'numero_malo') then
    raise exception 'Resultado inválido para un cierre automático.';
  end if;
  if not exists (select 1 from public.leads l where l.id = p_lead and l.organization_id = p_org) then
    raise exception 'El prospecto no es de esta empresa.';
  end if;

  insert into public.prospeccion_toques (organization_id, lead_id, resultado, nota, seguir_at, hecho_por)
  values (
    p_org, p_lead, p_resultado, p_nota,
    case when p_dias is null then null else now() + make_interval(days => greatest(0, least(p_dias, 30))) end,
    null
  );
end;
$function$;

revoke all on function public.cerrar_prospecto_desde_whatsapp(uuid, uuid, text, text, integer) from public;
revoke execute on function public.cerrar_prospecto_desde_whatsapp(uuid, uuid, text, text, integer) from anon, authenticated;
grant execute on function public.cerrar_prospecto_desde_whatsapp(uuid, uuid, text, text, integer) to service_role;
