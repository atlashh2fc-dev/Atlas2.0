# Pantalla de acceso

## Diagnóstico

La pantalla anterior era una tarjeta centrada correcta pero incompleta para un
contact center. Lo que fallaba no era estético:

1. **No existía recuperación de contraseña.** Un ejecutivo que olvidaba su clave
   dependía de que un administrador se la cambiara a mano.
2. **Un solo mensaje de error** ("Credenciales inválidas") para causas que exigen
   acciones distintas: contraseña incorrecta, cuenta desactivada, demasiados
   intentos, red caída, servicio de acceso abajo.
3. **Cuenta desactivada indistinguible.** `profiles.active = false` autentica
   igual; el ejecutivo entraba y `requireProfile` lo devolvía al login sin
   explicar nada — un bucle mudo.
4. **Sin señal de servicio.** Quien no podía entrar no tenía forma de saber si el
   problema era suyo o del sistema, así que llamaba a soporte para averiguarlo.
5. **Fricción diaria** en una pantalla que se usa dos veces al día: sin recordar
   el correo, sin `autocomplete` para el gestor de contraseñas, sin aviso de
   Bloq Mayús.
6. **Accesibilidad:** el error no se anunciaba (sin `role="alert"`), no había
   `<main>` ni título propio de página.

## Lo implementado

### Recuperación de contraseña (de punta a punta)

| Ruta | Qué hace |
| --- | --- |
| `/forgot-password` | Pide el correo y llama a `resetPasswordForEmail`. Responde siempre lo mismo exista o no el correo — decir "ese correo no está registrado" permitiría enumerar quién trabaja acá. Solo muestra error si es límite de intentos o red. |
| `/auth/callback` | Canjea el `code` (PKCE) o el `token_hash` (plantillas antiguas) por una sesión y redirige. `next` se valida: solo rutas internas, para no dejar un redirector abierto. |
| `/reset-password` | Con sesión: nueva contraseña + confirmación, mínimo 8 caracteres. Sin sesión: explica que el enlace venció y ofrece pedir otro, en vez de rebotar al login. |

### Taxonomía de errores — `src/lib/auth-errors.ts`

`mapAuthError` traduce el error de Supabase a título + qué hacer. Se apoya en
`code` cuando existe y cae al `status` y al texto para versiones que no lo
emiten. Distingue: credenciales, cuenta sin confirmar, cuenta bloqueada,
demasiados intentos (con los segundos de espera), servicio caído (5xx) y sin red
(el fetch no llegó, no hay `status`).

Aparte, tras autenticar se lee el propio perfil para separar **cuenta
desactivada** y **usuario sin perfil en Atlas**; en ambos casos se cierra la
sesión y se explica a quién pedirle la reactivación.

### Estado del servicio — `/api/status`

- `auth`: sondea `/auth/v1/health` de GoTrue, que es literalmente el servicio que
  atiende el login.
- `dialer`: sondea el `/health` del motor. Queda en `unknown` mientras no se
  configure `DIALER_ENGINE_HEALTH_URL`; preferimos no decir nada antes que
  afirmar que la central está arriba sin haberlo comprobado.

La ruta es pública en el proxy: tiene que responder **antes** de autenticar.

### Marca y color

Panel dividido: marca a la izquierda, formulario a la derecha; en móvil el panel
se reduce a cabecera. El panel usa el token nuevo `--auth-panel`, que apunta a
`--black-dark`, **no** a `--blue-corp`: blanco sobre `#049dd9` da 3.07:1 de
contraste y no llega al mínimo AA para texto normal. El azul corporativo se
mantiene donde manda — botones, enlaces, la barra que ancla el titular — y el
aqua (`--aqua-accent`) como acento de los íconos y del indicador de estado.

### Fricción y accesibilidad

Correo recordado en el equipo (leído con `useSyncExternalStore`, no en un efecto,
para no violar `react-hooks/set-state-in-effect`), foco automático en el correo,
`autocomplete="username"` / `current-password` / `new-password`, aviso de Bloq
Mayús vía `getModifierState`, error con `role="alert"` y `aria-live`, `<main>` y
`metadata.title` por pantalla.

## Configuración aplicada en Supabase

Proyecto `atlas-crm` (`lxdclavsycdidmzlbaid`). Aplicado el 2026-07-30 desde el
dashboard; nada de esto se puede versionar en el repo.

**URL Configuration**

| Campo | Valor |
| --- | --- |
| Site URL | `https://atlascrm.geimser.cl` (antes `http://localhost:3000`) |
| Redirect URLs | `https://atlascrm.geimser.cl/auth/callback` y `http://localhost:3000/auth/callback` |

**SMTP** — el correo de geimser.cl no está en Google ni Microsoft: hay servidor
propio en `mail.geimser.cl` (190.107.177.31), con 465 y 587 abiertos y el 25
filtrado.

| Campo | Valor |
| --- | --- |
| Host / puerto | `mail.geimser.cl` : `465` |
| Usuario y sender | `no-reply@geimser.cl` |
| Sender name | `Atlas` |
| Intervalo mínimo | 60 s por usuario |

**Plantilla "Reset password"** — asunto "Recupera tu contraseña de Atlas", cuerpo
en español y el enlace en formato `token_hash`:

```
{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password
```

El enlace PKCE por defecto solo funciona en el mismo navegador que lo pidió: si
el ejecutivo pide el enlace en el computador y lo abre en el teléfono, falla. El
callback acepta ambos formatos, pero la plantilla ahora usa el que sirve siempre.

> Al abrir el formulario de SMTP, Chrome autocompletó una credencial personal
> (`hugo@admin.cl` + contraseña guardada) en los campos Username y Password. Se
> limpiaron antes de guardar. Si alguien vuelve a tocar esta pantalla, conviene
> verificar el Username antes de grabar.

## Variables de entorno nuevas (todas opcionales)

| Variable | Efecto si falta |
| --- | --- |
| `NEXT_PUBLIC_APP_ENV` | Se deriva de `NODE_ENV` (Producción / Desarrollo). |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | Se muestra el texto genérico "avisa a tu supervisor". |
| `DIALER_ENGINE_HEALTH_URL` | El login no afirma nada sobre la central telefónica. |

`NEXT_PUBLIC_APP_VERSION` se inyecta desde `package.json` en `next.config.ts`.

## Verificación

`tsc --noEmit` y `eslint` limpios. `next build` y el recorrido real del correo de
recuperación no se pudieron ejecutar en el entorno de trabajo (sin memoria para
el build, sin loopback para levantar el dev server) — quedan para la máquina
local.

**Prueba de humo pendiente**, una vez desplegado en `atlascrm.geimser.cl`: pedir
el enlace desde `/forgot-password` con un correo real, confirmar que llega desde
`no-reply@geimser.cl`, abrirlo **en otro dispositivo** (ahí se comprueba que el
formato `token_hash` funciona) y cambiar la contraseña. Si el correo no sale, el
lugar donde mirar es Authentication → Logs en el dashboard.
