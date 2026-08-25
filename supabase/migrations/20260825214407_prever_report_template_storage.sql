-- Plantillas contractuales de reportes. Solo el backend con service_role
-- puede leer o escribir estos archivos; el navegador recibe únicamente el
-- informe final después de autorizar a un administrador y aplicar RLS.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'campaign-report-templates',
  'campaign-report-templates',
  false,
  10485760,
  array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
