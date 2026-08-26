-- Base de conocimiento comercial explícita y versionada para el bot inbound.
-- Se separa del prompt conductual: cambiar cómo conversa no debe alterar los
-- hechos aprobados del producto, y viceversa.

alter table public.whatsapp_ai_configs
  add column knowledge_base text not null default '',
  add column knowledge_source text,
  add column knowledge_version integer not null default 1
    check (knowledge_version > 0);

update public.whatsapp_ai_configs config
set knowledge_base = $knowledge$
Ficha aprobada del servicio Secretaría Virtual / Asistente Ejecutiva en Línea para administradores de condominios:

- Es un servicio especializado de apoyo para administradores de edificios y condominios.
- Atiende comunicaciones de residentes, conserjes y proveedores cuando el administrador está en terreno, en reunión, en inspección o no puede responder.
- Registra los datos del contacto, condominio o edificio, motivo y prioridad; luego avisa o deriva según los protocolos y contactos de respaldo configurados.
- La gestión queda registrada en CRM para conservar trazabilidad.
- Puede funcionar como respaldo y complemento de una secretaria o asistente existente; no se presenta como reemplazo obligatorio.
- Para responder en nombre de la empresa se realiza una inducción, personalización y configuración inicial.
- Ante emergencias, registra y aplica la ruta de derivación y los contactos de respaldo definidos. No toma decisiones por el cliente ni divulga información financiera.
- La pauta comercial vigente contempla un plan de entrada de 1 UF y alternativas de cobertura ampliada. Un especialista debe confirmar alcance, condiciones y vigencia antes de cerrar o emitir una cotización formal.

Para dimensionar la necesidad, pregunta de forma gradual cuántos edificios o condominios administra y cómo gestiona actualmente sus líneas o canales de contacto.

No están confirmados en esta ficha: horarios exactos, cobertura geográfica, permanencia contractual, descuentos, SLA, cantidad incluida de llamadas o mensajes, integración específica de WhatsApp ni capacidades personalizadas. Si preguntan por cualquiera de esos puntos, informa brevemente que un especialista lo confirmará, devuelve handoff=true y explica el motivo en handoff_reason.

También deriva a un especialista humano si solicitan una cotización formal, piden hablar con una persona, expresan molestia o la respuesta no está explícitamente respaldada por esta ficha. Nunca completes vacíos con suposiciones.
$knowledge$,
    system_prompt = replace(
      config.system_prompt,
      'responder solo con información confirmada en la conversación',
      'responder solo con información confirmada en la conversación o en la ficha de producto aprobada'
    ),
    knowledge_source = 'Script y Manejo de Objeciones Asistente Ejecutiva en Linea_Condominios_V1.docx; ficha CRM Secretaria Virtual - Inbound',
    knowledge_version = 1,
    updated_at = now()
from public.campaigns campaign
where campaign.id = config.campaign_id
  and (
    campaign.id = 'f59045b2-cb77-49dd-ae4a-a105cdd55121'::uuid
    or campaign.name = 'Meta Ads · WhatsApp · Secretaria Virtual Geimser'
  );

comment on column public.whatsapp_ai_configs.knowledge_base is
  'Hechos aprobados del producto disponibles para responder; toda ausencia debe derivarse, no inferirse.';
