-- Dedup por RUT (cuando existe), agrupado por campaña (o por la bolsa "sin campaña").
-- Se compara el RUT normalizado (sin puntos/guion, mayúsculas) para que distintos formatos
-- del mismo RUT no generen duplicados, sin reescribir el valor visible que el usuario cargó.
create unique index if not exists leads_dedup_rut_idx
on public.leads (
  (coalesce(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid)),
  (upper(regexp_replace(rut, '[^0-9kK]', '', 'g')))
)
where rut is not null and btrim(rut) <> '';

-- Dedup por teléfono solo cuando NO hay rut (el rut es la fuente de verdad cuando existe).
-- Se compara el teléfono normalizado (solo dígitos).
create unique index if not exists leads_dedup_phone_idx
on public.leads (
  (coalesce(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid)),
  (regexp_replace(phone, '[^0-9]', '', 'g'))
)
where rut is null and phone is not null and btrim(phone) <> '';
;
