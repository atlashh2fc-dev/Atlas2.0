# Auditoría: 403 Forbidden / Q.850 cause=21 en trunk Siptel Chile

**Fecha:** 2026-07-29
**Sistema:** `asterisk-atlas` (i-0035ad810120e9571, EIP 54.233.114.5, sa-east-1) — PJSIP
**Motor:** `dialer-engine-atlas` (i-0973184c0eb23a6b8) — `PJSIP/${phone}@${trunk_context}` vía AMI Originate
**Estado:** campaña "Secretaria Virtual" INACTIVA. Sin cambios en `[siptel]` propuestos hasta validar.

> Nota de alcance: este análisis se basa en la evidencia entregada (trazas parciales, config viva y correos de Siptel). No se verificó la caja en vivo durante la redacción. Todos los comandos de abajo son de lectura o aditivos; ninguno modifica el endpoint `[siptel]` que usa la campaña.

---

## 0. Lectura del síntoma antes de las hipótesis

Tres hechos acotan mucho el problema:

1. **El SBC responde, no descarta.** Un `403` con `Server: siptelchile` significa que el INVITE llegó, fue parseado y fue rechazado por *política*. No es red, no es Security Group, no es NAT de señalización. La capa de transporte está sana.

2. **Los tres contactos del AOR están `Avail` (~56–61 ms).** El `OPTIONS` sale desde 54.233.114.5 y vuelve `200 OK`. Descarta el `UNREACHABLE` anterior y confirma camino bidireccional.

3. **El rechazo es idéntico para *todos* los formatos de número probados.** Esto es el dato más informativo de todo el caso y apunta en contra de la hipótesis "formato del destino":

   - Si el problema fuera el **formato del número destino**, esperaríamos respuestas *distintas* según la variante: `404 Not Found`, `484 Address Incomplete`, `603/604`, o un `403` con cause 1/3/28. Un softswitch que rutea evalúa el B-number y falla de forma específica.
   - Un `403 + Q.850 cause=21` **idéntico e invariante** es la firma típica de un rechazo **pre-routing**: el SBC decide antes de mirar el destino. Las causas de rechazo pre-routing son: identidad/cuenta no resuelta, ANI no autorizado para esa cuenta, o cuenta existente pero no habilitada / sin ruta / sin saldo / sin clase de servicio.

**Conclusión de encuadre:** el peso de la evidencia está en **identidad/aprovisionamiento**, no en el plan de marcación. Dicho eso, hay **una combinación de headers que nunca se probó** (§2) y que puede explicarlo todo desde el lado Asterisk, así que no cerramos esa puerta.

### Dato que falta y que hay que capturar sí o sí

**¿Llega un `100 Trying` antes del `403`?**

- `INVITE` → `100 Trying` → `403`: el SBC aceptó la petición, entró a su lógica de ruteo y ahí rechazó → **aprovisionamiento/ruta/ANI** (H1, H2).
- `INVITE` → `403` directo, sin `100`: rechazo en la capa de ingreso/ACL/policy → **identidad, cuenta o header requerido ausente** (H3, H4, H6).

Esto sale gratis del pcap de §5 y parte el árbol de hipótesis en dos. Es lo primero que haría.

---

## 1. Qué está bien y no hay que volver a tocar

Para no perder tiempo re-auditando lo ya resuelto:

| Elemento | Estado | Comentario |
|---|---|---|
| Alcance IP / SG | OK | SIP 5060 UDP+TCP desde los 3 SBC; RTP 10000-20000 abierto |
| `transport-udp-external` | OK | `external_media_address` + `external_signaling_address` + `local_net` correctos |
| `type=identify` | OK | Los 3 SBC mapeados al endpoint `siptel` para el tráfico entrante |
| Codecs | OK | ulaw + alaw, `direct_media=no`, `rtp_symmetric`, `force_rport`, `rewrite_contact` |
| Qualify | OK | 3/3 `Avail` |

### Una corrección conceptual importante

