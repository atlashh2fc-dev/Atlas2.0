import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// `/reset-password` entra acá aunque exija sesión: si el enlace venció, la
// propia pantalla lo explica y ofrece pedir otro, en vez de rebotar al login sin
// decir nada. `/api/status` tiene que responder antes de autenticar: es lo que
// le dice al ejecutivo si el problema es el sistema o su contraseña.
const PUBLIC_PATHS = [
  "/login",
  "/privacidad",
  "/auth",
  "/forgot-password",
  "/reset-password",
  "/api/status",
  // Vercel Cron no tiene sesión web; la ruta valida CRON_SECRET antes de operar.
  "/api/mail/inbound/sync",
  // Receiver/worker v2 validan HMAC o Bearer dedicado en cada route handler.
  // La barra final evita publicar por accidente otros namespaces de integración.
  "/api/integrations/v2/",
  // Meta no tiene sesión web: GET valida el token de verificación y POST exige
  // la firma HMAC-SHA256 de la app antes de procesar cualquier evento.
  "/api/integrations/meta/whatsapp/webhook",
  // YCloud usa un secreto independiente y firma el cuerpo crudo con
  // `YCloud-Signature`; no depende de una sesión de Atlas.
  "/api/integrations/ycloud/whatsapp/webhook",
];

const MACHINE_ONLY_PATHS = new Set([
  "/api/ai/learning-loop/worker",
  "/api/integrations/meta/whatsapp/ai-worker",
  "/api/integrations/meta/whatsapp/timeouts",
  // altiusignite.com avisa cada reunión, plan o contacto. No tiene sesión web:
  // el handler exige firma HMAC del cuerpo crudo y marca de tiempo reciente.
  "/api/integrations/altius/intake",
  // El agente calificador lo despierta el cron, con el mismo secreto que el resto.
  "/api/agentes/calificador",
  "/api/agentes/vigilante",
  "/api/agentes/vendedor",
]);

/**
 * El proxy corre en el borde más cercano a la persona (São Paulo para Chile),
 * lejos de la base (Virginia). Cada viaje a Supabase desde acá cuesta más de
 * 100 ms, y el proxy corre por cada petición, incluidas las precargas de los
 * enlaces del menú. Por eso acá no se pregunta nada a la red: el token se
 * verifica con la clave pública de Supabase, que queda en memoria, y solo se
 * refresca cuando venció.
 *
 * Que la sesión siga abierta (no cerrada a distancia por un administrador) lo
 * comprueban las páginas con `requireProfile` y la base en cada política por
 * fila; el proxy solo decide si hay alguien identificado o no.
 */
export async function updateSession(request: NextRequest) {
  // Machine-only endpoint: the handler checks a dedicated Bearer/cron secret.
  // Match exactly; adjacent routes must keep the normal session requirement.
  if (MACHINE_ONLY_PATHS.has(request.nextUrl.pathname)) {
    return NextResponse.next({ request });
  }
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data } = await supabase.auth.getClaims();
  const identified = Boolean(data?.claims?.sub);

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p));

  if (!identified && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    const redirectResponse = NextResponse.redirect(url);
    for (const cookie of supabaseResponse.cookies.getAll()) {
      redirectResponse.cookies.set(cookie);
    }
    return redirectResponse;
  }

  return supabaseResponse;
}
