import type { AuthError } from "@supabase/supabase-js";

/**
 * Un fallo de acceso con su causa identificada. El mensaje único
 * ("credenciales inválidas") dejaba al ejecutivo sin saber qué hacer cuando el
 * problema no era la contraseña: cuenta desactivada, demasiados intentos o la
 * red caída se veían exactamente igual.
 */
export interface AuthFailure {
  /** Qué pasó, en una frase. */
  title: string;
  /** Qué hacer al respecto. */
  detail?: string;
  /** Mostrar el enlace de recuperación de contraseña junto al mensaje. */
  offerRecovery?: boolean;
}

export const ACCOUNT_INACTIVE: AuthFailure = {
  title: "Tu cuenta está desactivada",
  detail: "Pide a tu supervisor que la reactive para volver a entrar.",
};

export const ACCOUNT_NOT_PROVISIONED: AuthFailure = {
  title: "Tu usuario todavía no está dado de alta en Atlas",
  detail: "Tienes credenciales, pero falta crear tu perfil. Avisa a tu supervisor.",
};

export const LINK_EXPIRED: AuthFailure = {
  title: "El enlace ya no sirve",
  detail: "Los enlaces de recuperación duran una hora y se usan una sola vez. Pide uno nuevo.",
};

/** Segundos de espera que Supabase incrusta en el mensaje de rate limit. */
function retryAfterSeconds(message: string): number | null {
  const match = /(\d+)\s*second/i.exec(message);
  return match ? Number(match[1]) : null;
}

/**
 * Traduce el error de Supabase a algo accionable. Se apoya en `code` cuando
 * existe y cae al `status` y al texto para las versiones que todavía no lo
 * emiten.
 */
export function mapAuthError(error: AuthError): AuthFailure {
  const code = error.code ?? "";
  const message = error.message ?? "";

  // Sin red: el fetch ni siquiera llegó a Supabase, así que no hay status HTTP.
  if (error.name === "AuthRetryableFetchError" || !error.status) {
    return {
      title: "No pudimos conectar con el servidor",
      detail: "Revisa tu conexión a internet y vuelve a intentar.",
    };
  }

  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit" || error.status === 429) {
    const seconds = retryAfterSeconds(message);
    return {
      title: "Demasiados intentos seguidos",
      detail: seconds
        ? `Espera ${seconds} segundos antes de volver a intentar.`
        : "Espera unos segundos antes de volver a intentar.",
    };
  }

  if (code === "user_banned") {
    return {
      title: "Tu cuenta está bloqueada temporalmente",
      detail: "Ocurre tras varios intentos fallidos. Contacta a tu supervisor si no se libera.",
    };
  }

  if (code === "email_not_confirmed") {
    return {
      title: "Tu correo todavía no está confirmado",
      detail: "Busca el correo de confirmación de Atlas en tu bandeja, o pide a tu supervisor que lo reenvíe.",
    };
  }

  if (code === "invalid_credentials" || /invalid login credentials/i.test(message)) {
    return {
      title: "Correo o contraseña incorrectos",
      detail: "Revisa que el correo esté bien escrito y que no tengas Bloq Mayús activado.",
      offerRecovery: true,
    };
  }

  if (error.status >= 500) {
    return {
      title: "El servicio de acceso no está respondiendo",
      detail: "No es tu contraseña. Vuelve a intentar en un minuto o avisa a soporte.",
    };
  }

  return {
    title: "No pudimos iniciar tu sesión",
    detail: message || "Vuelve a intentar. Si sigue pasando, avisa a soporte.",
    offerRecovery: true,
  };
}
