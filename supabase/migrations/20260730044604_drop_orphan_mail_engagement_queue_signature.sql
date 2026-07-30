-- Quedaban dos firmas de la misma función: la de tres argumentos es huérfana
-- desde que se agregó la paginación. Con dos firmas, cualquier llamada que no
-- calce exacto responde PGRST203 (ambigua).
drop function if exists public.get_mail_engagement_queue(uuid, uuid, integer);
