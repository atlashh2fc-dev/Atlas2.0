-- El cliente en 3D tal como llega: con su foto de frente (y de perfil si hay)
-- se arma su modelo 3D apenas se toma la foto. Es la base contra la que se
-- comparan los cortes simulados, que también se arman en 3D.
alter table public.looks
  add column if not exists modelo_estado text,
  add column if not exists modelo_path text,
  add column if not exists modelo_solicitud jsonb,
  add column if not exists modelo_at timestamptz;

alter table public.looks drop constraint if exists looks_modelo_estado_check;
alter table public.looks add constraint looks_modelo_estado_check
  check (modelo_estado is null or modelo_estado in ('generando', 'listo', 'fallido'));

alter table public.looks drop constraint if exists looks_modelo_de_la_empresa;
alter table public.looks add constraint looks_modelo_de_la_empresa
  check (modelo_path is null or split_part(modelo_path, '/', 1) = organization_id::text);
