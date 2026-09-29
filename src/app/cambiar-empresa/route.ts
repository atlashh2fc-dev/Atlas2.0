import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";

import { esPrecarga, rutaSegura } from "@/lib/ruta-pedida";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Cambia a la empresa que tiene la pantalla pedida y vuelve a ella. Llega acá
 * `requireModule` cuando la empresa activa no tiene esa pantalla pero otra de
 * las de la persona sí: el enlace de un correo abre donde apuntaba en vez de
 * responder 404. La base comprueba que la persona pertenezca a esa empresa.
 */
export async function GET(request: NextRequest) {
  const volver = rutaSegura(request.nextUrl.searchParams.get("volver"));
  const empresa = request.nextUrl.searchParams.get("empresa") ?? "";
  const destino = new URL(volver, request.nextUrl.origin);

  // Una precarga no elige empresa por la persona: solo lo hace una visita real.
  if (esPrecarga(request.headers) || !UUID.test(empresa)) {
    return NextResponse.redirect(new URL("/dashboard", request.nextUrl.origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("elegir_organizacion_activa", { p_organization_id: empresa });
  if (error) {
    console.error("[empresa] no se pudo cambiar a la empresa del enlace", error.message);
    return NextResponse.redirect(new URL("/dashboard", request.nextUrl.origin));
  }
  revalidatePath("/dashboard", "layout");
  return NextResponse.redirect(destino);
}
