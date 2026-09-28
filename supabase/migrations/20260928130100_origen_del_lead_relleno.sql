-- Relleno de lead_origins para los leads que ya existían (ver 20260928130000).
-- Va aparte para que el recálculo de toda la base no corra dentro de la
-- transacción que crea los disparadores, que bloquea las escrituras en leads.
-- Sólo lee leads; si un disparador ya guardó una fila más nueva, se respeta.

insert into public.lead_origins (lead_id, organization_id, origin_name)
select
  l.id,
  l.organization_id,
  public.lead_origin_name(null, l.external_last_source_code, l.extra, l.legacy_lead_id is not null)
from public.leads l
on conflict (lead_id) do nothing;
