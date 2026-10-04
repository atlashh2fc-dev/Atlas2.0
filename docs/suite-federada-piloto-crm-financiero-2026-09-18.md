# Suite federada: piloto Atlas CRM + Atlas Financiero

Fecha: 18 de septiembre de 2026. Estado: pasos 1 y 2 aplicados en producción; falta configurar dos variables y desplegar.

## 1. Decisión

Altius construye la suite tipo Odoo **federando**, no fusionando. Cada producto conserva su
proyecto Supabase y se apoya en `atlas-crm` como columna vertebral, porque allí ya existen las
cuatro piezas que una suite necesita: `organizations` con `organization_id_by_slug()`,
`crm_entities` como maestro por RUT normalizado, `organization_modules` como tabla de licencias,
e integración v2 con outbox durable como bus de eventos.

Migrar nueve bases productivas a una sería un proyecto de meses sin ingreso nuevo. La propiedad
que hace valiosa a una suite no es "una sola base": es que **el cliente sea el mismo registro en
todos los módulos**. Eso se federa.

## 2. Lo que se midió antes de tocar nada

| Medición | Resultado |
| --- | --- |
| Contrapartes en Financiero | 134 · 106 con RUT · 0 fusionadas |
| Colisiones al normalizar el RUT | Ninguna: 106 RUT, 106 pares `(organización, normalizado)` |
| Guardadas con formato | 105 de 106 difieren de su forma normalizada |
| Reparto por `kind` | 91 proveedores · 38 clientes · 5 ambos |
| Clientes con RUT | 21 |
| **Clientes que existían en `crm_entities`** | **5 de 21**, cada uno con un único lead |
| Organizaciones | Financiero: GEIMSER, CS BPO, Personal LP · Atlas: `geimser`, `altius` |

### El hallazgo que invirtió el diseño

El CRM contenía 56.464 entidades de prospección y **5 clientes que facturan**. Los otros 16 pagan
todos los meses y el maestro no sabía que existían: llegaron por referencia, inbound o la web, no
por una lista de leads.

Por eso el puente corre **Financiero → Atlas** primero. Quien factura es cliente aunque nunca haya
sido lead; un maestro que solo se nutre de la prospección no es un maestro de clientes.

### La llave, verificada contra producción

`normalize_lead_rut('76.475.719-K')` en Atlas y
`upper(regexp_replace(tax_id, '[^0-9kK]', '', 'g'))` en Financiero devuelven ambas `76475719K`.
Misma semántica, escrita por separado en dos bases distintas. El RUT es la llave de la federación.

## 3. Lo aplicado

| Proyecto | Migración | Qué hace |
| --- | --- | --- |
| `atlas-crm` | `20260919002510_el_cliente_que_factura_entra_al_crm` | RPC `registrar_entidad_facturada(rut, nombre, origen, referencia)`. Upsert por RUT normalizado; conserva el `display_name` existente y deja procedencia en `metadata.facturacion`. Solo `service_role`. |
| `GeimserFinanzas` | `20260919002519_puente_de_clientes_con_atlas_crm` | Columna generada `normalized_tax_id`, índice único `(organization_id, normalized_tax_id)`, `crm_entity_id` sin FK (otra base), y `atlas_org_slug` en `organizations`. |
| `atlas-crm` | `20260919003109_bus_de_hechos_por_entidad_de_la_suite` | Tabla `suite_entity_events` y RPC `registrar_evento_de_suite(...)`. Idempotente por `(module, external_id)`; RLS por organización; escritura solo `service_role`. |

Backfill posterior: las 21 contrapartes `customer`/`both` de la organización GEIMSER se resolvieron
contra Atlas y quedaron con su `crm_entity_id`. Resultado: **16 entidades nuevas, 5 existentes
actualizadas**, y en esas 5 el nombre del CRM se conservó frente a la razón social del SII
(`CORP MUNIC EDUC SALUD Y ATENCION` prevaleció sobre `DEPARTAMENTO DE ABASTECIMIENTO`).

### Decisiones deliberadas

- **Se filtra por `kind`.** De las 34 contrapartes que cruzan con Atlas, la mayoría son proveedores
  (Sodimac, Copec, Telefónica) que aparecen por casualidad entre 56 mil prospectos. Sus facturas en
  la ficha del CRM serían ruido.
- **CS BPO y Personal LP quedan sin `atlas_org_slug`.** No tienen equivalente en Atlas. Un slug
  inventado escribiría en la organización equivocada.
- **El slug es la llave entre organizaciones**, no el UUID. Aditivo y reversible; alinear claves
  primarias en una base productiva con decenas de tablas colgando queda para una consolidación
  futura, si alguna vez hace falta.

## 4. Paso 2: la factura llega a la ficha

### Por qué una tabla nueva y no `external_lead_events`

`external_lead_events` exige `campaign_id` y cuelga de un lote de importación: es la tubería por la
que entran prospectos, no un bus entre módulos. Y 16 de los 21 clientes no tienen lead alguno.
Colgar sus facturas de un lead inexistente las haría invisibles justo para quienes más pagan.

