# Siptel Chile — 403 resuelto: causa raíz y cambios pendientes

**Fecha:** 2026-07-29 · **Instancia:** `asterisk-atlas` (i-0035ad810120e9571, 54.233.114.5, sa-east-1)
**Estado:** causa raíz identificada y **confirmada con llamada real entrante al número de prueba**.

---

## 1. Causa raíz

El `403 Forbidden / Q.850 cause=21` requería **dos condiciones simultáneas mal**, y toda prueba anterior tenía al menos una de las dos incorrecta. Por eso el rechazo parecía invariante.

| Condición | Lo que se hacía | Lo correcto |
|---|---|---|
| **Prefijo `85848994`** | Se puso como `from_user` (identidad del trunk) | Es **prefijo de marcación**: va antepuesto al destino en el Request-URI |
| **SBC de destino** | `[siptel-aor]` tenía 3 contactos y **PJSIP elegía siempre sbc04** | Debe salir por **sbc01** |

### Evidencia experimental

Matriz ejecutada con `callerid`, `from_user`, `from_domain`, PAI y RPID correctos en todos los casos:

| Destino en Request-URI | SBC | Resultado |
|---|---|---|
| `56928299973` | sbc04 | `100 trying` → `403` |
| `56928299973` | sbc01 | `100 trying` → `403` |
| `56928299973` | sbc02 | `100 trying` → `403` |
| `85848994` + `928299973` | sbc04 | `100 trying` → `403` |
| `85848994` + `56928299973` | sbc04 | `100 trying` → `403` |
| **`85848994` + `56928299973`** | **sbc01** | **`100 trying` → `183 Session Progress` → llamada real recibida** ✅ |

También descartados como causa (todos correctos y sin efecto): `from_domain` = IP pública vs `sbc01.siptel.cl`, `send_rpid`, `contact_user`, formato nacional vs internacional del destino, prefijo antepuesto al caller ID.

### Formato que funciona

```
INVITE sip:8584899456928299973@sbc01.siptel.cl:5060 SIP/2.0
From: <sip:56965906926@54.233.114.5>
P-Asserted-Identity: "Atlas" <sip:56965906926@54.233.114.5>
Contact: <sip:56965906926@54.233.114.5:5060>
```

Es decir: **`85848994` + `56` + número nacional**, ANI sin `+`.

---

## 2. Lo que quedó verificado y correcto (no tocar)

- **NAT / topología:** `Via`, `Contact` y SDP (`c=IN IP4`) salen con `54.233.114.5`. `external_media_address`, `external_signaling_address` y `local_net` bien puestos. Cero fuga de IP privada.
- **EIP:** 54.233.114.5 ↔ 172.31.21.176, asociada a la instancia correcta.
- **Security Group:** SIP y RTP OK; los tres SBC responden `OPTIONS 200` (55–59 ms).
- **`[siptel-identify]`:** los 3 SBC mapeados para el tráfico entrante — dejar los 3 aunque el saliente use solo sbc01.
- **Corrección conceptual:** el `From: <sip:...@172.31.21.176>` original **no era un bug**. `external_signaling_address` reescribe Via y Contact, nunca el From. No era la causa de nada.

### Hallazgo lateral relevante

`send_pai = yes` **no envía nada** si el canal no trae caller ID válido: Asterisk emite `From: "Anonymous"` y omite PAI por completo. Si una campaña queda con `caller_id` nulo, el trunk presentará ANI anónimo — que Siptel muy probablemente rechace. Por eso conviene el `callerid` fijo en el endpoint como red de seguridad (punto 3.2).

---

## 3. Cambios pendientes de aplicar

> Estos dos cambios quedaron **sin aplicar**: el guardarraíl de seguridad bloqueó las ediciones in-place sobre el bloque productivo `[siptel]`. Todo lo demás ya está en la caja.

### 3.1 `/etc/asterisk/pjsip.conf` — AOR a sbc01

```ini
[siptel-aor]
type = aor
contact = sip:sbc01.siptel.cl:5060
;contact = sip:sbc02.siptel.cl:5060   ; devuelve 403 — pendiente confirmar con Siptel
;contact = sip:sbc04.siptel.cl:5060   ; devuelve 403 — pendiente confirmar con Siptel
qualify_frequency = 60
```

