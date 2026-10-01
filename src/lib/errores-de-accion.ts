/**
 * Traduce los errores de Supabase/Postgres que devuelven las server actions a
 * una frase que diga qué pasó y qué hacer. Antes se relanzaba `error.message`
 * tal cual y el toast mostraba cosas como «duplicate key value violates unique
 * constraint "leads_rut_key"» o «new row violates row-level security policy»,
 * que no le sirven a quien opera el CRM.
 *
 * El detalle técnico no se pierde: queda en `console.error` (logs del servidor).
 *
 * Lo que ya es humano se respeta: las funciones de la base levantan con
 * `raise exception '…'` (código P0001) frases en español pensadas para la
 * pantalla («Tienes una gestión pendiente de tipificación…») y hay componentes
 * que las reconocen por su texto, así que esas pasan intactas.
 */

/** Forma común de PostgrestError, AuthError y errores de red de supabase-js. */
interface ErrorConCodigo {
  message?: unknown;
  code?: unknown;
  details?: unknown;
  hint?: unknown;
  status?: unknown;
  name?: unknown;
}

const GENERICO = "No se pudo completar la operación. Inténtalo de nuevo; si se repite, avisa a soporte.";

const SESION_VENCIDA = "Tu sesión venció. Vuelve a entrar e inténtalo otra vez.";
const SIN_PERMISO =
  "No tienes permiso para hacer esto con tu rol. Si crees que deberías poder, pídeselo a tu supervisor o al administrador.";
const SIN_CONEXION = "No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo en unos segundos.";
const DEMORA =
  "La operación tardó demasiado y se canceló. Inténtalo de nuevo; si se repite, acota lo que estás pidiendo o avisa a soporte.";

/** Campos de una restricción única, dichos como los diría el usuario. */
const CAMPOS: Array<[RegExp, string]> = [
  [/e-?mail|correo/i, "ese correo"],
  [/\brut\b|_rut|rut_/i, "ese RUT"],
  [/phone|tel[eé]fono|fono|msisdn/i, "ese teléfono"],
  [/slug/i, "ese identificador"],
  [/codigo|code\b/i, "ese código"],
  [/name|nombre/i, "ese nombre"],
];

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor : "";
}

function campoDeUnique(detalle: string, mensaje: string): string | null {
  // Postgres: «Key (email)=(x@y.cl) already exists.» / constraint "leads_rut_key".
  const columnas = /Key \(([^)]+)\)/i.exec(detalle)?.[1] ?? /constraint "([^"]+)"/i.exec(mensaje)?.[1] ?? "";
  if (!columnas) return null;
  for (const [patron, frase] of CAMPOS) if (patron.test(columnas)) return frase;
  return null;
}

/**
 * Un mensaje levantado a propósito por la base que se puede mostrar tal cual:
 * frase con espacios y sin vocabulario de Postgres ni identificadores internos.
 */
function esFraseParaPantalla(mensaje: string): boolean {
  if (!/\s/.test(mensaje.trim())) return false; // «not_authorized», «whatsapp_conversation_closed»
  if (/violates|relation|column|syntax|function |operator|invalid input|does not exist|constraint|PGRST|JWT/i.test(mensaje))
    return false;
  // Mensajes en inglés de PostgREST/GoTrue («Database error saving new user»).
  if (/\b(the|is|was|not|failed|invalid|unable|cannot|could|found|allowed|already|exists|required|database|unexpected)\b/i.test(mensaje))
    return false;
  return true;
}

/**
 * Frase humana para el error. `respaldo` es lo que se dice cuando el error no
 * se reconoce («No se pudo guardar el canal.»); si no se da, una genérica.
 */
