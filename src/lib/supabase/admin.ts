import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente con la service_role key. SOLO usar en server actions / route handlers,
 * nunca exponer al cliente. Permite operaciones de administración (auth.admin.*)
 * que la anon key no puede hacer, como crear usuarios directamente.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Falta SUPABASE_SERVICE_ROLE_KEY en las variables de entorno. Agrégala en .env.local y en Vercel (Settings → Environment Variables) — la encuentras en el dashboard de Supabase, Settings → API → service_role."
    );
  }

  return createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
