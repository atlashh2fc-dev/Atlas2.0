# Atlas Barber: plan de la edición para barberías

Fecha: 2026-09-30. Estado: fases 1 a 4 construidas; ver "Cómo quedó" al final.

## Cómo lo veo

La base de negocio se reutiliza casi entera: la edición Barber es una cuarta
`edicion` junto a Center, Dental y Vet, y hereda agenda, caja, pagos Webpay,
recordatorios, campañas, conversaciones y reportes que ya usan Dental y Vet.

El punto delicado es el 3D. Una cabeza 3D fotorrealista con pelo reconstruida
desde una sola foto no está resuelta a nivel producto en 2026: los modelos
image-to-3D dejan el pelo plástico y el cliente no se reconoce, que es justo lo
contrario de lo que buscamos (alinear expectativas). Lo que sí funciona hoy y
sorprende en el sillón:

1. **Edición generativa fotorrealista** sobre la foto real del cliente, que
   conserva identidad, piel y luz, y genera el corte propuesto en varias vistas
   (frontal, tres cuartos, perfil, nuca). Se muestra como un visor giratorio.
2. **Mapa de corte 3D procedural** (como el odontograma): una cabeza
   paramétrica con zonas (coronilla, laterales, nuca, flequillo, barba, patillas)
   donde queda la ficha técnica del corte: número de guarda, milímetros, técnica
   (fade bajo/medio/alto, taper, tijera, texturizado), degradado de barba.
   Es lo que el barbero sigue y lo que queda en la historia del cliente.
3. **IA que razona**: analiza la foto (forma de rostro, tipo y densidad de pelo,
   línea de nacimiento, remolinos, barba, estilo actual) y propone 3 a 5 cortes
   con el porqué, ajustados a facciones y a lo que el cliente pide.

La malla 3D "real" queda como fase posterior detrás de un flag, generada desde
las vistas aprobadas. Coherente con el 3D actual: nada de `.glb` en `public/`,
todo procedural con three, fiber y drei.

## El módulo: "Estudio de Look"

Vive dentro de la ficha del cliente (`/dashboard/pacientes/[id]`), donde hoy
Dental muestra el odontograma y Vet la mascota 3D. No hay pantalla aparte.

Flujo en el sillón (celular o tablet del barbero):

1. **Captura guiada**: cámara del navegador con óvalo de encuadre; frontal
   obligatoria, perfiles opcionales. Consentimiento del cliente en la primera
   captura (foto de rostro = dato sensible).
2. **Análisis** (Claude, visión): JSON estructurado con rostro, pelo, barba y
   estilo actual, más recomendaciones con razones. El barbero puede escribir
   lo que pide el cliente ("quiere algo tipo mid fade con textura arriba").
3. **Simulación**: por cada propuesta se generan 4 vistas fotorrealistas.
   Visor giratorio, comparador antes/después, el cliente elige y aprueba.
4. **Mapa de corte**: la IA rellena la cabeza 3D con guardas y técnica a
   partir del look aprobado; el barbero corrige. Se guarda como registro
   (append-only, igual que `odontograma_registros`).
5. **Después del corte**: foto "después", comparación con la expectativa,
   look guardado en la historia, recordatorio de mantención (retoque a las
   3 a 4 semanas) por WhatsApp o correo con la foto del look.

## Proveedores de IA

| Tarea | Proveedor | Motivo |
|---|---|---|
| Visión y razonamiento (análisis, recomendaciones, mapa de corte) | Claude `claude-opus-5-5` por el SDK oficial `@anthropic-ai/sdk`, salida estructurada | Calidad de razonamiento sobre facciones; ya somos Claude Partner Network |
| Edición fotorrealista de la foto | Gemini 2.5 Flash Image (Google AI API) como opción por defecto; FLUX Kontext vía fal.ai como alternativa | Anthropic no genera imágenes; Gemini es el que mejor conserva identidad en edición |
| Malla 3D (fase 5, flag) | Hunyuan3D 2.x o Trellis vía fal.ai | Image-to-3D en segundos, GLB al visor existente |

Costo estimado por sesión de look (a confirmar con las tarifas del día):
análisis ≈ US$0,05; 3 propuestas × 4 vistas = 12 imágenes ≈ US$0,50.
Variables nuevas: `ANTHROPIC_API_KEY`, `GOOGLE_AI_API_KEY`, `BARBER_3D_MALLA=false`.

## Qué cambia en el código

### Edición `barber` (migración + TS + CSS)

- `organizations.edicion` CHECK amplía a `'barber'`.
- `aplicar_plantilla_de_edicion`: módulos `leads, ventas_b2c, whatsapp, correo`;
  etapas de venta en vocabulario barber; arancel de servicios (corte, barba,
  corte + barba, fade, diseño, color, cejas, tratamiento capilar, niño) con
  `duracion_min`; insumos básicos.
- `src/lib/ediciones.ts`: `barber` con sufijo "Barber", vocabulario
  Cliente / Barbero / Servicio, `monto: "unico"`.