El hallazgo original — `From: <sip:+56965906926@172.31.21.176>` — **no era un bug**. En Asterisk PJSIP, `external_signaling_address` reescribe **Via** y **Contact**, pero **nunca el From**. El host del `From` sale de `from_domain`, y si `from_domain` no está seteado, cae al bind address del transporte (la IP privada). Ese comportamiento es el esperado y **la enorme mayoría de los carriers lo ignoran por completo**, porque autentican por IP de origen de la capa 3, no por el host del From.

Esto importa por dos razones:

1. No debemos asumir que el cambio a `from_domain = 54.233.114.5` "arregló" algo. Es más limpio, pero probablemente sea neutro para Siptel.
2. **Sí importa verificar `Contact` y `Via`**, que son los que un SBC sí puede rechazar por topología. Si por algún motivo `local_net` no está aplicando y el `Contact` sale con `172.31.21.176`, eso es un candidato real de `403`. Hay que confirmarlo en el pcap, no en el log de Asterisk (§5).

---

## 2. El agujero en la matriz de pruebas

Este es el punto operativo más accionable del informe.

`from_user = 85848994` se aplicó **antes** de la prueba con prefijo en el Request-URI. Es decir, la prueba "prefijo como prefijo de marcación" salió así:

```
INVITE sip:85848994928299973@sbc01.siptel.cl SIP/2.0
From: <sip:85848994@54.233.114.5>          ← el prefijo TAMBIÉN acá
P-Asserted-Identity: <sip:+56965906926@54.233.114.5>
```

El prefijo aparece **dos veces**. Bajo cualquiera de las dos interpretaciones posibles del prefijo, esa combinación es incorrecta:

- Si el prefijo es **identidad de cuenta** → no debe ir prepended al destino.
- Si el prefijo es **prefijo de marcación** → el `From` debe llevar el DID, no el prefijo.

Matriz real de lo probado:

| # | From user | Request-URI user | From domain | Probado | Resultado |
|---|---|---|---|---|---|
| 1 | `+56965906926` | `+56928299973` | 172.31.21.176 (privada) | Sí | 403/21 |
| 2 | `+56965906926` | `56928299973` | 172.31.21.176 | Sí | 403/21 |
| 3 | `+56965906926` | `928299973` | 172.31.21.176 | Sí | 403/21 |
| 4 | `+56965906926` | `85848994965906926` | 172.31.21.176 | Sí | 403/21 |
| 5 | `85848994` | `+56928299973` | 54.233.114.5 | Sí | 403/21 |
| 6 | `85848994` | `85848994928299973` | 54.233.114.5 | Sí | 403/21 (prefijo duplicado) |
| **7** | **`56965906926`** | **`85848994` + `56928299973`** | 54.233.114.5 | **NO** | — |
| **8** | **`56965906926`** | **`56928299973`** | **`sbc01.siptel.cl`** | **NO** | — |
| **9** | **`85848994`** | **`56928299973`** | **`sbc01.siptel.cl`** | **NO** | — |
| **10** | `965906926` | `928299973` | 54.233.114.5 | **NO** | — |

Además, las pruebas 1–4 están **confundidas** por el `from_domain` privado: no son mediciones limpias del formato de número. En rigor solo hay **dos pruebas limpias** (5 y 6), y la 6 lleva el prefijo duplicado.

**Las filas 7, 8 y 9 son las de mayor valor esperado.** La 7 en particular: prefijo como ruta + ANI real en el From, que es exactamente lo que describe el correo de Siptel ("la IP registrada para el tráfico saliente **junto al** prefijo").

---

## 3. Hipótesis ordenadas por probabilidad

### H1 — Aprovisionamiento incompleto del lado Siptel (~35%)

La IP está dada de alta, pero el objeto cliente/ruta no está habilitado para cursar saliente: sin ruta asignada, sin clase de servicio para móvil, sin saldo/crédito, o el trunk quedó en estado de "turn-up"/test.

