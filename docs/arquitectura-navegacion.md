# Arquitectura de espacios de trabajo — Atlas 2.0

Actualizado: 25 de septiembre de 2026. Describe la implementación local y sus criterios de verificación;
no certifica un despliegue ni una prueba con cuentas de producción.

## Modelo funcional

Administrar la plataforma, supervisar un equipo y atender a un cliente son responsabilidades
distintas. Un administrador no es un ejecutivo con más permisos. Atlas conserva los tres roles
existentes (`admin`, `supervisor`, `agente`), con experiencias y acciones diferenciadas.
Calidad y análisis no se presentan como roles nuevos: siguen siendo capacidades de los perfiles
existentes. No se agrega un selector para asumir otro rol.

| Perfil | Espacio diario | Propósito | Atención al cliente |
| --- | --- | --- | --- |
| Administrador | Control | Visibilidad operativa global, excepciones, datos y configuración | No recibe chats ni usa el editor de respuesta |
| Supervisor | Supervisión | Colas y carga de sus equipos, asignación, revisión y resultados | Consulta autorizada de historial, sin responder como ejecutivo |
| Agente | Atención | Interacciones asignadas, llamadas, registros propios y seguimientos | Opera dentro de su asignación y alcance |

Operar y configurar son espacios distintos, como en los CRM grandes (Setup de Salesforce,
engranaje de HubSpot, Admin Center de Zendesk). La operación diaria no mezcla destinos de
configuración; la configuración se abre con **⚙ Configuración** al pie del menú, siempre visible
para quien tiene algo que configurar, y se vuelve con **← Volver a la operación**. El buscador
encuentra los destinos de los dos espacios. (Entre el 04-09 y el 25-09-2026 fueron un único
árbol; se volvió a separar porque la configuración diluía la operación.)
La IA se controla a nivel general desde el espacio operativo autorizado: no es un interruptor
por ejecutivo ni una función de cada conversación.

### Política de atención e IA

- Con automatización habilitada, la IA atiende hasta la derivación humana. Un ejecutivo no
  puede pausar, reactivar ni tomar una conversación que sigue en atención automática.
- El control general corresponde a administración o supervisión, con confirmación y auditoría.
  No depende de los filtros visibles del monitor. Un supervisor no puede cambiar campañas
  compartidas con agentes de equipos fuera de su alcance.
- Una pausa general explícita permite atención manual al ejecutivo asignado. Reactivar la IA
  no recupera conversaciones ya derivadas ni reproduce automáticamente mensajes atrasados.
- Una configuración ausente o un error al verificar el control no autoriza tomar un chat
  automático. Los estados humanos previos se conservan; no se reescribe el historial.
- El motor comprueba control y propiedad después de generar y nuevamente antes de enviar.
  El interruptor no puede retirar un mensaje que ya fue despachado al proveedor.

## Navegación por tarea

La fuente de verdad es `src/lib/nav.config.ts`: inventario compartido de destinos más una
estructura explícita de secciones por perfil y por espacio (`console` = operación, `admin` =
configuración). Sidebar, drawer móvil y búsqueda usan esa fuente. Los ítems se filtran además
por módulos contratados y edición (Center, Dental, Vet).

### Administrador — Control

```text
Operación                          ⚙ Configuración
  Resumen                            Contact center
  Operación en vivo                    Campañas · Colas y enrutamiento · Flujos de gestión
    Operación · Correo                 Estados de agente · Cargas y listas
  Gestión                            Clínica
    Ventas · Registros                 Procedimientos y precios · Materiales e insumos
    Validación de ventas               Correo de la clínica
  Análisis y calidad                 Plataforma
    Reportes                           Empresas · Usuarios y equipos
    Grabaciones y calidad              Telefonía · diagnóstico · Integraciones
```

### Supervisor — Supervisión

```text
Operación                          ⚙ Configuración
  Resumen                            Mi equipo
  Operación en vivo                    Usuarios y skills
    Operación · Mi equipo · Correo
  Gestión
    Campañas · Ventas · Registros
    Validación de ventas
  Análisis y calidad
    Historial · Reportes · Grabaciones y calidad
```

Historial reutiliza `/dashboard/conversaciones` para consulta autorizada, sin convertir al
supervisor en participante. Campañas (`/dashboard/campanas`) es operativa: elige la campaña con
la que se trabaja. Lo que el supervisor configura es a su equipo (campañas que opera cada
ejecutivo, contraseña y acceso), en `/dashboard/team/usuarios`.

### Agente — Atención

```text
Mi jornada
Mi atención
Mis registros
Mi agenda
```

El agente no tiene espacio de configuración. Mi atención abre `/dashboard/conversaciones`.

En Dental y Vet la operación suma Agenda, Pacientes, Caja, Recordatorios, Campañas y
Conversaciones de la clínica en los mismos grupos.

### Personalización por persona

Cada persona ajusta su menú dentro de lo que su perfil permite, y se guarda en su cuenta
(`user_view_preferences`, clave `sidebar`), así que la sigue entre equipos:

