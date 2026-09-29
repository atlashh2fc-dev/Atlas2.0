-- WhatsApp por empresa, y lo que se escribe desde el teléfono cuenta.
--
-- 1. Cada canal dice por qué proveedor sale. Geimser habla directo con Meta;
--    Altius conecta su número por YCloud, que permite usarlo a la vez en la app
--    WhatsApp Business del teléfono y en el CRM (coexistencia). Antes el
--    proveedor era uno solo para todo el despliegue.
--
-- 2. Con coexistencia, cada mensaje que la persona manda desde el teléfono
--    llega al CRM como eco. Si va a alguien que está en Por contactar, eso es
--    exactamente «Le escribí»: se anota solo, con seguimiento en tres días. Así
--    abrir WhatsApp no anota nada (29-09) y enviar anota sin pedir un clic más.

alter table public.whatsapp_channels
  add column if not exists provider text not null default 'meta';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'whatsapp_channels_provider_check'
      and conrelid = 'public.whatsapp_channels'::regclass
  ) then
    alter table public.whatsapp_channels
      add constraint whatsapp_channels_provider_check check (provider in ('meta', 'ycloud'));
  end if;
end;
$$;

comment on column public.whatsapp_channels.provider is
  'Por dónde sale y entra este número: meta (Cloud API directa) o ycloud (proveedor con coexistencia con la app Business).';

create or replace function public.anotar_whatsapp_desde_el_telefono(
  p_organization_id uuid,
  p_telefono text,
  p_enviado_at timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_ultimos text := right(regexp_replace(coalesce(p_telefono, ''), '[^0-9]', '', 'g'), 9);
  v_cuando timestamptz := least(coalesce(p_enviado_at, now()), now());
  v_anotados integer := 0;
begin
  if p_organization_id is null or length(v_ultimos) < 8 then
    return 0;
  end if;

  -- Lo barato primero: casi todos los mensajes van a gente que no está en la
  -- bandeja, y para ellos no hace falta calcularla.
  if not exists (
    select 1 from public.leads l
    where l.organization_id = p_organization_id
      and right(regexp_replace(l.phone, '[^0-9]', '', 'g'), 9) = v_ultimos
  ) then
    return 0;
  end if;

  insert into public.prospeccion_toques (organization_id, lead_id, resultado, nota, seguir_at, hecho_por)
  select p_organization_id, b.lead_id, 'whatsapp', 'Enviado desde el WhatsApp del teléfono',
         v_cuando + interval '3 days', null
  from public.prospeccion_de_empresa(p_organization_id, 14) b
  where b.no_contactar is null
    and right(regexp_replace(coalesce(b.telefono, ''), '[^0-9]', '', 'g'), 9) = v_ultimos
    -- Un hilo de varios mensajes es un solo contacto, y si alguien ya marcó
    -- «Le escribí» a mano no se duplica.
    and not exists (
      select 1 from public.prospeccion_toques t
      where t.lead_id = b.lead_id
        and t.resultado in ('whatsapp', 'llamada', 'correo')
        and t.created_at > v_cuando - interval '12 hours'
    )
  limit 5;

  get diagnostics v_anotados = row_count;
  return v_anotados;
end;
$function$;

revoke all on function public.anotar_whatsapp_desde_el_telefono(uuid, text, timestamptz) from public;
revoke execute on function public.anotar_whatsapp_desde_el_telefono(uuid, text, timestamptz) from anon, authenticated;
grant execute on function public.anotar_whatsapp_desde_el_telefono(uuid, text, timestamptz) to service_role;
