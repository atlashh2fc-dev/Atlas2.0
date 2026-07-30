import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Probe = "ok" | "down" | "unknown";

const TIMEOUT_MS = 3000;

async function probe(url: string, headers?: Record<string, string>): Promise<Probe> {
  try {
    const response = await fetch(url, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return response.ok ? "ok" : "down";
  } catch {
    return "down";
  }
}

/**
 * Estado del servicio para la pantalla de acceso: si esto responde "down", el
 * ejecutivo sabe que no es su contraseña.
 *
 * - `auth`: el endpoint de salud de GoTrue, que es exactamente el servicio que
 *   atiende el login.
 * - `dialer`: el /health del motor de discado. Queda en "unknown" mientras no
 *   se configure DIALER_ENGINE_HEALTH_URL — preferimos no decir nada antes que
 *   afirmar que la central está arriba sin haberlo comprobado.
 */
export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const dialerUrl = process.env.DIALER_ENGINE_HEALTH_URL;

  const [auth, dialer] = await Promise.all([
    supabaseUrl && anonKey
      ? probe(`${supabaseUrl}/auth/v1/health`, { apikey: anonKey })
      : Promise.resolve<Probe>("unknown"),
    dialerUrl ? probe(dialerUrl) : Promise.resolve<Probe>("unknown"),
  ]);

  return NextResponse.json({ auth, dialer }, { headers: { "cache-control": "no-store" } });
}
