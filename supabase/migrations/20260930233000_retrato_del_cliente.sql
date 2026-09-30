-- El "antes" del Estudio de Look: la foto del cliente rehecha como retrato de
-- estudio (mismo pelo, misma cara), con el encuadre, la luz y el fondo de las
-- simulaciones. Así el antes y el después se comparan de igual a igual.
-- Es una imagen de su cara: se borra con las fotos originales.
alter table public.looks add column if not exists retrato_path text;

alter table public.looks drop constraint if exists looks_retrato_de_la_empresa;
alter table public.looks add constraint looks_retrato_de_la_empresa
  check (retrato_path is null or split_part(retrato_path, '/', 1) = organization_id::text);