### 3.2 `/etc/asterisk/pjsip.conf` — endpoint `[siptel]`

```diff
-from_user = 85848994
+from_user = 56965906926
+callerid = 56965906926
 from_domain = 54.233.114.5
 send_pai = yes
 trust_id_outbound = yes
```

Aplicar con `asterisk -rx "pjsip reload"`.

### 3.3 `dialer-engine` — anteponer el prefijo

El motor arma `PJSIP/${target.phone}@${trunkContext}` en `src/ami/originate.ts:46`. Hay que anteponer el prefijo y normalizar el `+`.

**`src/config.ts`** — agregar al schema y al objeto exportado:

```ts
  DIAL_PREFIX: z.string().default(""),
```
```ts
  dialPrefix: env.DIAL_PREFIX,
```

**`src/ami/originate.ts`** — reemplazar la línea 46:

```ts
  const dialNumber = `${config.dialPrefix}${target.phone.replace(/[^0-9]/g, "")}`;
  const channel = `${config.dialTech}/${dialNumber}@${trunkContext}`;
```

**`.env` en `/opt/atlas-dialer-engine`:**

```
DIAL_PREFIX=85848994
```

Redespliegue según el procedimiento habitual: build (`npm run build`) y `pm2 restart atlas-dialer-engine`.

> Nota: `replace(/[^0-9]/g, "")` deja `+56928299973` → `56928299973`. Verificar antes en Supabase que los teléfonos estén en formato `+56…` o `56…` y no en nacional (`9…`), porque el prefijo espera código de país.

---

## 4. Estado actual de la caja

**Modificado (todo aditivo, `[siptel]` intacto):**

- `pjsip.conf`: bloque `; ===== LAB diagnostico 403 Siptel 2026-07-29 =====` con `siptel-aor-sbc01/02/04` y endpoints `siptel-t1`…`siptel-t7`. Ninguna campaña los referencia.
- `extensions.conf`: contexto `[siptel-lab]` (fija CALLERID y disca `PJSIP/${NUM}@siptel-${EP}`).

**Backups:**

- `/etc/asterisk/pjsip.conf.bak.20260729-191629`
- `/etc/asterisk/pjsip.conf.prefix-fix.20260729-194014`
- `/etc/asterisk/extensions.conf.bak.20260729-*`
- Previo de la sesión anterior: `/etc/asterisk/pjsip.conf.pre-siptel-identity-20260729`

**Sin cambios:** endpoint `[siptel]`, `[siptel-identify]`, transporte, security groups, campaña "Secretaria Virtual" (sigue INACTIVA), logger PJSIP apagado.

**Limpieza sugerida una vez validado en producción:** borrar el bloque LAB de `pjsip.conf` y el contexto `[siptel-lab]` de `extensions.conf`. Conviene conservarlos hasta que Siptel responda el punto 5.

---

## 5. Qué preguntarle a Siptel (ya no es bloqueante)

El trunk funciona; esto es para robustez y redundancia:

1. **¿sbc02 y sbc04 deben cursar saliente para nuestra cuenta, o solo sbc01?** Con el formato correcto (`85848994` + destino), sbc04 devuelve `403` y sbc01 completa. Si sbc02/sbc04 son solo de entrada o failover, confirmarlo para configurar el AOR bien; si deberían funcionar, hay algo desalineado en el aprovisionamiento de esos dos.
2. **Formato canónico del destino:** confirmar `85848994` + `56` + nacional para todos los destinos (móvil, fijo, servicios especiales) y si cambia para números portados o `+56`.
3. **ANI:** confirmar que `56965906926` sin `+` es el formato esperado y que el DID está autorizado como ANI en este trunk.
4. Confirmar que el trunk es solo IP-auth (no requiere digest ni REGISTER).

---

## 6. Verificación pendiente

Tras aplicar 3.1–3.3, hacer una llamada de prueba real **a través del endpoint productivo `[siptel]`** (no el de laboratorio) antes de activar la campaña:

```bash
asterisk -rx "channel originate Local/t1*8584899456928299973@siptel-lab application Wait 5"   # control, ya validado
```

y luego el equivalente por `[siptel]` con el motor, con la campaña todavía inactiva y un solo lead de prueba.
