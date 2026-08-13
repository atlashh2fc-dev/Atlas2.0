import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// `/reset-password` entra acá aunque exija sesión: si el enlace venció, la
// propia pantalla lo explica y ofrece pedir otro, en vez de rebotar al login sin
// decir nada. `/api/status` tiene que responder antes de autenticar: es lo que
// le dice al ejecutivo si el problema es el sistema o su contraseña.
const PUBLIC_PATHS = [
  "/login",
  "/auth",
  "/forgot-password",
  "/reset-password",
  "/api/status",
  // Vercel Cron no tiene sesión web; la ruta valida CRON_SECRET antes de operar.
  "/api/mail/inbound/sync",
];

export async function updateSession(request: NextRequest) {
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

  const { data: { user } } = await supabase.auth.getUser();

  let currentUser = user;
  let forcedLogout = false;
  if (currentUser) {
    const { data: sessionValid, error: sessionError } = await supabase.rpc(
      "is_current_app_session_valid"
    );
    if (!sessionError && !sessionValid) {
      forcedLogout = true;
      // La orden está ligada al session_id actual. Cerrar globalmente también
      // eliminaría un relogin legítimo abierto después de la orden.
      await supabase.auth.signOut({ scope: "local" });
      currentUser = null;
    }
  }

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p));

  if (!currentUser && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    if (forcedLogout) url.searchParams.set("reason", "forced_logout");
    const redirectResponse = NextResponse.redirect(url);
    for (const cookie of supabaseResponse.cookies.getAll()) {
      redirectResponse.cookies.set(cookie);
    }
    return redirectResponse;
  }

  if (currentUser && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
