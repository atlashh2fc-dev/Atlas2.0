# Plantillas de WhatsApp para registrar en Meta

Generado desde `src/lib/mensajes/plantillas-meta.ts` (es la fuente: no editar a mano).

WhatsApp solo deja escribir texto libre dentro de las 24 horas desde el último mensaje de la persona. Los recordatorios que la clínica inicia caen fuera de esa ventana y necesitan una plantilla aprobada. Mientras una plantilla no esté aprobada para el número, Atlas manda ese mensaje por correo si la ficha lo tiene.

## Cómo activarlas

1. Registrar cada plantilla en el WhatsApp Manager de la cuenta (o por la API de plantillas) con el nombre, la categoría, el idioma y el cuerpo exactos.
2. Cuando Meta las apruebe, agregar sus nombres al canal: `update whatsapp_channels set plantillas_aprobadas = array['atlas_cita_por_confirmar_v1', ...] where id = 'ID_DEL_CANAL';`
3. Desde ese momento el despacho las usa solo cuando corresponde (fuera de la ventana de 24 horas).

No cambiar el texto de una plantilla aprobada: si el texto cambia, se registra con otro nombre (`_v2`).

## atlas_cita_por_confirmar_v1

- Uso en Atlas: `cita_confirmar`
- Categoría: UTILITY
- Idioma: Español (es)
- Cuerpo:

> Hola {{1}}, te recordamos {{2}} {{3}} a las {{4}} con {{5}} en {{6}}. ¿Nos confirmas que vienes? Responde SÍ y queda confirmada, o NO si no puedes.

- Ejemplo de variables: {{1}} = Camila · {{2}} = tu hora · {{3}} = mañana · {{4}} = 10:30 · {{5}} = Dra. Vidal · {{6}} = Clínica Sonríe

## atlas_cita_confirmada_v1

- Uso en Atlas: `cita_recordatorio`
- Categoría: UTILITY
- Idioma: Español (es)
- Cuerpo:

> Hola {{1}}, {{2}} a las {{3}} te esperamos en {{4}} con {{5}}. Si no puedes venir, responde NO y liberamos la hora.

- Ejemplo de variables: {{1}} = Camila · {{2}} = mañana · {{3}} = 10:30 · {{4}} = Clínica Sonríe · {{5}} = Dra. Vidal

## atlas_reserva_recibida_v1

- Uso en Atlas: `reserva_recibida`
- Categoría: UTILITY
- Idioma: Español (es)
- Cuerpo:

> Hola {{1}}, tu hora en {{2}} quedó reservada para el {{3}} con {{4}}. Para verla o cancelarla entra a {{5}} desde tu celular. Antes de la cita te pedimos confirmarla.

- Ejemplo de variables: {{1}} = Camila · {{2}} = Clínica Sonríe · {{3}} = 08/10 a las 10:30 · {{4}} = Dra. Vidal · {{5}} = https://atlascrm.geimser.cl/reservar/cita/ejemplo

## atlas_vacuna_mascota_v1

- Uso en Atlas: `vacuna`
- Categoría: UTILITY
- Idioma: Español (es)
- Cuerpo:

> Hola {{1}}, la vacuna de {{2}} {{3}} el {{4}}. ¿Agendamos una hora en {{5}}? Responde por acá y te damos la primera disponible.

- Ejemplo de variables: {{1}} = Camila · {{2}} = Luna · {{3}} = vence · {{4}} = 15/10 · {{5}} = Veterinaria Patitas

## atlas_control_pendiente_v1

- Uso en Atlas: `control`
- Categoría: UTILITY
- Idioma: Español (es)
- Cuerpo:

> Hola {{1}}, en {{2}} notamos que hace más de {{3}} meses no vienes a control. ¿Agendamos una hora? Responde por acá y coordinamos.

- Ejemplo de variables: {{1}} = Camila · {{2}} = Clínica Sonríe · {{3}} = 6

## atlas_mantencion_corte_v1

- Uso en Atlas: `mantencion`
- Categoría: MARKETING
- Idioma: Español (es)
- Cuerpo:

> Hola {{1}}, ya van {{2}} semanas desde tu último corte en {{3}}. ¿Te reservamos hora para la mantención? Responde por acá.

- Ejemplo de variables: {{1}} = Nico · {{2}} = 5 · {{3}} = Barbería El Filo

## atlas_presupuesto_seguimiento_v1

- Uso en Atlas: `presupuesto`
- Categoría: UTILITY
- Idioma: Español (es)
- Cuerpo:

> Hola {{1}}, te escribimos de {{2}} por el presupuesto «{{3}}». ¿Te quedó alguna duda o quieres que agendemos? Estamos por acá.

- Ejemplo de variables: {{1}} = Camila · {{2}} = Clínica Sonríe · {{3}} = Tratamiento de conducto