- **Favoritos:** la ★ al pasar el mouse fija un destino arriba de la operación, incluso uno de
  configuración. En «Personalizar menú» se reordenan.
- **Ocultar:** en «Personalizar menú» el ojo saca un destino que no usa. La página abierta
  nunca desaparece y el buscador sigue encontrando lo oculto.
- **Secciones plegadas** y **Restaurar menú** para volver al menú del perfil.

La personalización no concede nada: solo reordena y esconde destinos ya autorizados.

## Inicio por rol

- **Control:** resumen global, acceso principal a Operación, entradas a configuración y resultados.
  Campañas sin flujo/ejecutivos son señales de configuración, no una afirmación de que WhatsApp
  está caído: una cola ACD puede tener sus propios miembros.
- **Supervisión:** compromisos vencidos y del día, trabajo sin asignar, base y ejecutivos de los
  equipos supervisados; rendimiento etiquetado como acumulado disponible, no dato de hoy.
- **Atención:** jornada personal, interacciones asignadas, próximo seguimiento y panel de
  agenda/gestiones existente. Solo esta experiencia utiliza el panel de trabajo del ejecutivo.

Control y Supervisión indican alcance, instante de consulta y que son una fotografía al cargar.
Los errores se muestran como **Sin datos**, no como cero ni estado saludable. El día operativo
usa `America/Santiago`, mediante las mismas utilidades de los reportes. El resumen global no
aplica silenciosamente el filtro persistido de campaña; declara su alcance.

## Interacción y accesibilidad

1. Resumen → lista/cola → detalle explícito. Encontrar un registro no lo abre automáticamente.
2. Menú y búsqueda ofrecen los mismos destinos por rol, en el mismo orden lógico.
3. La personalización del menú se guarda en la cuenta, y los registros recientes por usuario y
   rol; la caché local también va por persona y no se reutiliza la de otra sesión.
4. El buscador encuentra secciones por nombre/descripción y registros por la RPC existente.
   Si falla la consulta, lo comunica y conserva los accesos a secciones.
5. El menú móvil usa el mismo árbol, cierra con Escape, contiene el foco y lo devuelve al botón
   de apertura. El rail tiene nombres accesibles y etiqueta con foco de teclado.
6. El contexto visible identifica el espacio activo. No se muestra un punto verde de presencia
   derivado solo de tener una sesión: disponibilidad operativa y sesión no son lo mismo.
7. Las agrupaciones responden a tareas; no hay un máximo artificial de seis ítems que oculte
   destinos de supervisión. La profundidad se mantiene en sección → destino.

## Autorización y límites

`src/lib/workspace-permissions.ts` define capacidades compartidas. La navegación no es una
barrera de seguridad: páginas, acciones de servidor y acceso a datos deben comprobar rol,
asignación y alcance independientemente de que exista o no un enlace.

La aceptación debe verificar que consultar una cola no marca mensajes como leídos, no asigna
interacciones al administrador, no consume cupos y no permite enviar mensajes por enlace directo
o acción de servidor. Las políticas de base de datos y los endpoints requieren sus verificaciones
propias; las pruebas del menú no sustituyen esas pruebas.

No se afirma certificación WCAG completa, equivalencia funcional con un proveedor, ni salud de
Meta/telefonía basándose en estas pantallas. Los cambios del ciclo comercial WhatsApp
(reintentos, 24/48 h, estacionamiento y recuperación Voice) son un alcance distinto al rediseño
por roles y no deben darse por implementados por cambiar la navegación.

## Verificación

`tests/workspace-navigation.test.ts` verifica configuración real: orden/etiquetas por perfil,
ausencia de destinos no autorizados, menú/buscador consistentes, rutas existentes y estado activo.
`tests/operations-page-render.test.ts` ejecuta el render de la página real con Supabase simulado
y componentes UI semánticos: comprueba admin/supervisor, exclusión de contenido de clientes,
control general de IA separado de filtros, errores frente a resultados vacíos y rechazo de agentes.
Complementar con typecheck, lint y pruebas autenticadas de los tres perfiles, desktop y móvil.
`bash scripts/test-live-operation-scope.sh` ejecuta la migración de RPC de monitoreo en un
PostgreSQL local efímero: admin global, supervisor por campañas/equipos, sesión válida, exclusión
de actores no autorizados y conservación de métricas. `tests/live-operation-scope.test.ts`
compara cálculos y contratos de retorno contra las definiciones anteriores.
Tras desplegar, verificar exclusivamente `atlascrm.geimser.cl` en Vercel `atlas2-0`, conforme a
`AGENTS.md`; no declarar producción verificada solo por el build.

Las migraciones de permisos y alcance son parte inseparable del cambio: ocultar menús no
sustituye aplicarlas. `scripts/test-workspace-rls.sh` prueba los permisos y el control general
en PostgreSQL aislado, sin conectarse a producción. `tests/whatsapp-automation-runtime.test.ts`
simula el proveedor; nunca envía mensajes reales. Estas comprobaciones no sustituyen la
validación autenticada tras publicar.