export function mensajeDeError(error: unknown, respaldo: string = GENERICO): string {
  if (!error) return respaldo;

  const e = (typeof error === "object" ? error : { message: String(error) }) as ErrorConCodigo;
  const mensaje = texto(e.message);
  const codigo = texto(e.code);
  const detalle = texto(e.details);
  const status = typeof e.status === "number" ? e.status : null;

  console.error("[accion] error de base", { codigo, mensaje, detalle, pista: texto(e.hint), status });

  // Sesión: JWT vencido o inválido (PostgREST/GoTrue) y el «No autenticado.» de las RPC.
  if (
    codigo === "PGRST301" ||
    codigo === "PGRST302" ||
    codigo === "session_expired" ||
    codigo === "session_not_found" ||
    codigo === "bad_jwt" ||
    /jwt (expired|is expired)|invalid jwt|refresh token|^no autenticado/i.test(mensaje) ||
    status === 401
  ) {
    return SESION_VENCIDA;
  }

  // Permisos: RLS, GRANT o guardas de las RPC.
  if (
    codigo === "42501" ||
    codigo === "not_admin" ||
    status === 403 ||
    /row-level security|permission denied|not_authorized|access_denied|solo puede ser llamada por/i.test(mensaje)
  ) {
    return SIN_PERMISO;
  }

  // Red y demoras.
  if (codigo === "57014" || /statement timeout|canceling statement|timed out|timeout/i.test(mensaje)) return DEMORA;
  if (
    /fetch failed|failed to fetch|network|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|socket hang up/i.test(mensaje) ||
    e.name === "AuthRetryableFetchError" ||
    status === 502 ||
    status === 503 ||
    status === 504
  ) {
    return SIN_CONEXION;
  }

  switch (codigo) {
    case "23505": {
      const campo = campoDeUnique(detalle, mensaje);
      return campo
        ? `Ya existe un registro con ${campo}. Búscalo antes de crear otro.`
        : "Ya existe un registro con esos datos. Búscalo antes de crear otro.";
    }
    case "23503":
      return /update or delete/i.test(mensaje)
        ? "No se puede borrar porque hay otros registros que dependen de este. Desactívalo en vez de borrarlo."
        : "Uno de los datos elegidos ya no existe. Actualiza la página y vuelve a elegirlo.";
    case "23502":
      return "Falta un dato obligatorio. Completa el formulario y vuelve a intentarlo.";
    case "23514":
      return "Uno de los valores no está permitido. Revisa los datos e inténtalo de nuevo.";
    case "22001":
      return "Uno de los textos es demasiado largo. Acórtalo e inténtalo de nuevo.";
    case "22P02":
    case "22007":
    case "22008":
    case "22003":
      return "Uno de los valores tiene un formato que no reconocemos. Revísalo e inténtalo otra vez.";
    case "40001":
    case "40P01":
      return "Otra persona estaba modificando lo mismo en ese momento. Vuelve a intentarlo.";
    case "PGRST116":
      return "No encontramos el registro. Puede que lo hayan eliminado; actualiza la página.";
    case "email_exists":
    case "user_already_exists":
      return "Ya existe un usuario con ese correo. Búscalo en la lista antes de crear otro.";
    case "weak_password":
      return "La contraseña es muy débil. Usa al menos 8 caracteres combinando letras y números.";
    case "email_address_invalid":
    case "validation_failed":
      return "El correo no es válido. Revísalo e inténtalo otra vez.";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "Hubo demasiados intentos seguidos. Espera un minuto y vuelve a intentarlo.";
  }

  // Excepciones levantadas a propósito por las funciones de la base (P0001) o
  // errores sin código: si ya son una frase para la pantalla, se respetan.
  if ((codigo === "P0001" || codigo === "P0002" || codigo === "") && mensaje && esFraseParaPantalla(mensaje)) {
    return mensaje;
  }

  return respaldo;
}

/**
 * Error listo para relanzar desde una server action:
 * `if (error) throw errorDeAccion(error);`
 */
export function errorDeAccion(error: unknown, respaldo?: string): Error {
  return new Error(mensajeDeError(error, respaldo));
}
