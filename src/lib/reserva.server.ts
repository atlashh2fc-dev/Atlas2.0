import "server-only";

import { createClient as crearCliente } from "@supabase/supabase-js";

/**
 * Cliente sin sesión para la reserva en línea: entra como `anon` y solo
 * puede llamar las funciones públicas de reserva. Aunque quien reserva sea
 * alguien de la clínica con sesión abierta, la página pública se comporta
 * igual que para cualquier persona.
 */
export function clientePublico() {
  return crearCliente(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
