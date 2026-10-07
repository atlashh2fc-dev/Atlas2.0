-- Plantillas de WhatsApp aprobadas por Meta, por canal.
--
-- Fuera de las 24 horas desde el último mensaje de la persona, WhatsApp solo
-- acepta plantillas aprobadas. Cada canal guarda los nombres que Meta ya le
-- aprobó (por ejemplo «atlas_cita_por_confirmar_v1»); el despacho usa la
-- plantilla si está en la lista y, si no, pasa el mensaje a correo cuando la
-- ficha lo tiene, en vez de fallar contra Meta.
alter table public.whatsapp_channels add column if not exists plantillas_aprobadas text[] not null default '{}';