**Evidencia a favor:** rechazo invariante ante 6 combinaciones distintas de headers y formato; historial reciente de `UNREACHABLE` (alta reciente, posiblemente a medias); `cause=21 Call Rejected` es literalmente el código que un softswitch devuelve cuando una policy de cliente dice "no".
**Evidencia en contra:** Siptel afirma explícitamente que la IP está registrada para saliente. (Aunque "registrada" ≠ "habilitada y ruteada").

### H2 — El ANI/DID no está autorizado sobre esta IP/trunk (~20%)

El DID 965906926 puede estar amarrado al trunk de Vocalcom, no al nuevo. En Chile, por normativa SUBTEL, el carrier valida que el número presentado pertenezca al cliente **en ese trunk**; si el ANI no matchea la tabla de números autorizados de la cuenta, rechaza con 403 antes de rutear.

**Evidencia a favor:** explica el rechazo invariante al destino; explica por qué Vocalcom (que sí tiene el DID amarrado) funciona; es la causa #1 de `403/21` en trunks IP-auth en LatAm.
**Cómo se distingue de H1:** pidiendo a Siptel el log de ingreso de nuestro Call-ID. El motivo interno será "ANI not allowed" vs "no route / customer disabled".

### H3 — Semántica del prefijo mal aplicada (~20%)

`85848994` es un identificador técnico y no lo estamos poniendo donde lo esperan.

**Evidencia a favor:** la combinación correcta (fila 7) nunca se probó; el prefijo se duplicó en la única prueba que lo usó como ruta.
**Evidencia en contra:** si fuera solo esto, la prueba 6 debería haber dado un error de ruteo distinto (404/484), no el mismo 403/21.

Sobre **qué es** `85848994` (respuesta a tu pregunta 3), mi lectura ordenada:

| Interpretación | Prob. | Razonamiento |
|---|---|---|
| **Prefijo de marcación** (prepend al destino en el R-URI) | ~45% | 8 dígitos, no es un número chileno válido; la frase "para el tráfico saliente junto al prefijo" describe un discriminador de ruta. Es el patrón clásico de mayoristas chilenos para identificar la ruta/tarifa del cliente sobre una IP compartida. |
| **Cuenta / identidad técnica** (From user, o username de digest auth) | ~30% | Va explícitamente atado a la IP en el correo. Si Vocalcom recibe un `407`, el username será este número. |
| **Ruta/trunk group** (parámetro `;otg=`/`;dtg=`/`;tgrp=`, o Contact user) | ~15% | Común en SBC Sonus/AudioCodes. Compatible con "junto a la IP". |
| **Prefijo de caller ID** (prepend al ANI) | ~10% | Menos común; ya se probó (`85848994965906926`) y falló. |

No son excluyentes: puede ser prefijo de marcación **y** username de auth a la vez.

### H4 — `From`/`PAI` con host = IP pública en lugar del dominio del carrier (~8%)

Varios SBC exigen que el host del `From` (y por herencia el del `PAI`) sea su propio dominio o el dominio provisionado del cliente, y rechazan un literal IP desconocido.

**Validación barata:** `from_domain = sbc01.siptel.cl` en un endpoint de prueba (filas 8 y 9). Cero riesgo.

### H5 — El trunk espera digest auth y/o REGISTER, no solo IP (~7%)

Trunks híbridos (IP-auth + credenciales) existen. Lo normal sería un `407`, pero varios SBC devuelven `403` cuando la cuenta requiere credenciales y el INVITE llega sin `Authorization` alguno. Igualmente, si el trunk es registration-based y no hay binding activo, el saliente se rechaza.

**Validación:** preguntar a Siptel directamente (§7, pregunta 4). Configurar `outbound_auth` es **no destructivo** — no hace nada salvo que llegue un challenge — pero requiere credenciales que hoy no tenemos.

### H6 — SBC o puerto de destino incorrecto para saliente (~5%)

