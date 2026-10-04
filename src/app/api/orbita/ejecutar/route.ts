import { after, NextResponse } from "next/server";

import { cronAutorizado } from "@/lib/cron-autorizado";
import { MAX_INTENTOS, MOTORES_CON_TURNO } from "@/lib/orbita-guardian";
import { correrTurno, type AgenteDeLaRed, type MotorConTurno } from "@/lib/orbita-motores.server";
import { registrarEventos, type EventoAGuardar } from "@/lib/orbita-registro.server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Un turno de un agente de Órbita en la nube.
 *
 * Lo llama el reloj (/api/orbita/reloj) con CRON_SECRET y el id de la
 * ejecución que acaba de crear. Toma la ejecución solo si sigue pendiente (dos
 * llamadas al mismo turno no corren dos veces), responde al tiro y trabaja
 * después de responder: el reloj no espera a que el agente piense.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

const COLUMNAS = "codigo, nombre, persona, rol, horario, motor, activo, instrucciones, ultimo_estado, ultimo_resumen, ultimo_evento_at";

export async function POST(request: Request) {
  if (!cronAutorizado(request)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  let ejecucionId: string | null = null;
  try {
    const cuerpo = (await request.json()) as { ejecucion_id?: unknown };
    ejecucionId = typeof cuerpo.ejecucion_id === "string" ? cuerpo.ejecucion_id : null;
  } catch {
    ejecucionId = null;
  }
  if (!ejecucionId) return NextResponse.json({ error: "Falta ejecucion_id" }, { status: 400 });

  const admin = createAdminClient();
  const ahora = new Date();
  // Tomarla de forma atómica: solo una llamada la pasa de pendiente a corriendo.
  const { data: tomada, error: errorTomar } = await admin
    .from("orbita_ejecuciones")
    .update({ estado: "corriendo", iniciada_at: ahora.toISOString() })
    .eq("id", ejecucionId)
    .eq("estado", "pendiente")
    .select("id, organization_id, agente_codigo, intento")
    .maybeSingle();
  if (errorTomar) return NextResponse.json({ error: errorTomar.message }, { status: 500 });
  if (!tomada) return NextResponse.json({ ok: true, estado: "ya tomada" }, { status: 200 });

  const organizationId = tomada.organization_id as string;
  const codigo = tomada.agente_codigo as string;
  const intento = tomada.intento as number;

  const { data: agenteData, error: errorAgente } = await admin
    .from("orbita_agentes")
    .select(COLUMNAS)
    .eq("organization_id", organizationId)
    .eq("codigo", codigo)
    .maybeSingle();
  const agente = agenteData as AgenteDeLaRed | null;
  const motor = agente?.motor && MOTORES_CON_TURNO.has(agente.motor) ? (agente.motor as MotorConTurno) : null;
  if (errorAgente || !agente || !motor) {
    const motivo = errorAgente?.message ?? "El agente no existe o no tiene un motor de la nube";
    await admin.from("orbita_ejecuciones").update({ estado: "error", error: motivo, terminada_at: new Date().toISOString() }).eq("id", ejecucionId);
    return NextResponse.json({ error: motivo }, { status: 422 });
  }

  const { data: guardian } = await admin
    .from("orbita_agentes")
    .select("codigo")
    .eq("organization_id", organizationId)
    .eq("motor", "guardian")
    .limit(1)
    .maybeSingle();

  after(async () => {
    const id = ejecucionId as string;
    await registrarEventos(admin, organizationId, [
      { agente: codigo, tipo: "inicio", resumen: intento > 1 ? `Turno en la nube (intento ${intento})` : "Turno en la nube", detalle: { ejecucion: id } },
    ]);
    try {
      const resultado = await correrTurno(motor, { admin, organizationId, agente, ahora });
      await admin
        .from("orbita_ejecuciones")
        .update({ estado: "ok", resumen: resultado.resumen, uso: resultado.uso, terminada_at: new Date().toISOString() })
        .eq("id", id);
      await registrarEventos(admin, organizationId, [
        { agente: codigo, tipo: "fin", estado: "ok", resumen: resultado.resumen, relacionado_con: resultado.destino, detalle: { ejecucion: id, uso: resultado.uso } },
      ]);
    } catch (error) {
      const motivo = error instanceof Error ? error.message : "Error desconocido";
      console.error(`[orbita-nube] ${codigo} falló (intento ${intento}): ${motivo}`);
      await admin.from("orbita_ejecuciones").update({ estado: "error", error: motivo, terminada_at: new Date().toISOString() }).eq("id", id);
      const eventos: EventoAGuardar[] = [{ agente: codigo, tipo: "error", resumen: motivo, detalle: { ejecucion: id, intento } }];
      // El último intento avisa al CEO (y, si no hay CEO, queda en la bitácora del Guardián).
      if (intento >= MAX_INTENTOS && guardian?.codigo) {
        eventos.push({
          agente: guardian.codigo as string,
          tipo: "alerta",
          estado: "error",
          relacionado_con: codigo,
          resumen: `${agente.persona ?? agente.nombre} no pudo completar su turno tras ${MAX_INTENTOS} intentos: ${motivo}`,
        });
      }
      await registrarEventos(admin, organizationId, eventos);
    }
  });

  return NextResponse.json({ ok: true, estado: "corriendo", agente: codigo, intento }, { status: 202 });
}
