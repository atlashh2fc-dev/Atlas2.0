-- El look en 3D: a partir de las vistas simuladas del corte, un modelo de
-- reconstrucción (Rodin, por fal) arma el 3D del cliente con su look. Tarda un
-- par de minutos, así que se pide a una cola y se consulta hasta que esté.

alter table public.look_propuestas
  add column if not exists modelo_estado text,
  add column if not exists modelo_path text,
  add column if not exists modelo_solicitud jsonb,
  add column if not exists modelo_at timestamptz;

alter table public.look_propuestas drop constraint if exists look_propuestas_modelo_estado_check;
alter table public.look_propuestas add constraint look_propuestas_modelo_estado_check
  check (modelo_estado is null or modelo_estado in ('generando', 'listo', 'fallido'));

alter table public.look_propuestas drop constraint if exists look_propuestas_modelo_de_la_empresa;
alter table public.look_propuestas add constraint look_propuestas_modelo_de_la_empresa
  check (modelo_path is null or split_part(modelo_path, '/', 1) = organization_id::text);

alter table public.uso_ia_looks drop constraint if exists uso_ia_looks_tipo_check;
alter table public.uso_ia_looks add constraint uso_ia_looks_tipo_check check (tipo in ('analisis', 'imagen', 'modelo3d'));

-- El bucket acepta el modelo 3D (glb).
update storage.buckets
   set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'model/gltf-binary', 'application/octet-stream'],
       file_size_limit = 52428800
 where id = 'looks';

create or replace function public.look_compartido(p_token text)
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
  select jsonb_build_object(
    'id', look.id,
    'organization_id', look.organization_id,
    'empresa', organizacion.name,
    'cliente', split_part(cuenta.name, ' ', 1),
    'barbero', look.barbero,
    'fecha', (look.aprobado_at at time zone 'America/Santiago')::date,
    'propuesta', jsonb_build_object(
      'nombre', propuesta.nombre,
      'por_que', propuesta.por_que,
      'mantencion_semanas', propuesta.mantencion_semanas,
      'barba', propuesta.barba,
      'mapa', propuesta.mapa,
      'vistas', propuesta.vistas,
      'modelo', case when propuesta.modelo_estado = 'listo' then propuesta.modelo_path end
    )
  )
  from public.looks look
  join public.organizations organizacion on organizacion.id = look.organization_id
  join public.sales_companies cuenta on cuenta.id = look.cuenta_id
  join public.look_propuestas propuesta on propuesta.id = look.propuesta_aprobada
  where look.compartir_token = p_token
    and length(p_token) >= 32
    and look.estado in ('aprobado', 'realizado');
$function$;

revoke all on function public.look_compartido(text) from public, anon, authenticated;
grant execute on function public.look_compartido(text) to service_role;
