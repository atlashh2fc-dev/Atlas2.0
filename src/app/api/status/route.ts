import { NextResponse } from "next/server";
import { probeDialerHeartbeat, type ServiceProbe } from "@/lib/dialer-health";

export const dynamic = "force-dynamic";

const TIMEOUT_MS = 3000;

async function probe(url: string, headers?: Record<string, string>): Promise<ServiceProbe> {
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
 * - `dialer`: heartbeat que el motor publica hacia Supabase. El puerto de salud
 *   de AWS permanece privado; si el heartbeat vence, se informa "down".
 */
export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const [auth, dialer] = await Promise.all([
    supabaseUrl && anonKey
      ? probe(`${supabaseUrl}/auth/v1/health`, { apikey: anonKey })
      : Promise.resolve<ServiceProbe>("unknown"),
    probeDialerHeartbeat(),
  ]);

  return NextResponse.json({ auth, dialer }, { headers: { "cache-control": "no-store" } });
}
