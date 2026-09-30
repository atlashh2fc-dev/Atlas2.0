import { NextResponse, type NextRequest } from "next/server";

import { BUCKET_LOOKS } from "@/lib/looks.server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Cuánto viven las fotos originales del Estudio de Look. */
export const DIAS_DE_RETENCION = 90;

function autorizado(request: NextRequest) {
  const esperado = process.env.CRON_SECRET?.trim();
  const recibido = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  return Boolean(esperado) && recibido === esperado;
}

/**
 * El cron diario de retención: borra las fotos originales (frente, perfil y
 * resultado) y el 3D del cliente tal como llegó en los looks con más de 90
 * días. Quedan el mapa de corte y el look aprobado (fotos simuladas y su 3D),
 * que el cliente autorizó guardar.
 */
export async function GET(request: NextRequest) {
  if (!autorizado(request)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const admin = createAdminClient();
  const corte = new Date(Date.now() - DIAS_DE_RETENCION * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("looks")
    .select("id, foto_path, foto_perfil_path, foto_despues_path, modelo_path, propuesta_aprobada, look_propuestas(id, vistas, modelo_path)")
    .is("fotos_borradas_at", null)
    .lt("created_at", corte)
    .limit(200);
  if (error) return NextResponse.json({ ok: false, error: "No se pudieron leer los looks." }, { status: 500 });

  let borradas = 0;
  for (const look of data ?? []) {
    // Las fotos originales y el 3D del cliente tal como llegó.
    const rutas = [look.foto_path, look.foto_perfil_path, look.foto_despues_path, look.modelo_path].filter((ruta): ruta is string => Boolean(ruta));
    // Las simulaciones (fotos y 3D) de las propuestas que no se aprobaron también se van.
    const descartadas = ((look.look_propuestas ?? []) as { id: string; vistas: Record<string, string> | null; modelo_path: string | null }[]).filter((propuesta) => propuesta.id !== look.propuesta_aprobada);
    for (const propuesta of descartadas) {
      rutas.push(...Object.values(propuesta.vistas ?? {}));
      if (propuesta.modelo_path) rutas.push(propuesta.modelo_path);
    }
    if (rutas.length > 0) {
      const { error: borrado } = await admin.storage.from(BUCKET_LOOKS).remove(rutas);
      if (borrado) continue;
      borradas += rutas.length;
    }
    if (descartadas.length > 0) {
      await admin.from("look_propuestas").update({ vistas: {}, modelo_path: null, modelo_estado: null }).in("id", descartadas.map((propuesta) => propuesta.id));
    }
    await admin
      .from("looks")
      .update({ foto_path: null, foto_perfil_path: null, foto_despues_path: null, modelo_path: null, modelo_estado: null, fotos_borradas_at: new Date().toISOString() })
      .eq("id", look.id);
  }
  return NextResponse.json({ ok: true, looks: data?.length ?? 0, borradas });
}
