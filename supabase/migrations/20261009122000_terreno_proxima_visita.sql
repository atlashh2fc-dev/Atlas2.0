-- Terreno: cuándo volver.
--
-- El curso de Mercado Pago en Atlas Aprende enseña a dejar cada visita con
-- su próxima acción y fecha ("volver el jueves 10:30"). La fecha queda en la
-- ficha y ordena la lista del vendedor: lo vencido y lo de hoy, arriba.
--
-- No se usa leads.next_action_at a propósito: esa columna la leen la agenda
-- del panel y el discador, y estos clientes no se llaman desde Atlas.

alter table public.terreno_fichas
  add column if not exists proxima_visita_at timestamptz;

create index if not exists terreno_fichas_proxima_idx
  on public.terreno_fichas (vendedor_id, proxima_visita_at)
  where proxima_visita_at is not null;

drop function if exists public.terreno_registrar_visita(uuid, text, text, text, double precision, double precision, integer, text, text, integer, text);

create or replace function public.terreno_registrar_visita(
  p_lead_id uuid,
  p_etapa text,
  p_motivo_salida text default null,
  p_nota text default null,
  p_lat double precision default null,
  p_lng double precision default null,
  p_precision_m integer default null,
  p_sin_ubicacion text default null,
  p_foto_path text default null,
  p_pos_cantidad integer default null,
  p_pos_modelo text default null,
  p_proxima_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_actor uuid := (select auth.uid());
  v_ficha public.terreno_fichas%rowtype;
  v_rank smallint;
  v_visita uuid;
  v_status text;
begin
  select * into v_ficha from public.terreno_fichas where lead_id = p_lead_id for update;
  if not found or v_ficha.vendedor_id is distinct from v_actor then
    raise exception 'Solo el vendedor del cliente registra sus visitas.';
  end if;
  perform public.terreno_assert_campana(v_ficha.campaign_id);

  v_rank := case p_etapa
    when 'visitado' then 1 when 'interesado' then 2 when 'documentos' then 3 when 'vendido' then 4
    when 'descartado' then 0 else null end;
  if v_rank is null then
    raise exception 'Elige el resultado de la visita.';
  end if;
  if p_etapa = 'descartado' and coalesce(p_motivo_salida, '') not in ('no_interesado', 'cerrado', 'no_ubicado') then
    raise exception 'Indica por qué no sigue.';
  end if;
  if p_etapa = 'vendido' and coalesce(p_pos_cantidad, 0) < 1 then
    raise exception 'Indica cuántos lectores vendiste.';
  end if;
  if nullif(btrim(coalesce(p_foto_path, '')), '') is null then
    raise exception 'Falta la foto de la visita.';
  end if;
  if p_foto_path not like v_ficha.organization_id::text || '/' || p_lead_id::text || '/%' then
    raise exception 'La foto no corresponde a este cliente.';
  end if;
  if (p_lat is null or p_lng is null) and nullif(btrim(coalesce(p_sin_ubicacion, '')), '') is null then
    raise exception 'Falta la ubicación de la visita.';
  end if;
  if p_proxima_at is not null and p_proxima_at < now() - interval '5 minutes' then
    raise exception 'La próxima visita no puede quedar en el pasado.';
  end if;

  insert into public.terreno_visitas (
    lead_id, campaign_id, organization_id, vendedor_id, etapa_antes, etapa, motivo_salida,
    nota, lat, lng, precision_m, sin_ubicacion, foto_path, pos_cantidad, pos_modelo
  )
  values (
    p_lead_id, v_ficha.campaign_id, v_ficha.organization_id, v_actor, v_ficha.etapa, p_etapa,
    case when p_etapa = 'descartado' then p_motivo_salida end,
    nullif(left(btrim(coalesce(p_nota, '')), 1000), ''),
    p_lat, p_lng, p_precision_m,
    case when p_lat is null or p_lng is null then left(btrim(p_sin_ubicacion), 200) end,
    p_foto_path,
    case when p_etapa = 'vendido' then p_pos_cantidad end,
    case when p_etapa = 'vendido' then nullif(left(btrim(coalesce(p_pos_modelo, '')), 80), '') end
  )
  returning id into v_visita;

  update public.terreno_fichas
  set etapa = p_etapa,
      etapa_max = greatest(etapa_max, v_rank),
      motivo_salida = case when p_etapa = 'descartado' then p_motivo_salida end,
      pos_cantidad = case when p_etapa = 'vendido' then p_pos_cantidad else pos_cantidad end,
      pos_modelo = case when p_etapa = 'vendido' then nullif(btrim(coalesce(p_pos_modelo, '')), '') else pos_modelo end,
      -- Vendido o fuera del embudo no tiene "volver"; el resto, lo que se acordó.
      proxima_visita_at = case when p_etapa in ('vendido', 'descartado') then null else p_proxima_at end,
      visitas = visitas + 1,
      ultima_visita_at = now(),
      etapa_at = case when etapa is distinct from p_etapa then now() else etapa_at end,
      updated_at = now()
  where lead_id = p_lead_id;

  v_status := case p_etapa
    when 'visitado' then 'contactado'
    when 'interesado' then 'en_gestion'
    when 'documentos' then 'en_gestion'
    when 'vendido' then 'convertido'
    when 'descartado' then case when p_motivo_salida = 'no_ubicado' then 'no_contactado' else 'descartado' end
  end;

  update public.leads
  set status = v_status,
      managed_at = now(),
      managed_by = v_actor,
      observacion_actual = coalesce(nullif(left(btrim(coalesce(p_nota, '')), 1000), ''), observacion_actual)
  where id = p_lead_id;

  return v_visita;
end;
$$;

revoke all on function public.terreno_registrar_visita(uuid, text, text, text, double precision, double precision, integer, text, text, integer, text, timestamptz) from public, anon;
grant execute on function public.terreno_registrar_visita(uuid, text, text, text, double precision, double precision, integer, text, text, integer, text, timestamptz) to authenticated;
