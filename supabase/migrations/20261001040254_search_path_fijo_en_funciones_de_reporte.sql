-- Funciones de reporte con search_path mutable (advisor 0011). No son
-- SECURITY DEFINER, pero un search_path fijo evita que resuelvan objetos de
-- otro esquema según quién las llame.
alter function public.nombre_presentable(text) set search_path to 'pg_catalog', 'public';
alter function public.report_call_handle_seconds(timestamp with time zone, timestamp with time zone, text) set search_path to 'pg_catalog', 'public';
alter function public.report_call_is_quote(text) set search_path to 'pg_catalog', 'public';
