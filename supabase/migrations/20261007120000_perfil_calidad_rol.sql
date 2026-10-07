-- Perfil «Calidad»: analista que escucha, transcribe, evalúa y valida llamadas
-- contra la pauta de su empresa, sin operar clientes ni configurar campañas.
--
-- Va en su propia migración porque Postgres no deja usar un valor nuevo de un
-- enum dentro de la misma transacción que lo agrega.
alter type public.app_role add value if not exists 'calidad';
