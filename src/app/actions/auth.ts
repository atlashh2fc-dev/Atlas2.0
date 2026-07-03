"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { markAgentLoggedOut } from "./agent-status";

export async function signOut() {
  // Antes de terminar la sesión: si el usuario tenía un estado de discador
  // (Disponible/Auxiliar/etc.), forzarlo a "Desconectado" — de lo contrario
  // el monitor en vivo lo sigue mostrando "Disponible" indefinidamente y el
  // motor cree que puede seguir asignándole llamadas. Se envuelve en
  // try/catch para que un fallo acá nunca bloquee el logout en sí.
  try {
    await markAgentLoggedOut();
  } catch {
    // no-op: el logout debe completarse igual.
  }

  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