Siptel entregó rango 5060–5080. Es posible que sbc01 sea de entrada y el saliente deba ir a sbc04, o a un puerto específico por cliente. `OPTIONS` respondiendo `200` en 5060 no prueba que 5060 sea el puerto de servicio saliente.

**Validación:** probar el mismo INVITE contra los tres SBC. Si uno responde distinto (incluso otro código de error), es señal fuerte.

### H7 — `Contact`/`Via` filtrando IP privada (~3%)

Poco probable dado que el transporte está bien configurado, pero es verificación de un minuto en el pcap y descarta una clase entera de rechazos por topology hiding.

### H8 — Anti-fraude por `User-Agent` / patrón de tráfico (~2%)

Algunos carriers bloquean `User-Agent: Asterisk PBX` por política antifraude. Raro, pero `user_agent=` en el endpoint lo prueba en un minuto.

---

## 4. Qué es Asterisk y qué es el operador

**Resolvibles en Asterisk (todo lo demás es ruido si estas no son la causa):**

- Colocación del prefijo (R-URI vs From vs Contact vs parámetro de trunk group) — H3
- Host del `From`/`PAI` — H4
- Formato del ANI: `+56…` / `56…` / `9…` — parte de H2
- Formato del B-number — H3
- `Contact`/`Via` con IP privada — H7
- SBC/puerto destino — H6
- `send_rpid`, `contact_user`, `user_agent`, `outbound_proxy` — H3/H4/H8

**NO resolvibles en Asterisk (requieren acción de Siptel):**

- Cuenta/ruta no habilitada, sin tarifa, sin crédito, en estado de test — H1
- DID no asociado al trunk de esta IP — H2
- Clase de servicio que no permite móvil chileno / destino no habilitado — H1
- Requisito de credenciales o registro no comunicado — H5
- Cualquier whitelist de destinos durante el turn-up

**Punto clave:** el balance de evidencia (rechazo invariante) favorece el segundo grupo. Por eso §7 (la solicitud a Siptel) no es un paso de respaldo, es **el camino crítico**. Las pruebas de §5 se hacen **en paralelo**, no antes.

---

## 5. Plan de validación no destructivo

### 5.1 Verificación de estado (solo lectura)

```bash
sudo asterisk -rx "pjsip show endpoint siptel"
sudo asterisk -rx "pjsip show aors"
sudo asterisk -rx "pjsip show contacts"
sudo asterisk -rx "pjsip show transports"
sudo asterisk -rx "pjsip show identifies"
sudo asterisk -rx "pjsip show transport transport-udp-external"

# Confirmar que la EIP sigue asociada y es la que Siptel tiene registrada
aws ec2 describe-addresses --filters Name=instance-id,Values=i-0035ad810120e9571 \
  --region sa-east-1 --query 'Addresses[].[PublicIp,PrivateIpAddress]' --output table
```

### 5.2 Captura del INVITE real (fuente de verdad, no el log de Asterisk)

El log de Asterisk muestra lo que Asterisk *cree* que envía. El pcap muestra lo que sale del cable, ya con el NAT aplicado. Usar siempre el pcap para auditar `Via` y `Contact`.

```bash
sudo tcpdump -i any -n -s 0 \
  '(udp or tcp) and (host 45.161.108.139 or host 45.161.108.146 or host 45.161.108.126)' \
  -w /tmp/siptel-$(date +%Y%m%d-%H%M%S).pcap
# ... ejecutar la prueba ... Ctrl-C

# Lectura
tshark -r /tmp/siptel-*.pcap -Y 'sip' -V | less
# Solo la línea de resumen de cada mensaje:
tshark -r /tmp/siptel-*.pcap -Y 'sip' -T fields \
  -e ip.src -e ip.dst -e sip.Method -e sip.Status-Code -e sip.Call-ID
```

**Qué mirar en la captura, en este orden:**

