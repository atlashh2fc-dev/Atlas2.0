-- Tope de las pausas: cada AUX tiene un máximo y el teléfono avisa al pasarse.
--
-- Medición del 25-09-2026 en Equifax: 12 ejecutivas pasaron el 40 % de la
-- jornada en pausa (Trabajo administrativo 11,9 h en 86 veces, Almuerzo 9,8 h,
-- Capacitación 5,4 h, Baño 3,6 h en 45 veces...). `max_seconds` existía desde
-- julio, pero ningún motivo lo tenía puesto y solo se mostraba como "tope
-- sugerido" en la administración: nadie lo controlaba.
--
-- La pausa no se corta a la fuerza. El admin edita el tope en Estados de
-- agente, el teléfono le muestra a la ejecutiva cuánto le queda y, al pasarse,
-- "Te pasaste X min de tu pausa de Y"; el monitor en vivo la marca como
-- excedida. El monitor ya trae reason_id y reason_since cada 2 s y el catálogo
-- de motivos se lee con la RLS de siempre, así que no hace falta otra RPC.
--
-- Idempotente: solo llena topes vacíos (lo que el admin ya ajustó no se pisa)
-- y el motivo nuevo entra con `on conflict do nothing`.

-- 1) Topes por defecto, en minutos, solo donde no hay tope.
--
-- `code` es único en toda la base, así que las empresas creadas después de
-- Geimser llevan prefijo (Andes: andes_descanso, andes_reunion...). El prefijo
-- se acepta para que el mismo motivo reciba el mismo tope en cada empresa.
-- Al 26-09: Geimser tiene todos los códigos sin tope; Andes ya traía descanso
-- 15, almuerzo 45 y gestión posterior 10, y le faltaban capacitación, reunión
-- y desconectado. Colación 60 y no 45: es lo que da el turno de Equifax
-- (campaign_agent_schedules.lunch_minutes); con menos, cada colación normal
-- saltaría como excedida.
with topes (code, minutos) as (
  values
    ('bano', 10),
    ('descanso', 15),
    ('almuerzo', 60),
    ('trabajo_administrativo', 10),
    ('reunion', 30),
    ('capacitacion', 60),
    ('retroalimentacion', 20),
    ('soporte_tecnico', 15),
    ('desconectado', 10)
)
update public.agent_status_reasons reason
   set max_seconds = topes.minutos * 60,
       updated_at = now()
  from topes
 where reason.max_seconds is null
   and reason.is_pause
   and (reason.code = topes.code or reason.code ~ ('^[a-z0-9]+_' || topes.code || '$'));

-- 2) "Correo y cotizaciones" aparte de "Trabajo administrativo".
--
-- El dueño aclaró que Trabajo administrativo mezcla correo o cotizaciones,
-- capacitación y trabajo posterior a la llamada. Con un motivo propio para el
-- correo, lo que quede en administrativo se puede revisar sin ruido. Hereda de
-- trabajo_administrativo cómo cuenta en adherencia y productividad, queda
-- justo después en el menú y lleva el mismo prefijo de empresa si lo tiene.
insert into public.agent_status_reasons
  (organization_id, code, label, is_pause, sort_order, is_active, is_system,
   is_productive, excludes_from_adherence, max_seconds)
select admin.organization_id,
       left(admin.code, length(admin.code) - length('trabajo_administrativo')) || 'correo_cotizaciones',
       'Correo y cotizaciones',
       true,
       admin.sort_order + 1,
       true,
       false,
       admin.is_productive,
       admin.excludes_from_adherence,
       10 * 60
  from public.agent_status_reasons admin
 where admin.code = 'trabajo_administrativo'
    or admin.code ~ '^[a-z0-9]+_trabajo_administrativo$'
on conflict (code) do nothing;

comment on column public.agent_status_reasons.max_seconds is
  'Tope de permanencia en la pausa, en segundos. Nulo = sin tope. No corta la pausa: el teléfono avisa a la ejecutiva y el monitor en vivo la marca como excedida.';