- `src/app/globals.css`: bloque `[data-edicion="barber"]` (propuesta: carbón
  con acento cobre/latón; se ajusta contigo).
- `src/lib/nav.config.ts`: los ítems de clínica (agenda, caja, recordatorios,
  conversaciones, campañas, reportes, correo) suman `barber` en `ediciones`;
  etiquetas "Hoy", "Agenda", "Clientes", "Caja", "Recordatorios".
- Refactor obligado: las ramas `edicion === "vet" ? "vet" : "dental"` en
  pacientes, ficha, caja, aranceles y `reportes-clinica` pasan a un helper
  `perfilDeEdicion(edicion)`; hoy una edición nueva caería en Dental.
- `crear_organizacion` acepta `barber`; empresa `demo-barber` sembrada.
- Tests: `ediciones`, `workspace-navigation`, `modulos-por-empresa`.

### Estudio de Look (tablas, bucket, componentes)

- Tablas: `looks` (sesión: cliente, fotos originales, análisis JSON, pedido
  del cliente, estado), `look_propuestas` (propuesta, vistas generadas,
  aprobada), `mapa_corte_registros` (zona, guarda, mm, técnica, nota,
  fecha; append-only), `looks_consentimientos`.
- Bucket privado `looks` con rutas `<empresa>/<cliente>/<look>/...`,
  URLs firmadas, retención configurable (propuesta: 90 días para fotos
  crudas, el look aprobado se conserva).
- RLS con el patrón de clínica: restrictiva por organización + admin/supervisor
  + dueño de plataforma. El barbero (rol ejecutivo) puede leer y crear en su
  empresa.
- Componentes: `src/components/estudio-look/` (captura, análisis, visor
  giratorio, comparador, aprobación) y `src/components/mapa-corte/`
  (`cabeza-3d.tsx`, `geometria.ts`, `zonas.ts`) con `next/dynamic` y
  `ssr:false` como el odontograma.
- Lógica pura en `src/lib/look.ts` y `src/lib/mapa-corte.ts` (zonas,
  guardas, técnicas, reglas rostro → cortes) con tests.
- Server actions en `src/app/actions/looks.ts`; llamadas a IA en
  `src/lib/ia/vision-look.ts` y `src/lib/ia/imagen-look.ts`, con tope de
  imágenes por look y por día por empresa.
- Recordatorios: plantillas barber en `src/lib/mensajes/plantillas.ts`
  (recordatorio de cita, mantención, look aprobado adjunto).

## Fases (en este orden)

1. **Edición Barber base**: migración, TS, CSS, nav, refactor de ramas,
   `demo-barber` navegable con agenda, caja, recordatorios y reportes.
2. **Estudio de Look v1**: captura guiada, análisis con Claude, mapa de corte
   3D procedural, guardado en la ficha e historia.
3. **Simulación fotorrealista**: propuestas multivista, visor giratorio,
   comparador, aprobación del cliente, envío del look por WhatsApp/correo.
4. **Después del corte**: foto final, comparación con expectativa,
   recordatorio de mantención, métricas en reportes (looks por barbero,
   tasa de aprobación, recompra).
5. **Malla 3D real** detrás de `BARBER_3D_MALLA`.

Cada fase se sube a `main` al terminar, con tests y checklist de Laws of UX.

## Decisiones abiertas (con mi propuesta si no dices nada)

- Proveedor de imagen: Gemini 2.5 Flash Image.
- Color de la edición: carbón + cobre.
- Nombre del módulo: "Estudio de Look".
- Retención de fotos crudas: 90 días.
- Quién puede usar el Estudio: admin, supervisor y ejecutivo (barbero).


## Cómo quedó (30-09-2026)

La cabeza 3D hecha por código se descartó: se veía como maniquí y no está al
nivel. El 3D ahora es del cliente real:

1. Al guardar la foto parten solos, en paralelo, el análisis (Claude) y el 3D
   del cliente tal como llegó (Rodin v2.5 en fal, desde su foto de frente y
   perfil).
2. "Probar este corte" simula el corte sobre su foto en 4 ángulos (Nano Banana
   Pro en fal) y con esas vistas arma el 3D del cliente con ese corte.
3. Se compara "hoy" contra "con este corte" en 3D, se aprueba, y el barbero
   deja la ficha técnica por zona (guarda, milímetros, técnica).
4. El cliente recibe por WhatsApp un enlace con su look en 3D y en fotos.

Proveedores: una sola cuenta de fal.ai (`FAL_KEY`) para fotos y 3D, y
Anthropic (`ANTHROPIC_API_KEY`) para el análisis. Ver
`docs/atlas-barber.env.example`. Costo aproximado por cliente que prueba un
corte completo: 4 fotos a unos US$0,08 más un 3D de Rodin (precio en fal, a
confirmar), más el 3D inicial del cliente.

Descartado por licencia: FaceLift (pesos bajo licencia de investigación de
Adobe, no comercial), que es lo que usa ShapeUp.