1. ¿Hay `100 Trying` antes del `403`? (§0 — parte el árbol de hipótesis)
2. `Via:` y `Contact:` → ¿`54.233.114.5` o se filtró `172.31.21.176`?
3. Guardar el `Call-ID` exacto de cada intento → va en el correo a Siptel.
4. ¿El `403` trae headers adicionales (`Warning:`, `X-*`, texto extendido en `Reason:`)? Suelen decir el motivo real.

### 5.3 Endpoints de prueba paralelos (aditivo, `[siptel]` intacto)

Se agregan endpoints nuevos que **ninguna campaña referencia** (`trunk_context` de la campaña sigue siendo `siptel`). PJSIP no permite modificar el `From` por llamada vía `PJSIP_HEADER`, así que variar identidad exige endpoints separados. Todos comparten `siptel-aor`.

```ini
; ===== NO TOCAR [siptel] — estos son endpoints de laboratorio =====

; T1 — Fila 7: prefijo como RUTA en el R-URI, ANI real en el From (máxima prioridad)
[siptel-t1]
type = endpoint
transport = transport-udp-external
context = default
disallow = all
allow = ulaw
allow = alaw
aors = siptel-aor
direct_media = no
rtp_symmetric = yes
force_rport = yes
rewrite_contact = yes
from_user = 56965906926
from_domain = 54.233.114.5
send_pai = yes
trust_id_outbound = yes

; T2 — Fila 8: From domain = dominio del carrier, sin prefijo
[siptel-t2]
type = endpoint
transport = transport-udp-external
context = default
disallow = all
allow = ulaw
allow = alaw
aors = siptel-aor
direct_media = no
rtp_symmetric = yes
force_rport = yes
rewrite_contact = yes
from_user = 56965906926
from_domain = sbc01.siptel.cl
send_pai = yes
trust_id_outbound = yes

; T3 — Fila 9: prefijo como identidad + dominio del carrier
[siptel-t3]
type = endpoint
transport = transport-udp-external
context = default
disallow = all
allow = ulaw
allow = alaw
aors = siptel-aor
direct_media = no
rtp_symmetric = yes
force_rport = yes
rewrite_contact = yes
from_user = 85848994
from_domain = sbc01.siptel.cl
send_pai = yes
trust_id_outbound = yes

; T4 — RPID legacy + Contact user = prefijo (SBC estilo Sonus/AudioCodes)
[siptel-t4]
type = endpoint
transport = transport-udp-external
context = default
disallow = all
allow = ulaw
allow = alaw
aors = siptel-aor
direct_media = no
rtp_symmetric = yes
force_rport = yes
rewrite_contact = yes
from_user = 56965906926
from_domain = 54.233.114.5
send_pai = yes
send_rpid = yes
trust_id_outbound = yes
contact_user = 85848994
```

Aplicar con `sudo asterisk -rx "pjsip reload"` (aditivo; `[siptel]` no cambia). El backup `/etc/asterisk/pjsip.conf.pre-siptel-identity-20260729` ya existe; hacer uno nuevo antes de editar.

### 5.4 Matriz de disparos

Desde el motor, mismo AMI/usuario/formato que el dialer. `Application: Wait` evita tocar el dialplan y no activa nada.

```
Action: Originate
Channel: PJSIP/<B-NUMBER>@<ENDPOINT>
CallerID: +56965906926
Application: Wait
Data: 5
Timeout: 20000
Async: true
```

| Test | Endpoint | B-number (parte antes de `@`) | Hipótesis que prueba |
|---|---|---|---|
| A | `siptel-t1` | `8584899456928299973` | H3 — prefijo=ruta, ANI limpio ★ |
| B | `siptel-t1` | `85848994928299973` | H3 — prefijo=ruta, formato nacional ★ |
| C | `siptel-t1` | `56928299973` | Control: aísla el efecto del `+` en el From |
| D | `siptel-t2` | `56928299973` | H4 — dominio del carrier |
| E | `siptel-t3` | `56928299973` | H4+H3 — identidad=prefijo + dominio carrier |
| F | `siptel-t4` | `56928299973` | H3/H8 — RPID + contact_user |
| G | `siptel-t1` | `928299973` | Formato nacional puro |

