import { NextResponse, type NextRequest } from "next/server";

import { consultarModelo3D, type SolicitudModelo3D } from "@/lib/ia/look.server";
import { BUCKET_LOOKS } from "@/lib/looks.server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Pasado este plazo, un 3D que no volvió se da por fallido y se puede pedir otra vez. */
const MINUTOS_MAXIMOS = 30;

function autorizado(request: NextRequest) {
  const esperado = process.env.CRON_SECRET?.trim();
  const recibido = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  return Boolean(esperado) && recibido === esperado;
}

type Pendiente = { tabla: "looks" | "look_propuestas"; id: string; organization_id: string; cuenta_id: string; look_id: string; solicitud: SolicitudModelo3D | null; pedido_at: string | null };

/**
 * Cada cinco minutos recoge los 3D que fal ya terminó y los guarda en el
 * bucket, aunque nadie tenga la ficha abierta. Así el 3D no depende de que la
 * pantalla lo vaya a buscar.
 */
export async function GET(request: NextRequest) {
  if (!autorizado(request)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!process.env.FAL_KEY?.trim()) return NextResponse.json({ ok: true, omitido: "sin FAL_KEY" });
  const admin = createAdminClient();

  const [{ data: looks }, { data: propuestas }] = await Promise.all([
    admin.from("looks").select("id, organization_id, cuenta_id, modelo_solicitud, modelo_at").eq("modelo_estado", "generando").limit(20),
    admin.from("look_propuestas").select("id, organization_id, look_id, modelo_solicitud, modelo_at, looks!look_propuestas_look_id_fkey(cuenta_id)").eq("modelo_estado", "generando").limit(20),
  ]);
  const pendientes: Pendiente[] = [
    ...(looks ?? []).map((fila) => ({ tabla: "looks" as const, id: fila.id as string, organization_id: fila.organization_id as string, cuenta_id: fila.cuenta_id as string, look_id: fila.id as string, solicitud: fila.modelo_solicitud as SolicitudModelo3D | null, pedido_at: fila.modelo_at as string | null })),
    ...(propuestas ?? []).map((fila) => {
      const look = (Array.isArray(fila.looks) ? fila.looks[0] : fila.looks) as { cuenta_id: string } | null;
      return { tabla: "look_propuestas" as const, id: fila.id as string, organization_id: fila.organization_id as string, cuenta_id: look?.cuenta_id ?? "", look_id: fila.look_id as string, solicitud: fila.modelo_solicitud as SolicitudModelo3D | null, pedido_at: fila.modelo_at as string | null };
    }),
  ];

  const resumen = { revisados: pendientes.length, listos: 0, fallidos: 0, esperando: 0 };
  for (const pendiente of pendientes) {
    const vencido = pendiente.pedido_at && Date.now() - new Date(pendiente.pedido_at).getTime() > MINUTOS_MAXIMOS * 60 * 1000;
    if (!pendiente.solicitud) {
      await admin.from(pendiente.tabla).update({ modelo_estado: "fallido" }).eq("id", pendiente.id);
      resumen.fallidos += 1;
      continue;
    }
    const resultado = await consultarModelo3D(pendiente.solicitud).catch(() => ({ estado: "generando" as const, posicion: null }));
    if (resultado.estado === "listo") {
      const ruta = `${pendiente.organization_id}/${pendiente.cuenta_id}/${pendiente.look_id}/${pendiente.tabla === "looks" ? "cliente" : pendiente.id}-3d-${Date.now()}.glb`;
      const { error } = await admin.storage.from(BUCKET_LOOKS).upload(ruta, resultado.glb, { contentType: "model/gltf-binary", upsert: false });
      if (error) continue;
      await admin.from(pendiente.tabla).update({ modelo_estado: "listo", modelo_path: ruta }).eq("id", pendiente.id).eq("modelo_estado", "generando");
      resumen.listos += 1;
    } else if (resultado.estado === "fallido" || vencido) {
      await admin.from(pendiente.tabla).update({ modelo_estado: "fallido" }).eq("id", pendiente.id).eq("modelo_estado", "generando");
      resumen.fallidos += 1;
    } else {
      resumen.esperando += 1;
    }
  }
  return NextResponse.json({ ok: true, ...resumen });
}
