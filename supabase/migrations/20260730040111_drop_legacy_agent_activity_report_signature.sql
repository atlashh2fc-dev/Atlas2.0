-- La versión de dos argumentos quedaba conviviendo con la nueva de tres (con
-- valor por omisión), lo que hacía ambigua cualquier llamada con dos
-- parámetros. Se elimina la firma antigua.
drop function if exists public.get_agent_activity_report(date, date);