★ = mayor valor esperado.

**Disciplina de ejecución:**

- Correr los 7 con el `tcpdump` de §5.2 activo de principio a fin, en una única ventana de ~5 minutos.
- Anotar hora exacta (UTC) y `Call-ID` de cada uno.
- Apagar `pjsip set logger off` al terminar (como ya se hizo).
- **Cualquier respuesta distinta de `403/cause=21` es la señal.** Un `404`, `484`, `488` o incluso un `403` con otro cause significa que ese INVITE llegó más lejos en la cadena de ruteo → esa es la dirección correcta.
- Si los 7 dan `403/21` idéntico: el problema está confirmado del lado Siptel (H1/H2) y §7 pasa a ser lo único que queda.

### 5.5 Prueba de SBC alternativo (H6)

Repetir el test C apuntando explícitamente a sbc02 y sbc04. Requiere un endpoint con AOR de contacto único:

```ini
[siptel-aor-sbc04]
type = aor
contact = sip:sbc04.siptel.cl:5060
qualify_frequency = 60
```
…y un endpoint `siptel-t5` idéntico a `siptel-t1` pero con `aors = siptel-aor-sbc04`.

---

## 6. Sobre los parámetros que preguntaste (pregunta 5)

| Parámetro | ¿Tiene sentido? | Comentario |
|---|---|---|
| `send_rpid = yes` | **Sí, probar** | Remote-Party-ID es el header legacy; SBC con base Sonus/Huawei todavía lo priorizan sobre PAI. Enviar ambos es inofensivo. Incluido en T4. |
| `contact_user =` | **Sí, probar** | Algunos carriers exigen Contact user = cuenta o = DID. Costo cero. Incluido en T4. |
| `from_domain` distinto | **Sí, probar** | Probar con `sbc01.siptel.cl`. Es H4. T2/T3. |
| `outbound_proxy =` | **Solo si Siptel lo pide** | Útil si esperan R-URI con host = dominio de servicio (`siptel.cl`) pero paquetes hacia el SBC. Es un patrón real; no lo apliques a ciegas, pregúntalo (§7 pregunta 3). |
| `outbound_auth` / `auth` | **Sí, pero requiere credenciales** | No destructivo: solo actúa ante un `401/407`. Sin credenciales de Siptel no se puede configurar. Preguntar primero. |
| `callerid =` en el endpoint | **Redundante** | El `CallerID` del AMI Originate ya lo provee, y `from_user` sobrescribe el user del From de todos modos. Útil solo como default en endpoints de laboratorio. |
| `trust_id_inbound` | **No** | Solo afecta si *aceptamos* PAI/RPID entrante de ellos. Irrelevante para este 403. |
| `trust_id_outbound` | Ya puesto, neutro | Solo importa cuando la presentación del caller ID es restringida. No hace daño. |
| Headers manuales (`PJSIP_HEADER`) | **Solo con dato de Siptel** | Sirve para `Diversion`, `X-*` o parámetros `;otg=`/`;dtg=`. Inventarlos sin la especificación es ruido: un header propietario mal formado puede empeorar el diagnóstico. |
| `user_agent =` | Prueba de descarte barata | Solo si todo lo demás falla (H8). |
| `100rel`, `timers`, `rtp_timeout` | **No** | No producen 403; el rechazo ocurre antes de negociar media. |

---

## 7. Solicitud técnica para Siptel

