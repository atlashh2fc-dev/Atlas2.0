# Altius como proveedor de tecnología en Meta (WhatsApp)

Atlas es producto de **Altius Ignite SpA** (RUT 78.507.701-6). Geimser lo usa como cliente. Por eso la app de Meta, la verificación y el rol de proveedor de tecnología están a nombre de Altius.

## Estado (30-09-2026)

| Paso | Estado |
|---|---|
| Portfolio «Altius Ignite» (2665820040521759) con razón social, RUT, dirección y web | Listo |
| App «Atlas CRM» (1623651549404343), caso de uso WhatsApp, marcada como proveedor de tecnología | Listo (irreversible) |
| Configuración de registro insertado (2553450825165106, token 60 días) | Lista; en Vercel como `ATLAS_META_ES_CONFIG_ID` |
| Dominio del SDK de JavaScript: `https://atlascrm.geimser.cl/` | Listo |
| Privacidad, términos, eliminación de datos, categoría | Listo (altiusignite.com/privacidad, /terminos, /privacidad#derechos) |
| Ícono 1024×1024 transparente | Lo sube el usuario (`atlas-crm-icono-1024-transparente.png`) |
| Webhook `https://atlascrm.geimser.cl/api/integrations/meta/whatsapp/webhook` | Verificado; campos `messages`, `smb_message_echoes`, `history`, `smb_app_state_sync` |
| `ATLAS_META_APP_SECRET`, `ATLAS_META_WEBHOOK_VERIFY_TOKEN` en Vercel | Listo |
| Verificación del negocio de Altius | Lista (aprobada el 30-09) |
| Verificación de acceso (proveedor de tecnología) | **En revisión** (enviada el 30-09 como Plataforma SaaS, un solo portfolio; Meta responde en ~5 días, plazo 29-11) |
| Publicación de la app (modo Live, acceso estándar) | Publicada el 30-09 |
| Revisión de la app (acceso avanzado) | Pendiente: requiere el número de Altius conectado para grabar el video |

Publicada no significa listada en ningún lado: solo se usa desde el botón de Atlas y, con acceso estándar, solo con activos del portfolio de Altius o de personas con rol en la app.

## Verificación de acceso: respuestas propuestas

Se envía desde App › Revisar › Verificación › Verificación de acceso. Antes de enviarla, el usuario revisa las respuestas.

- **¿Qué hace tu negocio?** Altius Ignite SpA desarrolla y opera Atlas, un CRM omnicanal (llamadas, WhatsApp, correo y web) para pymes, contact centers y clínicas en Chile. Cada empresa cliente tiene su propio espacio aislado en Atlas.
- **¿Por qué necesitas acceder a activos de otros negocios?** Cada cliente conecta su propio número de WhatsApp Business desde Atlas con el registro insertado de Meta. En muchos casos lo hace en coexistencia, sin dejar de usar la app en su teléfono. Atlas envía y recibe los mensajes de ese número a nombre del cliente y los muestra en su ficha, junto a sus llamadas y correos.
- **¿Qué datos usas y para qué?** Mensajes, estados de entrega y datos de contacto de las conversaciones del número del cliente. Se usan solo para mostrarle esas conversaciones y para registrar el seguimiento comercial (a quién se le escribió y quién respondió). No se venden ni se usan para publicidad. El token de cada cliente se guarda cifrado.
- **Clientes actuales:** Altius Ignite (su propio número) y Geimser (contact center). Los números de Geimser migran a esta app antes del 28-11-2026.
- **Sitio y políticas:** https://www.altiusignite.com · https://www.altiusignite.com/privacidad

## Revisión de la app

Permisos con acceso avanzado:

1. **`whatsapp_business_management`**: leer el WABA y el número que el cliente conecta, suscribir la app a sus webhooks y pedir la sincronización de contactos e historial de la app del teléfono (coexistencia).
2. **`whatsapp_business_messaging`**: enviar y recibir mensajes del número del cliente desde Atlas.

**Hasta que Meta apruebe esta revisión, el registro insertado responde «Altius Ignite no puede registrar clientes en este momento»**, también para el número de Altius (probado el 30-09). No se puede usar el botón de Atlas para grabar el video.

Requisitos previos: cada permiso necesita al menos una llamada exitosa a la API (en Casos de uso › Permisos y funciones, la columna «Llamadas a la API» estaba en 0 el 30-09). El contador puede tardar hasta 24 h en subir. Las llamadas se hacen con el número de prueba que Meta da en Casos de uso › Conectar en WhatsApp › Paso 1. Pruébalo.

Videos que pide Meta (documentación «Convertirse en proveedor de tecnología», 20-08-2026):
1. Un mensaje enviado desde la app y recibido en WhatsApp. Vale grabar la pantalla de «Pruébalo» (o el cURL) enviando la plantilla `hello_world` desde el número de prueba a un teléfono agregado como destinatario, con el teléfono recibiéndolo en cámara o en WhatsApp Web.
2. La creación de una plantilla de mensaje. Vale grabarla en el Administrador de WhatsApp.

Cuando el número de Altius ya esté conectado, se puede repetir la demo completa desde Atlas (Integraciones › WhatsApp › Conectar, Por contactar, Conversaciones) para futuras revisiones.

## Después de la aprobación

- Crear una configuración de registro insertado con **token sin vencimiento**, reemplazar `ATLAS_META_ES_CONFIG_ID` y volver a conectar el número de Altius. Integraciones avisa 10 días antes de que venza el token de 60 días.
- Conectar el número de Altius (+56 9 2829 9973) con el botón de Atlas, estando en la empresa Altius.

## Migración de Geimser (antes del 28-11-2026)

La app antigua «Atlas CRM Omnicanal» (2064941000816879) está en el portfolio de Geimser y de ella sale `WHATSAPP_ACCESS_TOKEN`. Meta la restringe el 28-11 si no pasa la verificación de acceso. En vez de verificarla a nombre de Geimser:

1. Con la app de Altius publicada, entrar a Atlas como Geimser y conectar su número (+56 9 7415 8774) con «Conectar mi WhatsApp Business». El canal queda con su propio token en la bóveda, y el del entorno deja de usarse.
2. Confirmar que entran y salen mensajes (Conversaciones › WhatsApp).
3. Quitar la suscripción del webhook en la app antigua y, cuando nada dependa de ella, quitar `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_META_APP_SECRET` y `WHATSAPP_WEBHOOK_VERIFY_TOKEN` de Vercel.
