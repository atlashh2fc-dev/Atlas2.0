import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import {
  diaEnChile,
  libroNegociosEquifax,
  nombreArchivoNegocios,
  type NegocioEquifax,
} from "@/lib/equifax-negocios-excel";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function responseError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
}

/**
 * Descarga «Negocios en curso» de Equifax: la hoja Data que operación armaba a
 * mano. La RPC decide qué registros ve cada uno (admin, su empresa; supervisor,
 * sus equipos). Con ?campaign= se limita a esa campaña; sin ella trae todas las
 * campañas con contrato Equifax.
 */
export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return responseError("Debes iniciar sesión.", 401);
  if (!profile.active || !["admin", "supervisor"].includes(profile.role)) {
    return responseError("No tienes permiso para descargar este reporte.", 403);
  }

  const campaign = new URL(request.url).searchParams.get("campaign");
  if (campaign && !UUID_PATTERN.test(campaign)) return responseError("Campaña inválida.", 400);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_equifax_negocios", { p_campaign_id: campaign || null });
  if (error) return responseError(error.message || "No se pudo armar el reporte de negocios.", 500);

  const libro = libroNegociosEquifax((data ?? []) as NegocioEquifax[]);
  const hoy = diaEnChile(new Date().toISOString()) ?? "";
  const archivo = nombreArchivoNegocios(hoy);
  return new NextResponse(Buffer.from(libro), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${archivo}"; filename*=UTF-8''${encodeURIComponent(archivo)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