> Asunto: **Trunk saliente IP 54.233.114.5 / prefijo 85848994 — INVITE rechazado con 403 Q.850 cause=21. Solicitud de trace y especificación de headers**
>
> Estimados,
>
> Escribo respecto del trunk saliente asociado a la IP **54.233.114.5** y al prefijo **85848994**, con numeración **965906926** (caller ID **+56965906926**).
>
> **Estado actual de nuestro lado:**
>
> - Los tres SBC (sbc01/sbc02/sbc04) responden `OPTIONS` con `200 OK` desde nuestra IP, con latencias de 56–61 ms. La conectividad está confirmada en ambos sentidos.
> - Nuestro Asterisk (PJSIP) envía el INVITE desde 54.233.114.5 hacia `sbc01.siptel.cl:5060` con la siguiente identidad:
>
>   ```
>   INVITE sip:<destino>@sbc01.siptel.cl SIP/2.0
>   From: <sip:85848994@54.233.114.5>
>   P-Asserted-Identity: <sip:+56965906926@54.233.114.5>
>   ```
>
> - **En todos los casos recibimos:**
>
>   ```
>   SIP/2.0 403 Forbidden
>   Server: siptelchile
>   Reason: Q.850;cause=21
>   ```
>
> - Probamos el destino de prueba **+56928299973** en los formatos `+56928299973`, `56928299973`, `928299973`, `85848994928299973`, y el prefijo también antepuesto al caller ID. **La respuesta es idéntica en los cinco casos**, lo que nos sugiere que el rechazo ocurre antes del análisis de numeración, en la capa de identificación o de política de la cuenta.
>
> **Lo que necesitamos de ustedes.** Con cualquiera de estos dos puntos podemos cerrar el caso; idealmente ambos:
>
> **(A) Un SIP trace anonimizado de un INVITE saliente exitoso** de un cliente equivalente sobre su plataforma (el cliente opera hoy un sistema Vocalcom contra Siptel sin inconvenientes, si pueden extraer uno de ese trunk sería lo ideal). Nos sirve el INVITE completo con los números enmascarados; lo que necesitamos ver es la **estructura**, no los datos:
>
> 1. `Request-URI` — user exacto (¿con `+`? ¿con `56`? ¿con el prefijo antepuesto?) y host (¿IP, `siptel.cl`, o `sbcNN.siptel.cl`?)
> 2. `To`
> 3. `From` — user y host, y display name si aplica
> 4. `P-Asserted-Identity` y/o `Remote-Party-ID` — cuáles envían y con qué host
> 5. `Contact` — user y host
> 6. Cualquier parámetro de trunk group (`;tgrp=`, `;otg=`, `;dtg=`) o header propietario (`X-*`, `Diversion`)
> 7. Si el INVITE recibe challenge `401/407` de su SBC
>
> **(B) La especificación del trunk**, respondiendo puntualmente:
>
> 1. **¿Dónde debe ir el prefijo 85848994?** ¿Antepuesto al número destino en el Request-URI, como user del `From`, como username de autenticación, o como parámetro de trunk group? Es nuestra principal duda: el correo indica que la IP quedó registrada "junto al prefijo", pero no la ubicación en el mensaje SIP.
> 2. **¿En qué formato exacto debe presentarse el ANI/caller ID?** `+56965906926`, `56965906926` o `965906926`.
> 3. **¿En qué formato exacto debe ir el número destino?** ¿Y el host del Request-URI debe ser el FQDN del SBC o un dominio de servicio?
> 4. **¿El trunk es únicamente IP-auth, o requiere además digest auth o REGISTER?** Si requiere credenciales, favor indicar el método de entrega segura.
> 5. **¿Qué SBC y puerto corresponden al tráfico saliente de nuestra cuenta?** Nos entregaron el rango 5060–5080 y estamos usando 5060 hacia sbc01.
> 6. **Confirmación de aprovisionamiento:** ¿el DID 965906926 está asociado como ANI autorizado al trunk de la IP 54.233.114.5 (y no solo al trunk previo del cliente)? ¿La ruta saliente está habilitada, con clase de servicio para móvil nacional y saldo/crédito disponible?
>
> **(C) Su log de ingreso para nuestros intentos.** Podemos entregarles los `Call-ID` y las marcas de tiempo UTC exactas de cada prueba. Con el motivo interno de rechazo que registre su SBC para esos Call-ID (ANI no autorizado / cuenta sin ruta / destino no permitido / identificación fallida) resolvemos esto de inmediato.
>
> La campaña permanece inactiva y no estamos cursando tráfico productivo. Quedamos atentos.