Por eso el hecho se ancla en `crm_entities` y la ficha del lead lo alcanza por su `crm_entity_id`.
Cuando un cliente que nunca fue prospecto reciba su primer lead, su historial de facturación ya
está ahí esperándolo.

### El publicador

`Atlas Financiero/src/lib/suite/atlas-crm.ts` + la ruta `/api/suite/atlas`, con cron cada 15
minutos. En cada corrida:

1. Resuelve las contrapartes `customer`/`both` sin `crm_entity_id` contra `registrar_entidad_facturada`
   y guarda el enlace de vuelta. Esto convierte el backfill del paso 1 en sincronización continua.
2. Le pregunta a Atlas qué documentos ya conoce y publica solo la diferencia. Sin columna de estado
   que mantener en Financiero, y exacto tras un borrado en cualquiera de los dos lados.

Solo sincroniza organizaciones con `atlas_org_slug`. Si Atlas está caído, la ruta falla y Financiero
opera igual: el puente no está en el camino crítico de nadie.

### Verificado en producción

Se publicaron diez documentos reales de cuatro clientes que sí tienen lead, y la consulta de la
ficha los devuelve: Braincorp 4 documentos, Bodenor 3, Industrea 2, Aporta 1.

## 5. Lo que falta

1. **Dos variables y un despliegue.** `ATLAS_CRM_SUPABASE_URL` y `ATLAS_CRM_SERVICE_ROLE_KEY` en el
   proyecto Vercel de Financiero. En su primera corrida el cron publica los 155 documentos
   históricos restantes; la operación es idempotente, así que repetirla no duplica nada.
2. **Sustituir la clave de servicio.** Compartir el `service_role` de Atlas con otro módulo funciona
   y es deuda: da acceso total a una base ajena para usar dos funciones. Reemplazar por un token
   acotado cuando exista el emisor de identidad del paso 3.
3. **Paso 3: identidad única.** `atlas-crm` como OAuth 2.1 Server y los demás módulos confiando en
   ese emisor. Un login para toda la suite. Se dejó al final porque toca el acceso de productos
   vivos.
4. **Las otras siete apps.** Analytics, Lead, Lex, ITSM, Aprende, Scoring y el sitio repiten el
   patrón: resolver por RUT, guardar `crm_entity_id`, publicar sus hechos con
   `registrar_evento_de_suite`. El módulo se declara en `MODULOS_DE_LA_SUITE` en la ficha.

## 6. A quién pertenecen estos clientes

Los 21 son clientes de **Geimser**, no de Altius: salen de la organización GEIMSER de Financiero,
que es la única con `atlas_org_slug`. Quedaron correctamente en la organización `geimser` de Atlas.

Pero la primera versión de `registrar_entidad_facturada` no fijaba `organization_id` y dependía del
default de la columna, `default_organization_id()`, que devuelve **`'geimser'` fijo**. Cayeron bien
por casualidad. El día que Altius facture desde su propio Financiero, sus clientes habrían caído en
Geimser en silencio, y la política restrictiva de aislamiento los habría mostrado del lado
equivocado.

Corregido en `20260919004216_la_entidad_facturada_declara_su_empresa`: la organización viaja
explícita como primer parámetro y la firma anterior se eliminó, así ninguna llamada puede volver a
depender del default.

### El límite que queda

`crm_entities` es única por RUT **a nivel global**, no por organización. Si Geimser y Altius
facturan a la misma empresa, solo puede existir una entidad, y el aislamiento restrictivo se la
muestra a una sola de las dos. La función ya no reasigna en silencio: levanta
`el RUT X ya pertenece a otra organizacion; requiere resolucion humana`. Verificado en producción
intentando registrar un cliente de Geimser bajo Altius — rechazado, y el cliente siguió en Geimser.

Resolverlo de verdad significa decidir si el maestro es único por `(organización, RUT)` o si una
entidad puede ser compartida con permisos por fuente. Es la misma advertencia del documento de los
cinco frentes: *el índice global por RUT identifica una entidad, pero no otorga permiso para
compartir información entre campañas/clientes*.

## 7. Riesgos abiertos

- **Deriva de migraciones en Financiero.** `20260915175120_grant_reception_payment_capabilities`
  está aplicada en producción y no tiene archivo en el repositorio. Ese repo no es hoy la fuente de
  verdad de su esquema.
- **Aislamiento entre organizaciones.** Con módulos vendidos por empresa, una fuga de RLS entre
  organizaciones es existencial. Falta una batería de pruebas de aislamiento por operación y rol
  corriendo en CI, en los nueve proyectos.
- **Permisos de los datos derivados.** Un resumen construido con fuentes que el rol no puede leer
  no se vuelve seguro por ocultar la cita. Vale para el contexto unificado que consumirá la IA.
- **Dos proyectos Supabase sin identificar**: `supabase-crimson-village` y `supabase-beige-notebook`.
