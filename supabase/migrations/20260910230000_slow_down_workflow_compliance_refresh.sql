-- Baja la frecuencia del refresco de workflow_compliance_mv.
--
-- Estaba cada 2 minutos, sin condición ni horario. En 85 días acumuló 60.542
-- refrescos de 425 ms cada uno: 7,1 horas de trabajo de base de datos, el 39 %
-- de todo lo que la instancia ha ejecutado desde que existe, para alimentar un
-- panel de cumplimiento que se consulta un puñado de veces al día.
--
-- Cada 10 minutos deja el mismo panel con un desfase máximo de 10 minutos en
-- vez de 2, que para una métrica de cumplimiento acumulada no cambia ninguna
-- decisión, y elimina el 80 % de esos refrescos.
--
-- Si alguna vez se necesita más fresco, es una línea: volver a '*/2 * * * *'.

select cron.schedule(
  'refresh-workflow-compliance-mv',
  '*/10 * * * *',
  $$refresh materialized view concurrently public.workflow_compliance_mv$$
);