**Adjuntar al correo:** los `Call-ID` + timestamps UTC de la matriz §5.4, y el `403` completo tal como se recibió.

---

## 8. Tabla resumen

| # | Hipótesis | Prob. | Evidencia actual | Validación sin afectar producción | Cambio recomendado |
|---|---|---|---|---|---|
| H1 | Ruta/cuenta no habilitada en Siptel (sin ruta, sin CoS, sin saldo, en turn-up) | ~35% | 403/21 invariante ante 6 combinaciones; historial de `UNREACHABLE`; cause 21 = rechazo por política | Pedir log de ingreso por Call-ID (§7-C). Ningún test local puede descartarla | Ninguno en Asterisk — escalar a Siptel |
| H2 | ANI/DID no autorizado sobre esta IP/trunk | ~20% | Rechazo independiente del destino; Vocalcom funciona con el mismo DID sobre otro trunk | Tests C/D/E (§5.4) con ANI en 3 formatos + §7-B pregunta 6 | Ajustar formato de ANI si Siptel lo especifica; si no, alta del DID en el trunk |
| H3 | Prefijo 85848994 mal ubicado | ~20% | La combinación correcta nunca se probó (prefijo duplicado en el único test de ruta) | Tests A/B/E/F (§5.4) | Si A o B pasan: `from_user` = DID y prefijo prepended en el dial string del motor |
| H4 | `From`/`PAI` host debe ser dominio del carrier | ~8% | `from_domain = 54.233.114.5` fue una decisión nuestra, no un requisito confirmado | Tests D/E (endpoints T2/T3) | `from_domain = sbc01.siptel.cl` en `[siptel]` si mejora |
| H5 | Trunk requiere digest auth o REGISTER | ~7% | Sin confirmar; normalmente daría 407, pero algunos SBC responden 403 | §7-B pregunta 4 | `outbound_auth` (inerte sin challenge) o `type=registration`, solo con credenciales de Siptel |
| H6 | SBC o puerto incorrecto para saliente | ~5% | Rango 5060–5080 entregado sin especificar uso; `OPTIONS` OK en 5060 no prueba servicio saliente | §5.5 contra sbc02 y sbc04 | Cambiar el contact del AOR si uno responde distinto |
| H7 | `Contact`/`Via` con IP privada | ~3% | Transporte bien configurado, pero no verificado en pcap | Inspección del pcap (§5.2, punto 2) | Revisar `local_net`/`external_signaling_address` si aparece 172.31.x.x |
| H8 | Bloqueo antifraude por `User-Agent` | ~2% | Ninguna directa; descarte barato | Añadir `user_agent =` en endpoint de laboratorio | Solo si todo lo demás se descarta |

---

## 9. Orden de ejecución sugerido

1. **Enviar el correo de §7 hoy.** Es el camino crítico y tiene el mayor lead time. No esperar a terminar las pruebas.
2. **Correr la matriz §5.4 con pcap activo** en una ventana de ~5 minutos. Registrar Call-IDs.
3. **Revisar el pcap**: ¿hay `100 Trying`? ¿`Contact`/`Via` públicos? ¿headers extra en el `403`?
4. **Enviar Call-IDs y timestamps** a Siptel como complemento del correo.
5. **No tocar `[siptel]` ni activar la campaña** hasta tener un `200 OK` (o al menos un `183/180`) sobre un endpoint de laboratorio.

**Criterio de éxito parcial:** cualquier respuesta ≠ `403/cause=21` en la matriz indica la dirección correcta y convierte el problema en un ajuste de formato. Si las 7 pruebas dan el mismo `403/21`, queda técnicamente demostrado que el bloqueo es de aprovisionamiento y la conversación pasa íntegramente a Siptel.
