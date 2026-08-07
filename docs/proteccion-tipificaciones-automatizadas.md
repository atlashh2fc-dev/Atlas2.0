# Protección contra tipificaciones automatizadas

Origen: se detectó a un ejecutivo usando una extensión de Chrome propia para
cerrar tipificaciones con un botón. Este documento fija qué se puede defender,
qué no, y qué quedó implementado.

## La premisa que ordena todo

**El cliente no es confiable y no puede volverse confiable.** El navegador corre
en la máquina del ejecutivo: puede inspeccionar el CRM, modificar el DOM,
disparar clics sintéticos y leer cualquier secreto que le enviemos.

Peor aún: **no necesita la extensión**. Las server actions de Next son endpoints
HTTP normales. Con el `fetch` que ya autentica su sesión puede cerrar gestiones
desde la consola sin instalar nada.

Por eso se descartaron explícitamente estas "defensas":

| Idea | Por qué no sirve |
| --- | --- |
| Detectar `event.isTrusted` en el cliente | Se falsifica: el mismo script que automatiza decide qué enviar. |
| Bloquear devtools / ofuscar el bundle | Molesta al honesto, no al que ya escribió una extensión. |
| CSP para bloquear la extensión | Los content scripts viven en un mundo aislado que la CSP de la página no gobierna. |
| Detección de bots por comportamiento del mouse | Ruido, falsos positivos y se emula con dos líneas. |

Todo lo que se envíe desde el navegador sirve, como mucho, para *detectar al
descuidado*. Nunca para *impedir al decidido*.

## Las tres capas que sí funcionan

### 1. Endpoint: impedir la instalación (la única que corta el problema de raíz)

Aplica solo si los equipos son corporativos y están gestionados. Con Chrome
Enterprise / Google Workspace:

- `ExtensionInstallBlocklist: ["*"]` — prohíbe toda extensión.
- `ExtensionInstallAllowlist: [<ids aprobados>]` — habilita las que la empresa
  necesita.
- `DeveloperToolsAvailability: 2` — desactiva devtools en el perfil gestionado.
  Ojo: **esto no es una defensa técnica** (basta otro navegador o el perfil
  personal), es una barrera de fricción y una señal de política.
- Forzar el uso del CRM en un perfil de Chrome gestionado y con el resto de los
  navegadores bloqueados por política del sistema operativo.

Sin gestión del endpoint esta capa no existe y todo el peso cae en la capa 2.

### 2. Servidor: invariantes que hagan la trampa inútil

La idea no es distinguir humano de script —es imposible— sino **atar la
tipificación a hechos que el ejecutivo no controla**: los eventos que el motor
de discado escribe desde Asterisk.

Estado actual de `save_call_management` (validaciones ya existentes):

- autenticación y rol;
- la tipificación existe en el catálogo del flujo;
- la llamada es del ejecutivo y no está cerrada;
- interrupción legal cumplida;
- no se puede cerrar con la llamada aún en curso.

Lo que **todavía no** valida, y es lo que habilita el abuso:

- **Nada exige que la llamada haya ocurrido.** Se acepta `status = 'connected'`
  aunque la central nunca haya registrado una conexión para ese lead.
- **No hay duración mínima de gestión** ni límite de cierres por minuto.

Reglas propuestas, en orden de valor y de riesgo operativo:

1. **Contacto efectivo exige respaldo telefónico.** Si `status = 'connected'` (o
   el resultado es venta/interesado), debe existir un `dial_attempt` en
   `answered`/`bridged`/`completed` asociado al lead y al ejecutivo dentro de la
   ventana de la gestión. Es la regla más potente: sin ella, inflar
   contactabilidad o ventas es trivial; con ella, se vuelve imposible desde el
   navegador.
2. **Duración mínima de gestión** para tipificaciones de contacto (no para
   no-contacto, que legítimamente son rápidas).
3. **Cadencia máxima de cierres por ejecutivo** (por ejemplo, N por minuto),
   devolviendo un error claro en vez de un bloqueo silencioso.

**Estas reglas no están activadas todavía**, a propósito: primero hay que
calibrar los umbrales con la operación real (ver capa 3) para no frenar trabajo
legítimo. Un ejecutivo que recibe diez buzones de voz seguidos los tipifica
rápido y tiene razón.

### 3. Servidor: detección y evidencia (implementado)

`get_management_integrity_report(from, to, campaign, fast_close_seconds,
burst_seconds)` y la pestaña **Reportes → Integridad** (solo admin y
supervisión).

Usa exclusivamente señales del servidor, no falsificables desde el navegador:

| Señal | Qué mide | Cómo leerla |
| --- | --- | --- |
| **Contacto sin llamada** | Gestión cerrada como contactada sin ningún evento de conexión del discador | El indicio más fuerte. Un contacto efectivo sin llamada no tiene explicación inocente. |
| **Cierre instantáneo** | Gestión cerrada en menos de `fast_close_seconds` (10 s por defecto) | Por sí solo no prueba nada: hay tipificaciones legítimamente rápidas. Pesa el patrón sostenido, no el caso aislado. |
| **Ráfaga** | Cierres consecutivos separados por menos de `burst_seconds` (5 s) | Un humano no cierra dos gestiones en tres segundos de forma repetida. |

Se acompañan de la **mediana** y el **mínimo** de duración por ejecutivo, que es
lo que permite comparar contra sus pares en vez de contra un umbral inventado.

## Cómo usar el reporte

1. Revisar **contacto sin llamada** primero: es la señal con menor tasa de falso
   positivo.
2. Mirar la **mediana por ejecutivo** contra el resto del equipo. Una mediana muy
   por debajo del grupo, sostenida en el tiempo, dice más que cualquier caso
   puntual.
3. Cruzar con la grabación de las llamadas antes de cualquier conversación
   disciplinaria. **El reporte da indicios, no pruebas.**
4. Después de un par de semanas de datos, usar la distribución observada para
   fijar los umbrales de la capa 2 y recién ahí activarlos.

## Lo que también importa y no es técnico

- Una norma escrita que prohíba automatizar el CRM, comunicada y firmada.
- Que el equipo sepa que existe la medición. El efecto disuasivo de una métrica
  visible suele ser mayor que el del bloqueo.
- Que las metas no premien el volumen de tipificaciones por sobre el resultado:
  mientras cerrar gestiones rápido pague, alguien va a automatizarlo.
