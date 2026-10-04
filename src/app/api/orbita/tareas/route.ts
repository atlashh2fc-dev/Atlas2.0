import { NextResponse } from "next/server";
import { z } from "zod";

import { codigoSchema } from "@/lib/orbita-ingreso";
import { empresaDeLaIntegracion, leerEnvioFirmado, registrarEventos } from "@/lib/orbita-registro.server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * El puente de tareas: los agentes que corren fuera de Atlas leen lo que les
 * encargaron (el CEO de la nube les asigna tareas y fija la prioridad) y
 * avisan cuando lo cumplen.
 *
 *   { "accion": "listar", "para": "9" }
 *   { "accion": "cerrar", "para": "9", "id": "<uuid>", "estado": "hecha" | "descartada", "resultado": "…" }
 *
 * Misma puerta que /api/orbita/eventos: firma HMAC-SHA256 con
 * MARKETING_INGEST_SECRET y la empresa atada a la clave.
 */
export const runtime = "nodejs";
export const maxDuration = 20;

const pedido = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("listar"), para: codigoSchema }),
  z.object({
    accion: z.literal("cerrar"),
    para: codigoSchema,
    id: z.string().uuid(),
    estado: z.enum(["hecha", "descartada"]).default("hecha"),
    resultado: z.string().trim().max(2000).nullish(),
  }),
]);

export async function POST(request: Request) {
  const firmado = await leerEnvioFirmado(request, 64 * 1024);
  if (!firmado.ok) return NextResponse.json({ error: firmado.error }, { status: firmado.status });

  let datos: unknown;
  try {
    datos = JSON.parse(firmado.cuerpo);
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido: no es JSON" }, { status: 400 });
  }
  const leido = pedido.safeParse(datos);
  if (!leido.success) return NextResponse.json({ error: leido.error.issues[0]?.message ?? "Cuerpo inválido" }, { status: 400 });

  const admin = createAdminClient();
  const organizationId = await empresaDeLaIntegracion(admin);
  if (!organizationId) return NextResponse.json({ error: "Empresa de la integración no encontrada" }, { status: 503 });

  if (leido.data.accion === "listar") {
    const para = leido.data.para;
    const [tareas, prioridad, decisiones] = await Promise.all([
      admin
        .from("orbita_tareas")
        .select("id, de, titulo, detalle, vence, origen, created_at")
        .eq("organization_id", organizationId)
        .eq("para", para)
        .eq("estado", "pendiente")
        .order("created_at", { ascending: true })
        .limit(30),
      admin
        .from("orbita_notas")
        .select("contenido, created_at")
        .eq("organization_id", organizationId)
        .eq("tipo", "prioridad")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("orbita_notas")
        .select("titulo, contenido, created_at")
        .eq("organization_id", organizationId)
        .eq("tipo", "decision")
        .eq("datos->>para", para)
        .gte("created_at", new Date(Date.now() - 7 * 86_400_000).toISOString())
        .order("created_at", { ascending: false })
        .limit(10),
    ]);
    const error = tareas.error ?? prioridad.error ?? decisiones.error;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({
      ok: true,
      para,
      prioridad: prioridad.data?.contenido ?? null,
      prioridad_desde: prioridad.data?.created_at ?? null,
      tareas: tareas.data ?? [],
      decisiones: decisiones.data ?? [],
    });
  }

  const { id, para, estado, resultado } = leido.data;
  const { data: cerrada, error } = await admin
    .from("orbita_tareas")
    .update({ estado, resultado: resultado ?? null, cerrada_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("id", id)
    .eq("para", para)
    .eq("estado", "pendiente")
    .select("id, de, titulo")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!cerrada) return NextResponse.json({ error: "La tarea no existe, no es de este agente o ya estaba cerrada" }, { status: 404 });

  await registrarEventos(admin, organizationId, [
    {
      agente: para,
      tipo: "tarea",
      relacionado_con: cerrada.de as string,
      resumen: `${estado === "hecha" ? "Cumplió" : "Descartó"}: ${cerrada.titulo}${resultado ? ` · ${resultado}` : ""}`.slice(0, 1000),
    },
  ]);
  return NextResponse.json({ ok: true, id, estado });
}
