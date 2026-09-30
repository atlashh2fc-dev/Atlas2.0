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
| Verificación de acceso (proveedor de tecnología) | **Siguiente paso**: ya habilitada |
| Revisión de la app y publicación | Pendiente |

Mientras la app no esté publicada, Meta solo entrega webhooks de prueba.

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

Guion del video (2 a 3 minutos, en la app en producción):
1. Iniciar sesión en Atlas como administrador de una empresa.
2. Ir a Integraciones › WhatsApp y presionar «Conectar mi WhatsApp Business».
3. Mostrar la ventana de Meta: elegir el portfolio y la cuenta, conectar el WhatsApp Business existente y escanear el código con el teléfono.
4. Volver a Atlas: aparece el número conectado y «También sigue en la app del teléfono».
5. Desde el teléfono, escribirle a un prospecto; en Atlas › Ventas › Por contactar aparece anotado solo.
6. Contestar desde el teléfono del prospecto: en Por contactar sube como «Respondió por WhatsApp».
7. Abrir Conversaciones › WhatsApp y responder un mensaje desde Atlas.

## Después de la aprobación

- Crear una configuración de registro insertado con **token sin vencimiento**, reemplazar `ATLAS_META_ES_CONFIG_ID` y volver a conectar el número de Altius. Integraciones avisa 10 días antes de que venza el token de 60 días.
- Conectar el número de Altius (+56 9 2829 9973) con el botón de Atlas, estando en la empresa Altius.

## Migración de Geimser (antes del 28-11-2026)

La app antigua «Atlas CRM Omnicanal» (2064941000816879) está en el portfolio de Geimser y de ella sale `WHATSAPP_ACCESS_TOKEN`. Meta la restringe el 28-11 si no pasa la verificación de acceso. En vez de verificarla a nombre de Geimser:

1. Con la app de Altius publicada, entrar a Atlas como Geimser y conectar su número (+56 9 7415 8774) con «Conectar mi WhatsApp Business». El canal queda con su propio token en la bóveda, y el del entorno deja de usarse.
2. Confirmar que entran y salen mensajes (Conversaciones › WhatsApp).
3. Quitar la suscripción del webhook en la app antigua y, cuando nada dependa de ella, quitar `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_META_APP_SECRET` y `WHATSAPP_WEBHOOK_VERIFY_TOKEN` de Vercel.
